import { OrderStatus, Prisma, type RefundReason } from '@prisma/client';
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PaymentService, SETTLEMENT_TOLERANCE } from '../payment/payment.service';

/** Filtros del buscador de órdenes del panel de soporte. */
export interface AdminOrderListParams {
  /** Folio (`publicId`), id interno, correo del comprador o nombre. */
  search?: string;
  status?: OrderStatus;
  eventId?: string;
  /** ISO 8601. Acota `createdAt`; es lo que hace eficiente la búsqueda por nombre. */
  from?: string;
  to?: string;
  /** `id` de la última orden de la página anterior. */
  cursor?: string;
  limit?: number;
}

@Injectable()
export class AdminService {
  private logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private payments: PaymentService,
    private notifications: NotificationService,
  ) {}

  // ==================== ADMIN DASHBOARD ====================

  async dashboard(orgId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [ordersToday, activeEvents, activeHolds, dailyRevenue, fraudFlags, totalUsers] =
      await Promise.all([
        this.prisma.order.count({
          where: { organizationId: orgId, createdAt: { gte: today }, status: 'COMPLETED' },
        }),
        this.prisma.event.count({ where: { organizationId: orgId, status: 'SCHEDULED' } }),
        this.prisma.ticket.count({
          where: { event: { organizationId: orgId }, status: 'HELD' },
        }),
        this.prisma.order.aggregate({
          where: { organizationId: orgId, status: 'COMPLETED', createdAt: { gte: today } },
          _sum: { totalAmount: true },
        }),
        this.prisma.fraudFlag.count({
          where: { order: { organizationId: orgId }, status: 'FLAGGED' },
        }),
        this.prisma.user.count(),
      ]);

    const channelBreakdown = await this.prisma.order.groupBy({
      by: ['channel'],
      where: { organizationId: orgId, status: 'COMPLETED', createdAt: { gte: today } },
      _sum: { totalAmount: true },
      _count: true,
    });

    let taquillaTerminals = 0;
    try {
      taquillaTerminals = await this.prisma.posTerminal.count({
        where: { organizationId: orgId },
      });
    } catch {
      taquillaTerminals = 0;
    }

    return {
      ordersToday,
      activeEvents,
      activeHolds,
      revenueToday: Number(dailyRevenue._sum.totalAmount ?? 0),
      fraudFlags,
      totalUsers,
      taquillaTerminals,
      channelBreakdown: channelBreakdown.map((c) => ({
        channel: c.channel,
        orders: c._count,
        revenue: Number(c._sum.totalAmount ?? 0),
      })),
      timestamp: new Date(),
    };
  }

  async platformOverview(orgId: string) {
    const [dashboard, events, venues, salesByChannel, recentOrders] = await Promise.all([
      this.dashboard(orgId),
      this.prisma.event.count({ where: { organizationId: orgId } }),
      this.prisma.venue.count({ where: { organizationId: orgId } }),
      this.salesReport(orgId),
      this.prisma.order.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          publicId: true,
          status: true,
          channel: true,
          totalAmount: true,
          createdAt: true,
          event: { select: { title: true } },
        },
      }),
    ]);

    return {
      ...dashboard,
      totalEvents: events,
      totalVenues: venues,
      salesByChannel,
      recentOrders: recentOrders.map((o) => ({
        publicId: o.publicId,
        status: o.status,
        channel: o.channel,
        totalAmount: String(o.totalAmount),
        eventTitle: o.event.title,
        createdAt: o.createdAt,
      })),
    };
  }

  // ==================== EVENT MANAGEMENT ====================

  async listEvents(orgId: string) {
    return await this.prisma.event.findMany({
      where: { organizationId: orgId },
      orderBy: { startsAt: 'desc' },
      include: { venue: true, _count: { select: { orders: true } } },
    });
  }

  async listVenues(orgId: string) {
    return await this.prisma.venue.findMany({
      where: { organizationId: orgId },
      include: {
        layouts: { where: { isActive: true } },
        _count: { select: { events: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getTheme(orgId: string) {
    return (
      (await this.prisma.tenantTheme.findUnique({ where: { organizationId: orgId } })) ?? {
        primaryColor: '#171717',
        subdomain: 'demo',
      }
    );
  }

  async updateTheme(orgId: string, data: { primaryColor?: string; logoUrl?: string; subdomain?: string }) {
    return await this.prisma.tenantTheme.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }

  // ==================== ORDER MANAGEMENT ====================

  /**
   * Buscador de órdenes de soporte.
   *
   * Antes era un `take: 50` fijo sin filtros: no había forma de encontrar una
   * orden de hace un mes. Ahora acepta búsqueda, filtros y paginación por
   * cursor.
   *
   * DISEÑADO CONTRA LOS ÍNDICES QUE HAY (el esquema está congelado). `Order`
   * tiene `@@index` sobre `organizationId`, `status`, `createdAt`, `publicId`,
   * `buyerEmail` y `eventId`. Por eso:
   *  - folio y correo se buscan por IGUALDAD (o prefijo), nunca con `contains`;
   *  - el nombre del comprador SÍ necesita `contains` y no tiene índice: esa
   *    búsqueda se acota siempre a una ventana temporal (90 días por defecto)
   *    para que el escaneo lo delimite `@@index([createdAt])` y no la tabla
   *    entera. Se avisa en `warnings` para que la interfaz lo diga.
   */
  async listOrders(orgId: string, params: AdminOrderListParams = {}) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const warnings: string[] = [];

    const where: Prisma.OrderWhereInput = { organizationId: orgId };
    if (params.status) where.status = params.status;
    if (params.eventId) where.eventId = params.eventId;

    const createdAt: Prisma.DateTimeFilter = {};
    if (params.from) {
      const from = new Date(params.from);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('from inválido (ISO 8601)');
      createdAt.gte = from;
    }
    if (params.to) {
      const to = new Date(params.to);
      if (Number.isNaN(to.getTime())) throw new BadRequestException('to inválido (ISO 8601)');
      createdAt.lte = to;
    }

    const search = params.search?.trim();
    if (search) {
      const term = search;
      if (term.includes('@')) {
        // `buyerEmail` está indexado: igualdad si es un correo completo,
        // prefijo si el operador escribió solo el principio.
        const looksComplete = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(term);
        where.buyerEmail = looksComplete
          ? { equals: term.toLowerCase(), mode: 'insensitive' }
          : { startsWith: term.toLowerCase(), mode: 'insensitive' };
      } else if (!term.includes(' ') && /^[A-Za-z0-9_-]{4,}$/.test(term)) {
        // Folio o id interno. `publicId` es único y está indexado.
        where.OR = [
          { publicId: { equals: term } },
          { publicId: { equals: term.toUpperCase() } },
          { id: { equals: term } },
          { publicId: { startsWith: term.toUpperCase() } },
        ];
      } else {
        where.buyerName = { contains: term, mode: 'insensitive' };
        if (!createdAt.gte) {
          createdAt.gte = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          warnings.push(
            'La búsqueda por nombre no tiene índice: se limitó a los últimos 90 días. ' +
              'Usa ?from= para ampliar el periodo, o busca por folio/correo para una consulta exacta.',
          );
        }
      }
    }
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

    const rows = await this.prisma.order.findMany({
      where,
      // `id` desempata: dos órdenes pueden compartir `createdAt` al milisegundo
      // y sin orden total el cursor se salta o repite filas entre páginas.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        publicId: true,
        status: true,
        channel: true,
        currency: true,
        totalAmount: true,
        buyerEmail: true,
        buyerName: true,
        createdAt: true,
        completedAt: true,
        refundedAt: true,
        event: { select: { id: true, title: true, slug: true } },
        // `payment.amount`/`currency` son imprescindibles: sin ellos la tabla no
        // puede mostrar COBRADO vs. ESPERADO y el descuadre pasa inadvertido.
        payment: {
          select: {
            status: true,
            gateway: true,
            amount: true,
            currency: true,
            processedAt: true,
          },
        },
        items: { select: { id: true, quantity: true } },
        _count: { select: { refunds: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page.map((o) => {
        const charged = o.payment ? new Decimal(o.payment.amount) : null;
        return {
          id: o.id,
          publicId: o.publicId,
          status: o.status,
          channel: o.channel,
          buyerEmail: o.buyerEmail,
          buyerName: o.buyerName,
          createdAt: o.createdAt,
          completedAt: o.completedAt,
          refundedAt: o.refundedAt,
          event: o.event,
          ticketCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
          refundCount: o._count.refunds,
          /** Lo facturado. */
          expectedAmount: o.totalAmount.toString(),
          expectedCurrency: o.currency,
          /** Lo realmente liquidado por el banco (`Payment.amount`). */
          chargedAmount: charged ? charged.toString() : null,
          chargedCurrency: o.payment?.currency ?? null,
          /** liquidado − esperado. Negativo = se cobró de menos. */
          settlementDelta: charged ? charged.minus(o.totalAmount).toString() : null,
          settlementMismatch: charged
            ? !charged.minus(o.totalAmount).abs().lessThanOrEqualTo(SETTLEMENT_TOLERANCE) ||
              o.payment!.currency !== o.currency
            : false,
          payment: o.payment
            ? {
                status: o.payment.status,
                gateway: o.payment.gateway,
                processedAt: o.payment.processedAt,
              }
            : null,
        };
      }),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      hasMore,
      limit,
      filters: {
        search: search ?? null,
        status: params.status ?? null,
        eventId: params.eventId ?? null,
        from: createdAt.gte ?? null,
        to: createdAt.lte ?? null,
      },
      warnings,
    };
  }

  async getOrder(orgId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { organizationId: orgId, OR: [{ id: orderId }, { publicId: orderId }] },
      include: {
        event: { select: { id: true, title: true, slug: true } },
        payment: true,
        refunds: { orderBy: { requestedAt: 'desc' } },
        items: {
          include: {
            tickets: { select: { id: true, code: true, status: true, section: true, row: true, seatNumber: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async requestRefund(
    orgId: string,
    orderId: string,
    data: { reason?: string; amount?: number; notes?: string; requestedBy: string },
  ) {
    const order = await this.getOrder(orgId, orderId);
    return this.payments.createRefund({
      orderId: order.id,
      reason: data.reason || 'CUSTOMER_REQUEST',
      amount: data.amount,
      notes: data.notes,
      requestedBy: data.requestedBy,
    });
  }

  async resendOrderEmail(orgId: string, orderId: string) {
    const order = await this.getOrder(orgId, orderId);
    await this.notifications.enqueueOrderConfirmation(order.id, order.buyerEmail, order.buyerName);
    await this.notifications.enqueueTicketPDF(order.id, order.buyerEmail);
    return { ok: true, email: order.buyerEmail };
  }

  async cancelOrderForOrg(orgId: string, orderId: string, reason: string) {
    const order = await this.getOrder(orgId, orderId);
    if (order.status === 'COMPLETED' || order.status === 'REFUNDED') {
      throw new BadRequestException('Use refund for completed orders');
    }
    this.logger.log(`Cancel order ${order.id}: ${reason}`);
    return this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Asienta un reembolso ya liquidado fuera del gateway.
   *
   * ANTES (P0, dinero + aforo): creaba el `Refund`, marcaba la orden REFUNDED y
   * ahí acababa. Los boletos se quedaban SOLD para siempre y esas butacas no se
   * volvían a vender NUNCA. Además comparaba contra `Order.totalAmount` (lo
   * facturado) en lugar de `Payment.amount` (lo realmente liquidado), de modo
   * que sobre un cobro parcial devolvía de más.
   *
   * Ahora delega en `PaymentService.recordSettledRefund`, que es la única ruta
   * que valida el importe reembolsable, libera inventario cuando la devolución
   * cubre lo cobrado y avisa al comprador. La liberación es idempotente: un
   * reembolso parcial no libera nada y dos pasadas no descuadran los contadores.
   */
  async manualRefund(
    orgId: string,
    orderId: string,
    options: {
      amount?: number;
      reason?: string;
      notes?: string;
      requestedBy?: string;
    } = {},
  ) {
    // Se resuelve por id o folio y con el tenant cotejado antes de tocar dinero.
    const order = await this.getOrder(orgId, orderId);
    const result = await this.payments.recordSettledRefund({
      orderId: order.id,
      amount: options.amount,
      reason: options.reason as RefundReason | undefined,
      notes: options.notes,
      requestedBy: options.requestedBy ?? 'admin',
      organizationId: orgId,
    });
    this.logger.log(
      `Reembolso manual en ${result.orderPublicId}: ${result.refund.amount} ${result.currency} ` +
        `(inventario liberado: ${result.inventoryReleased})`,
    );
    return result;
  }

  async cancelOrder(orderId: string, reason: string) {
    return await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
  }

  // ==================== FRAUD MANAGEMENT ====================

  /**
   * LIMITACIÓN DE ESQUEMA (esquema congelado): `PromoterPayout` no tiene columna
   * `currency`. `grossRevenue`, `commission` y `netAmount` son importes SIN
   * moneda: si la organización vende en más de una (`Order.currency` es un enum
   * de 15), esos totales suman peras con manzanas y nadie puede saberlo mirando
   * la fila.
   *
   * Mientras no se pueda migrar el esquema, este método NO asume MXN en
   * silencio: deriva las monedas realmente facturadas por la organización y
   * marca cada liquidación con `currency` (única moneda observada) o `null` +
   * `currencyAmbiguous` cuando hay varias. La interfaz debe mostrar el importe
   * sin símbolo cuando `currency` sea `null`.
   *
   * PENDIENTE DE MIGRACIÓN: `PromoterPayout.currency Currency` (+ backfill con
   * la moneda dominante del periodo) y desglose por moneda.
   */
  async listPayouts(orgId: string) {
    const [byChannel, payouts] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['channel', 'currency'],
        where: { organizationId: orgId, status: 'COMPLETED' },
        _sum: { totalAmount: true, commissionAmount: true },
        _count: true,
      }),
      this.prisma.promoterPayout.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const currencies = [...new Set(byChannel.map((c) => c.currency))];
    const inferredCurrency = currencies.length === 1 ? currencies[0]! : null;

    return {
      byChannel,
      payouts: payouts.map((p) => ({
        ...p,
        currency: inferredCurrency,
        currencyAmbiguous: inferredCurrency === null,
      })),
      currencies,
      currencyNote:
        inferredCurrency === null
          ? 'PromoterPayout no almacena moneda y la organización factura en varias ' +
            `(${currencies.join(', ') || 'ninguna venta registrada'}): los importes de ` +
            'liquidación no son comparables entre sí. No los muestres con símbolo de moneda.'
          : `PromoterPayout no almacena moneda; se infiere ${inferredCurrency} porque es la ` +
            'única moneda facturada por esta organización.',
    };
  }

  async markPayoutProcessing(orgId: string, payoutId: string, referenceId?: string) {
    const payout = await this.prisma.promoterPayout.findFirst({
      where: { id: payoutId, organizationId: orgId },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return this.prisma.promoterPayout.update({
      where: { id: payoutId },
      data: {
        status: 'PROCESSING',
        referenceId: referenceId ?? payout.referenceId,
        processedAt: new Date(),
      },
    });
  }

  async markPayoutCompleted(orgId: string, payoutId: string, referenceId: string) {
    const payout = await this.prisma.promoterPayout.findFirst({
      where: { id: payoutId, organizationId: orgId },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return this.prisma.promoterPayout.update({
      where: { id: payoutId },
      data: {
        status: 'COMPLETED',
        referenceId,
        processedAt: new Date(),
      },
    });
  }

  // ==================== SALES REPORTS ====================

  async salesReport(orgId: string, from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    return await this.prisma.order.groupBy({
      by: ['channel'],
      where: {
        organizationId: orgId,
        status: 'COMPLETED',
        createdAt: { gte: start, lte: end },
      },
      _sum: { totalAmount: true },
      _count: true,
    });
  }

  // ==================== AI LAYOUT SUGGESTION ====================

  suggestLayoutFromPlan(_venueId: string, planDescription: string) {
    return {
      suggested: true,
      sections: [
        {
          id: 'suggested-a',
          name: 'Sección A (sugerida)',
          slug: 'a',
          color: 'var(--bl-gray-700)',
          seats: Array.from({ length: 10 }, (_, i) => ({
            id: `sug-${i}`,
            label: `A-${i + 1}`,
            x: 50 + (i % 5) * 40,
            y: 100 + Math.floor(i / 5) * 40,
            tier: 'standard',
          })),
        },
      ],
      note: `Sugerencia basada en: ${planDescription.slice(0, 200)}. Revisar en editor antes de publicar.`,
    };
  }
}


