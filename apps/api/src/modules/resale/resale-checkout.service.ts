import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { generateTicketCode } from '@boletera/crypto';
import { OrderStatus, Prisma, ResaleStatus, SalesChannel, TicketStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../../common/audit.service';
import {
  ExternalChargeBlockedError,
  PaymentService,
  type ExternalCharge,
  type ExternalChargeHandler,
} from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Minutos que el anuncio queda apartado para quien empezó a pagarlo. Solo se
 * cobra con tarjeta: una referencia OXXO de días tendría el boleto secuestrado.
 */
export const RESALE_CHECKOUT_MINUTES = 15;

type CheckoutRow = {
  id: string;
  publicId: string;
  organizationId: string;
  status: OrderStatus;
  amount: Prisma.Decimal;
  currency: ExternalCharge['currency'];
  paymentMethod: ExternalCharge['paymentMethod'];
};

function toCharge(row: CheckoutRow): ExternalCharge {
  return {
    id: row.id,
    publicId: row.publicId,
    organizationId: row.organizationId,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    paymentMethod: row.paymentMethod,
  };
}

/**
 * Reventa oficial con cobro real (como Ticketmaster): el comprador paga el
 * precio del anuncio más el cargo por servicio; al confirmarse el cobro, en la
 * misma transacción que crea el `Payment`, el boleto pasa a su cuenta con un
 * código nuevo (el del vendedor deja de entrar) y queda registrado el pago
 * pendiente al vendedor.
 */
@Injectable()
export class ResaleCheckoutService implements ExternalChargeHandler, OnModuleInit {
  readonly kind = 'resale';

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private payments: PaymentService
  ) {}

  onModuleInit() {
    this.payments.registerExternalCharge(this);
  }

  // ==================== INICIO DE COMPRA ====================================

  async start(userId: string | undefined, listingId: string, now = new Date()) {
    if (!userId) throw new BadRequestException('Inicia sesión para comprar en reventa');
    const id = String(listingId ?? '')
      .trim()
      .slice(0, 64);
    const listing = await this.prisma.resaleListing.findUnique({
      where: { id },
      include: { ticket: { include: { event: true, offer: true } } },
    });
    if (!listing || listing.status !== ResaleStatus.ACTIVE || listing.delisted) {
      throw new NotFoundException('Este boleto ya no está a la venta');
    }
    if (listing.sellerId === userId) {
      throw new ForbiddenException('No puedes comprar tu propio boleto');
    }
    if (listing.ticket.event.startsAt.getTime() <= now.getTime()) {
      throw new ConflictException('El evento ya empezó; la reventa está cerrada');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundException('Cuenta no encontrada');

    // Mi propia compra en curso de este anuncio se reutiliza (no cobra dos veces).
    const mine = await this.prisma.resaleCheckout.findFirst({
      where: {
        listingId: id,
        buyerId: userId,
        status: OrderStatus.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (mine) {
      const intent = await this.payments.createExternalPaymentIntent(this, toCharge(mine), {
        email: mine.buyerEmail,
        name: mine.buyerName,
      });
      return this.startResponse(mine, listing.ticket.event.title, intent);
    }

    const buyerName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
    const asking = new Prisma.Decimal(listing.askingPrice);
    const fee = new Prisma.Decimal(listing.fee);

    // Apartado del anuncio: la comprobación de «nadie más lo está pagando» y la
    // creación van en una transacción serializable para que dos compradores
    // simultáneos no queden pagando el mismo boleto.
    const checkout = await this.prisma.$transaction(
      async (tx) => {
        const busy = await tx.resaleCheckout.count({
          where: { listingId: id, status: OrderStatus.PENDING, expiresAt: { gt: now } },
        });
        if (busy > 0) {
          throw new ConflictException(
            'Alguien más está pagando este boleto. Si no termina en unos minutos, vuelve a intentarlo.'
          );
        }
        return tx.resaleCheckout.create({
          data: {
            publicId: `RSL-${randomBytes(9).toString('base64url').toUpperCase()}`,
            organizationId: listing.ticket.event.organizationId,
            listingId: id,
            buyerId: userId,
            buyerEmail: user.email,
            buyerName,
            amount: asking.plus(fee),
            fee,
            currency: listing.currency,
            paymentMethod: 'CARD',
            sellerPayout: asking,
            expiresAt: new Date(now.getTime() + RESALE_CHECKOUT_MINUTES * 60_000),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    let intent;
    try {
      intent = await this.payments.createExternalPaymentIntent(this, toCharge(checkout), {
        email: user.email,
        name: buyerName,
      });
    } catch (error) {
      await this.prisma.resaleCheckout.update({
        where: { id: checkout.id },
        data: { status: OrderStatus.FAILED },
      });
      throw error;
    }
    await this.audit.log({
      action: 'RESALE_CHECKOUT_STARTED',
      entityType: 'ResaleCheckout',
      entityId: checkout.id,
      organizationId: checkout.organizationId,
      userId,
      metadata: { listingId: id, amount: checkout.amount.toString() },
    });
    return this.startResponse(checkout, listing.ticket.event.title, intent);
  }

  /** Estado de una compra propia (la página de pago la sondea). */
  async status(userId: string, publicId: string) {
    const row = await this.prisma.resaleCheckout.findUnique({
      where: { publicId: String(publicId ?? '').slice(0, 64) },
      include: { listing: { include: { ticket: { include: { event: true } } } } },
    });
    if (!row || row.buyerId !== userId) throw new NotFoundException('Compra no encontrada');
    const order = row.orderId
      ? await this.prisma.order.findUnique({
          where: { id: row.orderId },
          select: { publicId: true },
        })
      : null;
    return {
      id: row.id,
      publicId: row.publicId,
      status: row.status,
      eventTitle: row.listing.ticket.event.title,
      seat: [row.listing.ticket.section, row.listing.ticket.row, row.listing.ticket.seatNumber]
        .filter(Boolean)
        .join(' · '),
      amount: row.amount.toString(),
      fee: row.fee.toString(),
      currency: row.currency,
      expiresAt: row.expiresAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      orderPublicId: order?.publicId ?? null,
    };
  }

  /** «Mis ventas»: anuncios del vendedor con lo que recibirá y su estado. */
  async sellerSummary(userId: string) {
    const listings = await this.prisma.resaleListing.findMany({
      where: { sellerId: userId },
      orderBy: { listedAt: 'desc' },
      take: 50,
      include: {
        ticket: { include: { event: { select: { title: true, startsAt: true, slug: true } } } },
        checkouts: {
          where: { status: OrderStatus.COMPLETED },
          select: { sellerPayout: true, payoutStatus: true, completedAt: true },
        },
      },
    });
    return listings.map((l) => {
      const sale = l.checkouts[0];
      return {
        id: l.id,
        status: l.status,
        askingPrice: l.askingPrice.toString(),
        currency: l.currency,
        listedAt: l.listedAt.toISOString(),
        soldAt: l.soldAt?.toISOString() ?? null,
        event: {
          title: l.ticket.event.title,
          startsAt: l.ticket.event.startsAt.toISOString(),
          slug: l.ticket.event.slug,
        },
        seat: [l.ticket.section, l.ticket.row, l.ticket.seatNumber].filter(Boolean).join(' · '),
        payout: sale
          ? {
              amount: sale.sellerPayout.toString(),
              status: sale.payoutStatus,
              soldAt: sale.completedAt?.toISOString() ?? null,
            }
          : null,
      };
    });
  }

  private startResponse(
    checkout: CheckoutRow & { expiresAt: Date; fee: Prisma.Decimal },
    eventTitle: string,
    intent: { redirectUrl?: string; reference?: string; metadata?: unknown }
  ) {
    const meta = (intent.metadata ?? {}) as Record<string, unknown>;
    return {
      publicId: checkout.publicId,
      status: checkout.status,
      eventTitle,
      amount: checkout.amount.toString(),
      fee: checkout.fee.toString(),
      currency: checkout.currency,
      expiresAt: checkout.expiresAt.toISOString(),
      payment: {
        redirectUrl: intent.redirectUrl ?? null,
        demo: meta.demo === true,
      },
    };
  }

  // ==================== HANDLER DEL CAMINO DE PAGO ==========================

  async find(reference: string): Promise<ExternalCharge | null> {
    const ref = String(reference ?? '').trim();
    if (!ref) return null;
    const row =
      (await this.prisma.resaleCheckout.findUnique({ where: { id: ref } })) ??
      (ref.startsWith('RSL-')
        ? await this.prisma.resaleCheckout.findUnique({ where: { publicId: ref } })
        : null);
    return row ? toCharge(row) : null;
  }

  async claim(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const res = await tx.resaleCheckout.updateMany({
      where: { id, status: { in: [OrderStatus.PENDING, OrderStatus.FAILED] } },
      data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
    });
    return res.count === 1;
  }

  /**
   * Entrega el boleto. Si el anuncio dejó de estar activo (el vendedor lo
   * canceló o se vendió por otra vía) la transacción se aborta y el cobro queda
   * para devolución.
   */
  async activate(
    tx: Prisma.TransactionClient,
    charge: ExternalCharge,
    paymentId: string,
    now = new Date()
  ): Promise<void> {
    const checkout = await tx.resaleCheckout.findUnique({
      where: { id: charge.id },
      include: { listing: { include: { ticket: true } } },
    });
    if (!checkout) throw new NotFoundException('Compra no encontrada');
    const listing = checkout.listing;
    const ticket = listing.ticket;

    // Cambio condicional: solo un cobro puede llevarse el anuncio.
    const taken = await tx.resaleListing.updateMany({
      where: { id: listing.id, status: ResaleStatus.ACTIVE },
      data: { status: ResaleStatus.SOLD, soldAt: now },
    });
    if (taken.count !== 1 || ticket.status !== TicketStatus.RESOLD) {
      throw new ExternalChargeBlockedError(
        'resale.listing_unavailable',
        `El anuncio de ${checkout.publicId} ya no estaba disponible al confirmarse el cobro. No se entrega; el cobro debe devolverse.`,
        { checkoutPublicId: checkout.publicId, listingId: listing.id }
      );
    }

    // Orden propia del comprador: así el boleto aparece en «Mis boletos» y su
    // dueño, para transferir o revender, es el comprador.
    const order = await tx.order.create({
      data: {
        publicId: `RV-${randomBytes(6).toString('base64url').toUpperCase()}`,
        organizationId: checkout.organizationId,
        eventId: ticket.eventId,
        userId: checkout.buyerId,
        buyerEmail: checkout.buyerEmail,
        buyerName: checkout.buyerName,
        status: OrderStatus.COMPLETED,
        channel: SalesChannel.RESALE,
        subtotal: checkout.sellerPayout,
        fees: checkout.fee,
        discountAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: checkout.amount,
        commissionAmount: checkout.fee,
        currency: checkout.currency,
        paymentId,
        completedAt: now,
        expiresAt: now,
        items: {
          create: {
            offerId: ticket.offerId,
            quantity: 1,
            unitPrice: checkout.sellerPayout,
            unitFees: checkout.fee,
            subtotal: checkout.amount,
          },
        },
      },
      include: { items: true },
    });

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.SOLD,
        buyerEmail: checkout.buyerEmail,
        buyerName: checkout.buyerName,
        orderItemId: order.items[0].id,
        resalePrice: null,
        // El QR que el vendedor tenía deja de valer en la puerta.
        code: generateTicketCode(),
        keyEpoch: { increment: 1 },
      },
    });

    const seller = await tx.user.findUnique({
      where: { id: listing.sellerId },
      select: { resalePayoutClabe: true },
    });
    await tx.resaleCheckout.update({
      where: { id: checkout.id },
      data: {
        paymentId,
        orderId: order.id,
        ...(seller?.resalePayoutClabe ? { sellerClabe: seller.resalePayoutClabe } : {}),
      },
    });
    await tx.auditEvent.create({
      data: {
        action: 'RESALE_SOLD',
        entityType: 'ResaleListing',
        entityId: listing.id,
        organizationId: checkout.organizationId,
        userId: checkout.buyerId,
        metadata: {
          checkoutPublicId: checkout.publicId,
          orderPublicId: order.publicId,
          sellerId: listing.sellerId,
          sellerPayout: checkout.sellerPayout.toString(),
          paymentId,
        },
      },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.resaleCheckout.updateMany({
      where: { id, status: OrderStatus.PENDING },
      data: { status: OrderStatus.FAILED },
    });
  }

  async markPendingRefund(
    id: string,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const row = await this.prisma.resaleCheckout.update({
      where: { id },
      data: { status: OrderStatus.PENDING_REFUND },
      select: { id: true, organizationId: true },
    });
    await this.audit.log({
      action,
      entityType: 'ResaleCheckout',
      entityId: row.id,
      organizationId: row.organizationId,
      metadata,
    });
  }
}
