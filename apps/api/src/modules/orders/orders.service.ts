import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Logger,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SalesChannel,
  TicketStatus,
  HoldStatus,
  UserRole,
} from '@prisma/client';
import { buildQrPayload, generateTicketCode } from '@boletera/crypto';
import {
  initDefaultProviders,
  getProvider,
  isMethodAllowedForChannel,
  BanorteProvider,
} from '@boletera/payments';
import type { PaymentProvider, SalesChannelType } from '@boletera/payments';
import QRCode from 'qrcode';
import { AuditService } from '../../common/audit.service';
import { isDeferredMethod, paymentDeadline } from '../../common/payment-window';
import { PrismaService } from '../prisma/prisma.service';
import { requireTicketQrSecret } from '../auth/jwt-secret';
import { PricingService } from '../pricing/pricing.service';
import { FraudService } from '../fraud/fraud.service';
import { NotificationService } from '../notification/notification.service';
import { buyerVisibleRefundNote } from '../notification/refund-policy';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { TicketPdfService } from '../notification/ticket-pdf.service';
import { BillingService } from '../billing/billing.service';
import type { OrderRequester } from './orders.dto';

initDefaultProviders();

/** Personal que puede operar el canal de taquilla (y cobrar en efectivo). */
const BOX_OFFICE_ROLES: UserRole[] = [
  UserRole.TAQUILLA,
  UserRole.VENUE_MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

/** Quién puede regalar inventario. Un invitado anónimo, nunca. */
const COMP_ROLES: UserRole[] = [...BOX_OFFICE_ROLES, UserRole.PROMOTER];

/** Comisión de respaldo si la organización no la tiene configurada. */
const DEFAULT_COMMISSION_RATE = 0.15;

/** Vigencia del enlace de consulta que recibe el comprador invitado. */
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Transacciones cortas: nunca deben esperar a la red (F1-07). */
const DB_TX_TIMEOUT_MS = 10_000;

/** Reintentos al reclamar un boleto GA que otra venta pudo llevarse. */
const GA_CLAIM_ATTEMPTS = 5;

/**
 * Deja una fila de `Refund` en lo que el comprador puede ver.
 *
 * `notes` es lo único que hay que tocar: llega mezclado —referencias del
 * gateway, jerga de operación, texto libre de administración— y sale reducido
 * a lo que se escribió para él. Se aplica en las DOS lecturas del comprador,
 * porque una sola descuidada publica el campo entero igual que si no hubiera
 * ninguna.
 *
 * `requestedBy` y `processedBy` no aparecen aquí y tampoco en el `select`: son
 * correos de personal interno y no tienen por qué llegar hasta este punto.
 */
function toBuyerRefund<T extends { notes: string | null }>(refund: T): T {
  return { ...refund, notes: buyerVisibleRefundNote(refund.notes) };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private fraud: FraudService,
    private notifications: NotificationService,
    private audit: AuditService,
    private campaigns: CampaignExecutionService,
    private quotas: ChannelQuotaService,
    private ticketPdf: TicketPdfService,
    private billing: BillingService,
  ) {}

  async createOrder(dto: {
    eventId: string;
    offerId?: string;
    holdIds?: string[];
    items?: { offerId: string; holdIds: string[] }[];
    buyerName: string;
    buyerEmail: string;
    buyerPhone?: string;
    userId?: string;
    paymentMethod?: string;
    promotionCode?: string;
    channel?: SalesChannel;
    cashierId?: string;
    idempotencyKey?: string;
    ipAddress?: string;
    deviceFingerprint?: string;
    isComp?: boolean;
    compReason?: string;
    posOps?: Record<string, unknown>;
    /** `sub` del JWT verificado. Nunca se toma del cuerpo de la petición. */
    actorUserId?: string;
    /** Rol declarado en el token: solo se audita, el efectivo se lee de BD. */
    actorRole?: string;
    /**
     * Marca las peticiones que entran por el endpoint público. Los llamadores
     * internos (POS de taquilla) ya pasan por JwtAuthGuard + RolesGuard + PIN
     * de gerente en su propio controller, así que no se re-autorizan aquí.
     */
    untrustedRequest?: boolean;
  }) {
    const idempotencyKey = dto.idempotencyKey?.trim() || undefined;
    const buyerName = dto.buyerName?.trim() || 'Cliente';
    if (idempotencyKey) {
      const replay = await this.findByIdempotencyKey(idempotencyKey);
      if (replay) return replay;
    }

    const lineGroups = await this.resolveOrderLines(dto);
    const holdIds = lineGroups.flatMap((g) => g.holdIds);
    const holds = lineGroups.flatMap((g) => g.holds);
    if (!holds.length) throw new BadRequestException('Invalid or expired holds');

    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      include: {
        offers: { where: { isAvailable: true } },
        // La comisión sale de la organización, no de una constante (F1-21).
        organization: { select: { id: true, commissionRate: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    // --- Canal, cajero y cortesías: decisiones de dinero, nunca de headers ---
    const actor = dto.untrustedRequest ? await this.resolveActor(dto.actorUserId) : null;
    const requestedChannel = dto.channel ?? SalesChannel.WEB;
    let channel = requestedChannel;
    let cashierId = dto.cashierId;

    if (dto.untrustedRequest) {
      const isStaff = !!actor && BOX_OFFICE_ROLES.includes(actor.role);
      // `x-channel` queda como telemetría: sin personal autenticado detrás la
      // venta es WEB, y WEB no admite efectivo (F1-01).
      if (requestedChannel !== SalesChannel.WEB && !isStaff) {
        channel = SalesChannel.WEB;
      }
      // El cajero es quien firma el token, no quien manda `x-cashier-id`.
      cashierId = channel === SalesChannel.TAQUILLA && actor ? actor.id : undefined;
    }

    const compRequested =
      dto.isComp === true || (dto.paymentMethod ?? '').toUpperCase() === 'COMP';
    if (compRequested && dto.untrustedRequest && !(actor && COMP_ROLES.includes(actor.role))) {
      throw new ForbiddenException('Solo el personal autorizado puede emitir cortesías');
    }

    let userId = dto.userId;
    if (userId) {
      const linked = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!linked) userId = undefined;
    }
    if (!userId) {
      let user = await this.prisma.user.findUnique({ where: { email: dto.buyerEmail } });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            email: dto.buyerEmail,
            firstName: buyerName.split(' ')[0] ?? 'Guest',
            lastName: buyerName.split(' ').slice(1).join(' ') || 'Buyer',
          },
        });
      }
      userId = user.id;
    }

    const pricedLines: {
      offerId: string;
      holdIds: string[];
      holds: (typeof holds)[number][];
      quantity: number;
      unitPrice: number;
      unitFees: number;
      subtotal: number;
      fees: number;
      taxes: number;
      total: number;
      discount: number;
      appliedRules: unknown;
    }[] = [];

    let subtotal = 0;
    let fees = 0;
    let taxAmount = 0;
    let totalAmount = 0;
    let discountAmount = 0;
    const appliedRules: unknown[] = [];

    for (const group of lineGroups) {
      const offer =
        event.offers.find((o) => o.id === group.offerId) ??
        (await this.prisma.offer.findFirst({
          where: { id: group.offerId, eventId: event.id, isAvailable: true },
        }));
      if (!offer) throw new BadRequestException(`Offer ${group.offerId} not available`);

      const pricingResult = await this.pricing.calculatePrice({
        eventId: dto.eventId,
        offerId: offer.id,
        quantity: group.holds.length,
        promotionCode: dto.promotionCode,
      });
      const lineSubtotal = Number(pricingResult.subtotal);
      const lineFees = Number(pricingResult.fees);
      const lineTaxes = Number(pricingResult.taxes);
      const lineTotal = Number(pricingResult.total);
      const lineDiscount = Number(pricingResult.discount);
      const qty = group.holds.length;
      pricedLines.push({
        offerId: offer.id,
        holdIds: group.holdIds,
        holds: group.holds,
        quantity: qty,
        unitPrice: qty ? lineSubtotal / qty : 0,
        unitFees: qty ? lineFees / qty : 0,
        subtotal: lineSubtotal,
        fees: lineFees,
        taxes: lineTaxes,
        total: lineTotal,
        discount: lineDiscount,
        appliedRules: pricingResult.breakdown.appliedRules,
      });
      subtotal += lineSubtotal;
      fees += lineFees;
      taxAmount += lineTaxes;
      totalAmount += lineTotal;
      discountAmount += lineDiscount;
      appliedRules.push(...(pricingResult.breakdown.appliedRules ?? []));
    }

    let promotionId: string | undefined;
    if (dto.promotionCode) {
      const promo = await this.prisma.promotion.findUnique({ where: { code: dto.promotionCode } });
      if (promo) promotionId = promo.id;
    }

    const isComp = compRequested;
    if (isComp) {
      discountAmount = subtotal + fees + taxAmount;
      fees = 0;
      taxAmount = 0;
      totalAmount = 0;
    }

    // 72 bits de aleatoriedad: `Date.now()` era monótono (adivinable) y además
    // colisionaba contra el índice único en picos de venta (F1-28 / F2-01).
    const publicId = `ORD-${randomBytes(9).toString('base64url').toUpperCase()}`;

    const fraudResult = await this.fraud.analyzeFraud({
      userId,
      eventId: dto.eventId,
      buyerEmail: dto.buyerEmail,
      amount: totalAmount,
      currency: event.currency,
      channel,
      paymentMethod: isComp ? 'CASH' : dto.paymentMethod,
      ipAddress: dto.ipAddress,
      deviceFingerprint: dto.deviceFingerprint,
    });

    if (fraudResult.recommendedAction === 'BLOCK') {
      for (const f of fraudResult.flags) {
        await this.fraud.createFlag({
          type: f.type,
          severity: fraudResult.severity,
          score: fraudResult.score,
          reason: f.reason,
          userId,
          eventId: dto.eventId,
          ipAddress: dto.ipAddress,
          deviceFingerprint: dto.deviceFingerprint,
        });
      }
      throw new ForbiddenException({
        message: 'Order blocked by fraud prevention',
        score: fraudResult.score,
      });
    }

    if (fraudResult.recommendedAction === 'REVIEW') {
      // Una alerta de revisión que no se puede encolar no justifica rechazar una
      // compra que el propio motor consideró aceptable.
      await this.afterSale(publicId, 'alerta de fraude', () =>
        this.notifications.enqueueFraudAlert(publicId, fraudResult.score, 'REVIEW'),
      );
    }

    await this.quotas.assertAvailable(dto.eventId, channel, holds.length);

    const channelType = channel as SalesChannelType;
    const method = isComp ? 'CASH' : (dto.paymentMethod ?? 'CARD').toUpperCase();
    // El método llegaba como string libre y elegía proveedor sin validación:
    // `{"paymentMethod":"CASH"}` desde la web emitía boletos gratis (F1-01).
    if (!isMethodAllowedForChannel(channelType, method)) {
      throw new ForbiddenException(
        `El método de pago ${method} no está disponible en el canal ${channel}`,
      );
    }
    const providerId = method === 'CASH' ? 'cash' : 'banorte';
    let provider: PaymentProvider;
    try {
      provider = getProvider(providerId, channelType);
    } catch (e) {
      throw new ForbiddenException(e instanceof Error ? e.message : 'Proveedor no disponible');
    }
    const banorte = provider as BanorteProvider;

    const payMethodEnum =
      method === 'SPEI'
        ? PaymentMethod.SPEI
        : method === 'OXXO'
          ? PaymentMethod.OXXO
          : method === 'CASH'
            ? PaymentMethod.CASH
            : PaymentMethod.CARD;

    const posOps = {
      ...(dto.posOps ?? {}),
      ...(isComp ? { isComp: true, compReason: dto.compReason || 'house' } : {}),
    };

    const asyncBanorte =
      providerId === 'banorte' &&
      banorte.requiresAsyncCapture({
        amount: totalAmount,
        currency: event.currency,
        orderId: 'pending',
        channel: channel as 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN',
        buyerEmail: dto.buyerEmail,
        buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
      });

    const providerGateway =
      providerId === 'banorte' ? PaymentGateway.BANORTE : PaymentGateway.CASH;
    const commissionRate = event.organization?.commissionRate ?? DEFAULT_COMMISSION_RATE;
    // Un solo reloj para orden, intent y hold: si el intent dura más que la
    // reserva, prometemos un plazo que el inventario no respeta (ver
    // common/payment-window.ts).
    const payBy = paymentDeadline(method);
    const intentMetadata = {
      publicId,
      holdIds,
      items: pricedLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds })),
    };
    // Se devuelve una sola vez, en la respuesta de creación; en BD solo el hash.
    const accessToken = randomBytes(32).toString('base64url');

    const openOrder = () =>
      this.prisma.$transaction(
        async (tx) => {
          const created = await tx.order.create({
            data: {
              publicId,
              organizationId: event.organizationId,
              eventId: event.id,
              userId,
              status: OrderStatus.PENDING,
              buyerEmail: dto.buyerEmail,
              buyerName,
              buyerPhone: dto.buyerPhone,
              subtotal,
              fees,
              taxAmount,
              totalAmount,
              discountAmount,
              promotionId,
              commissionAmount: isComp ? 0 : subtotal * commissionRate,
              currency: event.currency,
              channel,
              cashierId,
              expiresAt: payBy,
              paymentMethod: payMethodEnum,
              accessTokenHash: this.hashToken(accessToken),
              accessTokenAt: new Date(),
              ...(Object.keys(posOps).length
                ? ({ posOps } as Record<string, unknown>)
                : {}),
              items: {
                create: pricedLines.map((line) => ({
                  offerId: line.offerId,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  unitFees: line.unitFees,
                  subtotal: line.subtotal,
                })),
              },
            } as Parameters<typeof tx.order.create>[0]['data'],
            include: { items: true },
          });

          // El intent se persiste también en la rama síncrona: antes solo
          // existía en la asíncrona, así que un reintento con la misma clave
          // no encontraba nada y cobraba dos veces (F1-07).
          const intent = await tx.paymentIntent.create({
            data: {
              orderId: created.id,
              provider: providerGateway,
              amount: totalAmount,
              currency: event.currency,
              status: PaymentStatus.PENDING,
              channel,
              idempotencyKey,
              expiresAt: payBy,
              // Con esto el webhook/reconciliador puede rehacer la venta.
              metadata: intentMetadata,
            },
          });

          // OXXO y SPEI se liquidan horas o días después. El hold nace con el
          // TTL corto de web (15 min), así que sin esto el worker devolvería la
          // butaca a la venta mientras el comprador todavía va camino del OXXO,
          // y el abono acabaría en PENDING_REFUND (F1-03). Se extiende la
          // reserva hasta la misma fecha límite que se le comunica al comprador.
          if (isDeferredMethod(method) && holdIds.length) {
            await tx.seatHold.updateMany({
              where: { id: { in: holdIds }, status: HoldStatus.ACTIVE },
              data: { expiresAt: payBy },
            });
          }

          return { created, intent };
        },
        { timeout: DB_TX_TIMEOUT_MS },
      );

    // --- Paso 1: transacción corta, solo BD. Ninguna llamada de red dentro.
    let opened: Awaited<ReturnType<typeof openOrder>>;
    try {
      opened = await openOrder();
    } catch (e) {
      // La clave es `@unique`: la petición que pierde la carrera devuelve la
      // orden original en lugar de un 500 (F1-07).
      if (idempotencyKey && this.isIdempotencyConflict(e)) {
        const replay = await this.findByIdempotencyKey(idempotencyKey);
        if (replay) return replay;
        throw new ConflictException('Ya existe una orden en curso con esa clave de idempotencia');
      }
      throw e;
    }

    const order = opened.created;
    const intentRow = opened.intent;

    if (isComp) {
      // Una cortesía es inventario regalado: queda rastro del actor y el motivo.
      await this.audit.log({
        action: 'order.comp_issued',
        entityType: 'Order',
        entityId: order.id,
        organizationId: event.organizationId,
        userId: actor?.id ?? dto.actorUserId ?? userId,
        metadata: {
          publicId,
          channel,
          quantity: holds.length,
          reason: dto.compReason || 'house',
          actorRole: actor?.role ?? dto.actorRole ?? 'internal',
          cashierId,
        },
        ipAddress: dto.ipAddress,
      });
    }

    await this.quotas.consume(dto.eventId, channel, holds.length);

    // --- Paso 2: red, fuera de toda transacción. Una llamada HTTP dentro de
    // `$transaction` retiene una conexión del pool durante todo el viaje.
    if (asyncBanorte) {
      const intent = await banorte.createIntent({
        amount: totalAmount,
        currency: event.currency,
        orderId: order.id,
        channel: 'WEB',
        buyerEmail: dto.buyerEmail,
        buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
        metadata: { publicId: order.publicId },
        idempotencyKey,
      });

      await this.prisma.paymentIntent.update({
        where: { id: intentRow.id },
        data: {
          externalId: intent.externalId ?? intent.intentId,
          metadata: {
            ...intentMetadata,
            intentId: intent.intentId,
            ...(intent.metadata as object),
          },
        },
      });

      const full = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, event: true },
      });
      if (!full) throw new NotFoundException('Order not found');

      // OXXO y SPEI se pagan fuera de línea, horas o días después. El correo es
      // la única copia duradera de la referencia y de la fecha límite para
      // quien compra sin cuenta, así que va con la credencial en claro que
      // acabamos de generar: sin ella el enlace de la orden daría 403.
      if (isDeferredMethod(method)) {
        await this.afterSale(order.id, 'aviso de pago pendiente', () =>
          this.notifications.enqueuePaymentPending(order.id, dto.buyerEmail, {
            accessToken,
          }),
        );
      }

      return {
        ...full,
        accessToken,
        paymentAction: {
          gateway: 'BANORTE',
          intentId: intent.intentId,
          redirectUrl: intent.redirectUrl,
          reference: intent.reference,
          metadata: intent.metadata,
          status: 'PENDING_PAYMENT',
        },
      };
    }

    const intent = await provider.createIntent({
      amount: totalAmount,
      currency: event.currency,
      orderId: order.id,
      channel: channelType,
      buyerEmail: dto.buyerEmail,
      buyerName,
      paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO' | 'CASH',
      metadata: { publicId: order.publicId },
      idempotencyKey,
    });

    const capture = await provider.capture(intent.intentId, intent.externalId);
    if (!capture.success) {
      // No hubo cobro: orden e intent quedan FAILED para que ni el
      // reconciliador ni un reintento los reactiven.
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.FAILED },
        }),
        this.prisma.paymentIntent.update({
          where: { id: intentRow.id },
          data: { status: PaymentStatus.FAILED, externalId: intent.externalId ?? intent.intentId },
        }),
      ]);
      throw new BadRequestException(capture.error ?? 'Payment capture failed');
    }

    // --- Paso 3: liquidación, otra transacción corta.
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const payment = await tx.payment.create({
            data: {
              gateway: providerGateway,
              externalId: capture.externalId,
              status: PaymentStatus.COMPLETED,
              amount: totalAmount,
              currency: event.currency,
              method: payMethodEnum,
              processedAt: new Date(),
              metadata: { pricingRules: appliedRules as object[] },
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.COMPLETED,
              paymentId: payment.id,
              completedAt: new Date(),
            },
          });

          await tx.paymentIntent.update({
            where: { id: intentRow.id },
            data: { status: PaymentStatus.COMPLETED, externalId: capture.externalId },
          });

          const itemByOffer = new Map(order.items.map((i) => [i.offerId, i]));
          for (const line of pricedLines) {
            const orderItem = itemByOffer.get(line.offerId);
            if (!orderItem) continue;
            for (const hold of line.holds) {
              // El hold pudo caducar mientras el proveedor cobraba; el estado
              // del boleto es el guard real, así que aquí no se aborta.
              await tx.seatHold.updateMany({
                where: { id: hold.id, status: HoldStatus.ACTIVE },
                data: { status: HoldStatus.CONVERTED },
              });
              if (hold.seatId) {
                // Sin `status: HELD` en el where esto reescribía boletos ya
                // vendidos a otro comprador, borrándole el código (F1-02b).
                const claimed = await tx.ticket.updateMany({
                  where: {
                    eventId: dto.eventId,
                    seatId: hold.seatId,
                    status: TicketStatus.HELD,
                  },
                  data: {
                    status: TicketStatus.SOLD,
                    buyerEmail: dto.buyerEmail,
                    buyerName,
                    code: generateTicketCode(),
                    orderItemId: orderItem.id,
                  },
                });
                if (claimed.count !== 1) {
                  throw new ConflictException(
                    `El boleto del asiento ${hold.seatId} ya no está disponible`,
                  );
                }
              } else {
                await this.claimGeneralAdmissionTicket(tx, {
                  eventId: dto.eventId,
                  offerId: line.offerId,
                  orderItemId: orderItem.id,
                  buyerEmail: dto.buyerEmail,
                  buyerName,
                });
              }
            }
            await tx.offer.update({
              where: { id: line.offerId },
              data: {
                soldQuantity: { increment: line.quantity },
                remainingQuantity: { decrement: line.quantity },
              },
            });
          }
        },
        { timeout: DB_TX_TIMEOUT_MS },
      );
    } catch (e) {
      // El dinero ya está capturado: el intent se queda PENDING y este evento
      // es el rastro que necesita el reconciliador. Nunca cobro sin registro.
      await this.audit.log({
        action: 'order.settlement_failed',
        entityType: 'Order',
        entityId: order.id,
        organizationId: event.organizationId,
        userId,
        metadata: {
          publicId,
          channel,
          totalAmount,
          gateway: providerGateway,
          externalId: capture.externalId,
          reason: e instanceof Error ? e.message : String(e),
        },
        ipAddress: dto.ipAddress,
      });
      throw e;
    }

    await this.audit.log({
      action: 'order.completed',
      entityType: 'Order',
      entityId: order.id,
      organizationId: event.organizationId,
      userId,
      metadata: { publicId, channel, totalAmount, fraudScore: fraudResult.score },
      ipAddress: dto.ipAddress,
    });

    // El token en claro solo existe en esta petición (en BD queda su hash), y el
    // correo es el único sitio donde puede recibirlo quien compró sin cuenta:
    // sin él, el enlace a la orden le devuelve 403 y se queda sin boletos.
    await this.afterSale(order.id, 'correo de confirmación', () =>
      this.notifications.enqueueOrderConfirmation(order.id, dto.buyerEmail, buyerName, {
        accessToken,
      }),
    );

    if (dto.promotionCode) {
      await this.afterSale(order.id, 'registro de uso de promoción', () =>
        this.campaigns.recordPromotionUse(dto.eventId, dto.promotionCode!),
      );
    }

    const full = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: { items: { include: { tickets: true } }, payment: true, event: true },
    });
    if (!full) throw new NotFoundException('Order not found');
    return { ...full, accessToken };
  }

  /**
   * Toma un boleto GA que siga realmente HELD. `updateMany` no admite LIMIT,
   * así que se elige un candidato y se actualiza con el estado en el `where`:
   * si otra venta se adelantó el count es 0 y se prueba con otro.
   */
  private async claimGeneralAdmissionTicket(
    tx: Prisma.TransactionClient,
    params: {
      eventId: string;
      offerId: string;
      orderItemId: string;
      buyerEmail: string;
      buyerName: string;
    },
  ) {
    for (let attempt = 0; attempt < GA_CLAIM_ATTEMPTS; attempt++) {
      const candidate = await tx.ticket.findFirst({
        where: {
          eventId: params.eventId,
          offerId: params.offerId,
          status: TicketStatus.HELD,
        },
        select: { id: true },
      });
      if (!candidate) break;

      const claimed = await tx.ticket.updateMany({
        where: { id: candidate.id, status: TicketStatus.HELD },
        data: {
          status: TicketStatus.SOLD,
          buyerEmail: params.buyerEmail,
          buyerName: params.buyerName,
          code: generateTicketCode(),
          orderItemId: params.orderItemId,
        },
      });
      if (claimed.count === 1) return;
    }
    throw new ConflictException('Ya no hay boletos disponibles para esa oferta');
  }

  /** Rol efectivo del actor: el JWT solo trae `sub`, así que se lee de BD. */
  private async resolveActor(userId?: string) {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, active: true },
    });
    return user?.active ? user : null;
  }

  /** Reintento con la misma clave: devuelve la orden ya creada. */
  private async findByIdempotencyKey(key: string) {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: key },
    });
    if (!existing?.orderId) return null;
    return this.prisma.order.findUnique({
      where: { id: existing.orderId },
      include: { items: { include: { tickets: true } }, payment: true },
    });
  }

  private isIdempotencyConflict(e: unknown) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
    const target = e.meta?.target;
    return Array.isArray(target)
      ? target.includes('idempotencyKey')
      : String(target ?? '').includes('idempotencyKey');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Ejecuta un efecto posterior a la venta sin dejar que tumbe la venta.
   *
   * El cobro ya se hizo y los boletos ya están emitidos: si falla encolar un
   * correo, la respuesta correcta NO es un 500. Con Redis caído, `enqueue…`
   * lanzaba `MaxRetriesPerRequestError` y el comprador recibía «error» sobre una
   * compra que en realidad había prosperado — el peor resultado posible, porque
   * lo normal es que vuelva a intentarlo y pague dos veces.
   *
   * Se registra con el identificador de la orden para poder reenviar a mano.
   */
  private async afterSale(orderId: string, what: string, run: () => Promise<unknown>) {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Orden ${orderId} completada, pero falló «${what}»: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Group holds into offer lines (explicit items[] or legacy offerId + holdIds). */
  private async resolveOrderLines(dto: {
    eventId: string;
    offerId?: string;
    holdIds?: string[];
    items?: { offerId: string; holdIds: string[] }[];
  }) {
    const groups: {
      offerId: string;
      holdIds: string[];
      holds: Awaited<ReturnType<PrismaService['seatHold']['findMany']>>;
    }[] = [];

    if (dto.items?.length) {
      for (const item of dto.items) {
        if (!item.offerId || !item.holdIds?.length) continue;
        const holds = await this.prisma.seatHold.findMany({
          where: {
            id: { in: item.holdIds },
            eventId: dto.eventId,
            status: HoldStatus.ACTIVE,
            expiresAt: { gt: new Date() },
          },
        });
        if (holds.length !== item.holdIds.length) {
          throw new BadRequestException('Invalid or expired holds');
        }
        for (const hold of holds) {
          const offerId = await this.offerIdForHold(hold, item.offerId);
          if (offerId !== item.offerId) {
            throw new BadRequestException('Hold/offer mismatch');
          }
        }
        groups.push({ offerId: item.offerId, holdIds: item.holdIds, holds });
      }
      return groups;
    }

    const flatIds = dto.holdIds ?? [];
    if (!flatIds.length) throw new BadRequestException('holdIds or items required');
    const holds = await this.prisma.seatHold.findMany({
      where: {
        id: { in: flatIds },
        eventId: dto.eventId,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });
    if (holds.length !== flatIds.length) {
      throw new BadRequestException('Invalid or expired holds');
    }

    const byOffer = new Map<string, typeof holds>();
    for (const hold of holds) {
      const offerId = await this.offerIdForHold(hold, dto.offerId);
      if (!offerId) throw new BadRequestException('Could not resolve offer for hold');
      const list = byOffer.get(offerId) ?? [];
      list.push(hold);
      byOffer.set(offerId, list);
    }
    for (const [offerId, list] of byOffer) {
      groups.push({ offerId, holdIds: list.map((h) => h.id), holds: list });
    }
    return groups;
  }

  private async offerIdForHold(
    hold: { seatId: string | null; offerId: string | null },
    fallback?: string,
  ) {
    if (hold.offerId) return hold.offerId;
    if (hold.seatId) {
      const ticket = await this.prisma.ticket.findFirst({
        where: { seatId: hold.seatId },
        select: { offerId: true },
      });
      if (ticket?.offerId) return ticket.offerId;
    }
    return fallback;
  }

  /** Lectura cruda para uso interno: NO autoriza. Fuera usa `getForRequester`. */
  async getByPublicId(publicId: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      include: {
        items: {
          include: {
            tickets: true,
            offer: { select: { id: true, name: true, zone: true, basePrice: true } },
          },
        },
        event: {
          include: {
            venue: { select: { name: true, city: true, address: true } },
          },
        },
        payment: true,
        // El comprador necesita ver su reembolso: importe, estado y desde
        // cuándo corre el plazo. Sin esto la interfaz solo puede mostrar un
        // mensaje genérico derivado del estado de la orden.
        //
        // Se seleccionan campos, NO el modelo entero: `requestedBy` y
        // `processedBy` identifican a personal interno y no salen nunca de
        // aquí. `notes` sí se lee, pero no se publica en crudo: pasa por
        // `buyerVisibleRefundNote` más abajo.
        //
        // Ascendente a propósito: quien consume esto toma la ÚLTIMA fila como
        // la que manda. En descendente esa posición la ocupa la más antigua y
        // el plazo se calcularía desde la fecha equivocada.
        refunds: {
          select: {
            id: true,
            amount: true,
            reason: true,
            status: true,
            notes: true,
            requestedAt: true,
            processedAt: true,
          },
          orderBy: { requestedAt: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const pendingIntent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      ...order,
      refunds: order.refunds.map(toBuyerRefund),
      pendingPayment: pendingIntent
        ? {
            reference: pendingIntent.externalId,
            status: pendingIntent.status,
            metadata: pendingIntent.metadata,
          }
        : null,
    };
  }

  /**
   * Vista completa (PII del comprador incluida) para quien acredite acceso.
   * El `publicId` por sí solo dejó de ser credencial (F2-01).
   */
  async getForRequester(publicId: string, requester: OrderRequester) {
    const order = await this.getByPublicId(publicId);
    await this.assertOrderAccess(order, requester);
    // El token nunca vuelve en una lectura: solo se entregó al crear la orden.
    const { accessTokenHash: _hash, accessTokenAt: _issuedAt, ...safe } = order;
    return safe;
  }

  /**
   * Sondeo público del checkout: solo lo justo para saber si ya se pagó.
   * Sin importes ni método de pago, que es PII de la compra.
   */
  async getStatus(publicId: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        status: true,
        completedAt: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Concede acceso al dueño de la orden, al correo del comprador o a quien
   * presente el token de acceso vigente que se envió por correo.
   */
  private async assertOrderAccess(
    order: {
      userId: string | null;
      buyerEmail: string;
      accessTokenHash: string | null;
      accessTokenAt: Date | null;
    },
    requester: OrderRequester,
  ) {
    if (requester.userId && order.userId === requester.userId) return;

    let email = requester.email;
    if (!email && requester.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: requester.userId },
        select: { email: true },
      });
      email = user?.email;
    }
    if (email && email.toLowerCase() === order.buyerEmail.toLowerCase()) return;

    if (requester.accessToken && order.accessTokenHash && order.accessTokenAt) {
      const fresh = Date.now() - order.accessTokenAt.getTime() < ACCESS_TOKEN_TTL_MS;
      if (fresh && this.tokenMatches(requester.accessToken, order.accessTokenHash)) return;
    }

    throw new ForbiddenException('No tienes acceso a esta orden');
  }

  private tokenMatches(token: string, expectedHash: string) {
    const digest = Buffer.from(this.hashToken(token));
    const expected = Buffer.from(expectedHash);
    return digest.length === expected.length && timingSafeEqual(digest, expected);
  }

  async listForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const orders = await this.prisma.order.findMany({
      where: user
        ? { OR: [{ userId }, { buyerEmail: user.email }] }
        : { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startsAt: true,
            // «Mis boletos» tiene que poder avisar de un evento cancelado sin
            // que el comprador entre orden por orden.
            status: true,
            cancelledAt: true,
            cancellationReason: true,
            venue: { select: { name: true, city: true } },
          },
        },
        // Mismo criterio y mismo orden que el detalle: solo lo que es del
        // comprador, con la nota recortada, y ascendente para que la última
        // fila sea de verdad la más reciente.
        //
        // Con esto «Mis boletos» puede decir el importe devuelto —y separar la
        // bonificación— en vez de enseñar el total de la orden, que en una
        // devolución parcial es sencillamente otra cifra.
        refunds: {
          select: {
            id: true,
            amount: true,
            reason: true,
            status: true,
            notes: true,
            requestedAt: true,
            processedAt: true,
          },
          orderBy: { requestedAt: 'asc' },
        },
        items: {
          select: {
            quantity: true,
            tickets: {
              select: {
                id: true,
                code: true,
                status: true,
                section: true,
                row: true,
                seatNumber: true,
              },
            },
          },
        },
      },
    });
    return orders.map((order) => ({ ...order, refunds: order.refunds.map(toBuyerRefund) }));
  }

  async getQrCodesForOrder(publicId: string, requester: OrderRequester) {
    const order = await this.getByPublicId(publicId);
    // Los QR son la credencial de entrada: mismo control que la orden.
    await this.assertOrderAccess(order, requester);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    // Única fuente de la clave de firma; en producción exige TICKET_QR_SECRET
    // propio, igual que el escáner que va a verificar estos QR.
    const secret = requireTicketQrSecret();
    const tickets = order.items.flatMap((i) => i.tickets);
    const mapped = await Promise.all(
      tickets.map(async (t) => {
        const qrPayload = buildQrPayload(t.id, order.eventId, secret);
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1 });
        return { id: t.id, code: t.code, qrPayload, qrDataUrl };
      }),
    );
    return {
      publicId: order.publicId,
      eventTitle: order.event.title,
      tickets: mapped,
    };
  }

  async buildTicketsPdf(publicId: string, requester: OrderRequester): Promise<Buffer> {
    const order = await this.getByPublicId(publicId);
    await this.assertOrderAccess(order, requester);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    const tickets = order.items.flatMap((i) =>
      i.tickets.map((t) => ({
        id: t.id,
        code: t.code,
        section: t.section,
        row: t.row,
        seatNumber: t.seatNumber,
      })),
    );
    return this.ticketPdf.buildPdfBuffer({
      eventTitle: order.event.title,
      publicId: order.publicId,
      buyerName: order.buyerName,
      eventId: order.eventId,
      tickets,
    });
  }

  async requestCfdiForBuyer(
    publicId: string,
    userId: string,
    data: { receptorRfc: string; receptorNombre: string; receptorUsoCfdi?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User required');
    const order = await this.getByPublicId(publicId);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    const owns =
      order.userId === userId ||
      order.buyerEmail.toLowerCase() === user.email.toLowerCase();
    if (!owns) throw new BadRequestException('Not your order');

    return this.billing.stampOrderInvoice(order.organizationId, {
      orderId: order.id,
      receptorRfc: data.receptorRfc,
      receptorNombre: data.receptorNombre,
      receptorUsoCfdi: data.receptorUsoCfdi,
    });
  }
}


