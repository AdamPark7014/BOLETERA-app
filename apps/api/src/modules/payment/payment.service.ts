import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  OrderStatus,
  RefundReason,
  RefundStatus,
  TicketStatus,
  HoldStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  getProvider,
  initDefaultProviders,
  BanorteProvider,
  getBanorteConfig,
  getBanorteIpnEndpoints,
  validateBanorteProductionConfig,
} from '@boletera/payments';
import { generateTicketCode } from '@boletera/crypto';
import { paymentDeadline } from '../../common/payment-window';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { NotificationService } from '../notification/notification.service';

initDefaultProviders();

/**
 * Tolerancia al comparar importes (un centavo).
 *
 * Se exporta para que cualquier lectura que contraste COBRADO vs. ESPERADO
 * (la tabla de órdenes del admin, la conciliación) use exactamente el mismo
 * umbral que la emisión: si difirieran, la pantalla marcaría descuadres que el
 * motor considera cuadrados, y al revés.
 */
export const SETTLEMENT_TOLERANCE = 0.01;

/**
 * Vigencia del intent por método de pago.
 *
 * Sin una fecha límite escrita en el intent nadie sabía, al llegar el abono, si
 * la reserva seguía viva (F1-03). `PaymentIntent.expiresAt` existía en el
 * esquema y jamás se escribía.
 *
 * La ventana vive en `common/payment-window.ts` porque tiene que ser LA MISMA
 * que gobierna el hold de butaca y la caducidad de la orden: si el intent dura
 * más que el hold, le prometemos al comprador un plazo que el inventario no
 * respeta, y cada pago tardío se convierte en una devolución.
 */

type SettlementBlockAction =
  | 'payment.late_settlement'
  | 'payment.settlement_mismatch'
  | 'order.insufficient_inventory';

/**
 * El dinero entró pero NO se puede emitir.
 *
 * Se lanza dentro de la transacción de `completeOrder` para abortarla: la orden
 * queda intacta (sin boletos, sin Payment) y el manejador externo la marca
 * PENDING_REFUND y audita el motivo. Marcar la orden dentro de la misma
 * transacción sería inútil: el rollback borraría también esa marca.
 */
class SettlementBlockedError extends Error {
  constructor(
    readonly action: SettlementBlockAction,
    message: string,
    readonly metadata: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SettlementBlockedError';
  }
}

/**
 * Modo estricto de conciliación de importes.
 *
 * DELIBERADO: por defecto (`PAYMENT_STRICT_SETTLEMENT` ausente o 'false') un
 * descuadre se audita y la venta continúa. Los nombres reales de los campos de
 * importe del IPN Banorte (IMPORTE / MONEDA / …) dependen del manual Payworks de
 * cada afiliación; hasta confirmarlos contra tráfico real, bloquear por defecto
 * convertiría un simple campo mal nombrado (importe `undefined` → 0) en una
 * caída total de la venta. Una vez validados los campos, poner la variable en
 * 'true' para que el descuadre bloquee la emisión.
 */
function isStrictSettlementMode(): boolean {
  return process.env.PAYMENT_STRICT_SETTLEMENT === 'true';
}

@Injectable()
export class PaymentService {
  private logger = new Logger(PaymentService.name);
  private banorte = getProvider('banorte') as BanorteProvider;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
    private campaigns: CampaignExecutionService,
  ) {}

  /**
   * `amount` y `currency` del cuerpo se IGNORAN a propósito (F1-06): el importe
   * a cobrar es siempre `Order.totalAmount` de la base. Antes el cliente elegía
   * cuánto pagar por su propia orden. Se mantienen en la firma solo para no
   * romper a los llamadores existentes.
   */
  async createPaymentIntent(data: {
    orderId: string;
    /** @deprecated ignorado: se usa Order.totalAmount */
    amount?: number;
    /** @deprecated ignorado: se usa Order.currency */
    currency?: string;
    buyerEmail: string;
    buyerName: string;
    paymentMethod?: string;
    publicId?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { event: true },
    });
    if (!order) throw new BadRequestException('Order not found');
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order must be PENDING');
    }

    const amount = Number(order.totalAmount);
    if (data.amount !== undefined && Math.abs(Number(data.amount) - amount) > SETTLEMENT_TOLERANCE) {
      this.logger.warn(
        `Intent ${order.publicId}: el cliente pidió cobrar ${data.amount} y la orden vale ${amount}; se cobra el total de la orden.`,
      );
    }

    const method = (data.paymentMethod ?? order.paymentMethod ?? 'CARD').toUpperCase();
    const intent = await this.banorte.createIntent({
      amount,
      currency: order.currency,
      orderId: data.orderId,
      channel: 'WEB',
      buyerEmail: data.buyerEmail,
      buyerName: data.buyerName,
      paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
      metadata: { publicId: data.publicId ?? order.publicId },
    });

    const expiresAt = paymentDeadline(method);

    await this.prisma.paymentIntent.create({
      data: {
        orderId: data.orderId,
        provider: PaymentGateway.BANORTE,
        externalId: intent.externalId ?? intent.intentId,
        amount,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        channel: order.channel,
        expiresAt,
        metadata: { intentId: intent.intentId, ...(intent.metadata as object) },
      },
    });

    return {
      intentId: intent.intentId,
      status: intent.status,
      redirectUrl: intent.redirectUrl,
      reference: intent.reference,
      metadata: intent.metadata,
      amount,
      currency: order.currency,
      expiresAt,
      gateway: 'BANORTE',
      settlement: 'Cuenta Banorte del comercio',
    };
  }

  /**
   * Confirmación manual (solo demo/desarrollo).
   *
   * F1-06: `cfg.isDemo` es simplemente `!BANORTE_MERCHANT_ID`; un secreto mal
   * inyectado en el despliegue activaba el modo demo en producción y esta ruta
   * completaba órdenes sin cobro. La barrera es ahora NODE_ENV, evaluada ANTES
   * de mirar la configuración del gateway.
   */
  async confirmBanortePayment(data: {
    orderId: string;
    intentId?: string;
    externalId?: string;
  }) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'La confirmación manual está deshabilitada en producción: el pago se confirma por IPN Banorte.',
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { items: true, event: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.COMPLETED) {
      return { order, alreadyCompleted: true };
    }

    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return this.completeOrder(
        order.id,
        data.externalId ?? data.intentId ?? `banorte_demo_${order.id}`,
        // En demo no hay liquidación real: se asume el total de la orden.
        { amount: Number(order.totalAmount), currency: order.currency, source: 'demo_confirm' },
      );
    }

    throw new BadRequestException(
      'En producción la confirmación llega vía IPN Banorte (webhook).',
    );
  }

  /** Descripción del descuadre entre lo cobrado y lo debido, o `null` si cuadra. */
  private describeSettlementMismatch(
    orderCurrency: string,
    expectedAmount: number,
    settlement: { amount?: number; currency?: string },
  ): string | null {
    if (
      settlement.amount !== undefined &&
      Math.abs(settlement.amount - expectedAmount) > SETTLEMENT_TOLERANCE
    ) {
      return `importe liquidado ${settlement.amount} ≠ total de la orden ${expectedAmount}`;
    }
    if (settlement.currency && settlement.currency !== orderCurrency) {
      return `moneda liquidada ${settlement.currency} ≠ moneda de la orden ${orderCurrency}`;
    }
    return null;
  }

  /**
   * Deja la orden en PENDING_REFUND y audita por qué no se pudo emitir.
   *
   * Se ejecuta FUERA de la transacción de `completeOrder` (que ya hizo rollback):
   * el cobro existe en Banorte pero no hay boletos, así que la orden tiene que
   * quedar marcada para devolución manual y el motivo tiene que sobrevivir.
   */
  private async markOrderPendingRefund(
    orderId: string,
    externalId: string,
    blocked: SettlementBlockedError,
  ) {
    try {
      const order = await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PENDING_REFUND },
        select: { id: true, publicId: true, organizationId: true },
      });
      await this.prisma.auditEvent.create({
        data: {
          action: blocked.action,
          entityType: 'Order',
          entityId: order.id,
          organizationId: order.organizationId,
          metadata: {
            ...blocked.metadata,
            externalId,
            message: blocked.message,
            markedAt: new Date().toISOString(),
          },
        },
      });
      this.logger.error(`[${blocked.action}] ${blocked.message}`);
    } catch (e) {
      // Nunca tapar el motivo original con un fallo al auditar.
      this.logger.error(
        `No se pudo marcar PENDING_REFUND la orden ${orderId} tras ${blocked.action}: ${e}`,
      );
    }
  }

  /**
   * Emite los boletos de una orden pagada.
   *
   * `settlement` es lo que el banco declara haber cobrado. Si no cuadra con
   * `Order.totalAmount`, o si la reserva ya no está viva, o si el inventario
   * reservado desapareció, NO se emite nada: la orden queda PENDING_REFUND.
   */
  async completeOrder(
    orderId: string,
    externalId: string,
    settlement: {
      amount?: number;
      currency?: string;
      rawCode?: string;
      source?: string;
    } = {},
  ) {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { items: { include: { offer: true } }, event: true },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.status === OrderStatus.COMPLETED) {
          return {
            order,
            payment: await tx.payment.findFirst({ where: { id: order.paymentId ?? '' } }),
            tickets: [],
            alreadyCompleted: true,
          };
        }
        /*
         * Solo se completa lo que sigue esperando pago. REFUNDED, CANCELLED o
         * PENDING_REFUND son terminales: un abono posterior es dinero a devolver,
         * nunca una emisión.
         */
        if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.FAILED) {
          throw new ConflictException(
            `La orden ${order.publicId} está en estado ${order.status}; un pago posterior requiere devolución, no emisión.`,
          );
        }

        // --- F1-05: lo cobrado contra lo debido -------------------------------
        const expectedAmount = Number(order.totalAmount);
        const mismatch = this.describeSettlementMismatch(
          order.currency,
          expectedAmount,
          settlement,
        );
        if (mismatch) {
          const detail = {
            orderPublicId: order.publicId,
            reason: mismatch,
            expectedAmount,
            settledAmount: settlement.amount ?? null,
            expectedCurrency: order.currency,
            settledCurrency: settlement.currency ?? null,
            rawCode: settlement.rawCode ?? null,
            source: settlement.source ?? 'unknown',
          };
          if (isStrictSettlementMode()) {
            throw new SettlementBlockedError(
              'payment.settlement_mismatch',
              `Descuadre de liquidación en ${order.publicId}: ${mismatch}. No se emiten boletos; requiere devolución.`,
              detail,
            );
          }
          // Modo observación: se audita y la venta continúa (ver isStrictSettlementMode).
          this.logger.error(
            `Descuadre de liquidación (modo observación) en ${order.publicId}: ${mismatch}`,
          );
          await tx.auditEvent.create({
            data: {
              action: 'payment.settlement_mismatch',
              entityType: 'Order',
              entityId: order.id,
              organizationId: order.organizationId,
              metadata: { ...detail, externalId, observationMode: true },
            },
          });
        }

        const intents = await tx.paymentIntent.findMany({
          where: { orderId },
          orderBy: { createdAt: 'desc' },
        });
        /*
         * La reserva vive en el intent que creó la orden. Un intent posterior
         * (POST /payments/intents al reintentar el pago) no repite `holdIds`, así
         * que quedarse con el más reciente perdería las reservas y bloquearía una
         * venta legítima; se busca el más reciente que sí las traiga.
         */
        const intentWithHolds = intents.find((i) => {
          const meta = i.metadata as Record<string, unknown> | null;
          return Array.isArray(meta?.holdIds) && (meta.holdIds as string[]).length > 0;
        });
        const pendingIntent = intentWithHolds ?? intents[0];
        const intentMeta = (pendingIntent?.metadata as Record<string, unknown>) ?? {};
        const holdIds = Array.isArray(intentMeta.holdIds) ? (intentMeta.holdIds as string[]) : [];
        const metaItems = Array.isArray(intentMeta.items)
          ? (intentMeta.items as { offerId: string; holdIds: string[] }[])
          : [];
        const holdToOffer = new Map<string, string>();
        for (const item of metaItems) {
          for (const hid of item.holdIds ?? []) holdToOffer.set(hid, item.offerId);
        }

        // --- F1-03: solo se emite contra reservas VIVAS -----------------------
        const holds = holdIds.length
          ? await tx.seatHold.findMany({
              where: {
                id: { in: holdIds },
                eventId: order.eventId,
                status: HoldStatus.ACTIVE,
              },
            })
          : [];
        if (holds.length !== holdIds.length) {
          const alive = new Set(holds.map((h) => h.id));
          throw new SettlementBlockedError(
            'payment.late_settlement',
            `Pago tardío en ${order.publicId}: ${holdIds.length - holds.length} de ${holdIds.length} ` +
              `reservas ya no están activas (la referencia OXXO/SPEI sobrevive al hold de 15 min y el lugar ` +
              `pudo revenderse). No se emiten boletos; el cobro debe devolverse.`,
            {
              orderPublicId: order.publicId,
              expectedHolds: holdIds.length,
              activeHolds: holds.length,
              lostHoldIds: holdIds.filter((id) => !alive.has(id)),
              intentExpiresAt: pendingIntent?.expiresAt ?? null,
              settledAmount: settlement.amount ?? null,
            },
          );
        }

        /*
         * F1-05: el Payment guarda el importe LIQUIDADO. Antes guardaba
         * `order.totalAmount` (el esperado), de modo que ningún informe podía
         * detectar un cobro parcial: el sistema siempre "cuadraba" consigo mismo.
         */
        const payment = await tx.payment.create({
          data: {
            gateway: PaymentGateway.BANORTE,
            externalId,
            status: PaymentStatus.COMPLETED,
            amount: settlement.amount ?? expectedAmount,
            currency: order.currency,
            method: order.paymentMethod,
            processedAt: new Date(),
            metadata: {
              source: settlement.source ?? 'banorte_direct',
              expectedAmount,
              settledAmount: settlement.amount ?? null,
              settlementAmountKnown: settlement.amount !== undefined,
              settledCurrency: settlement.currency ?? null,
              rawCode: settlement.rawCode ?? null,
              settlementMismatch: mismatch,
            },
          },
        });

        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.COMPLETED,
            paymentId: payment.id,
            completedAt: new Date(),
          },
          include: { items: true },
        });

        const itemByOffer = new Map(updatedOrder.items.map((i) => [i.offerId, i]));

        for (const hold of holds) {
          await tx.seatHold.update({
            where: { id: hold.id },
            data: { status: HoldStatus.CONVERTED },
          });
          let offerId = holdToOffer.get(hold.id) || hold.offerId || undefined;
          if (!offerId && hold.seatId) {
            const ticket = await tx.ticket.findFirst({
              where: { eventId: order.eventId, seatId: hold.seatId },
              select: { offerId: true },
            });
            offerId = ticket?.offerId;
          }
          if (!offerId) {
            // Sin oferta no se sabe qué boleto emitir ni qué contador ajustar.
            throw new SettlementBlockedError(
              'order.insufficient_inventory',
              `No se pudo determinar la oferta de la reserva ${hold.id} en ${order.publicId}. No se emite; el cobro debe devolverse.`,
              { orderPublicId: order.publicId, holdId: hold.id, seatId: hold.seatId ?? null },
            );
          }
          const orderItem = itemByOffer.get(offerId) ?? updatedOrder.items[0];

          if (hold.seatId) {
            /*
             * F1-02(b): el `updateMany` no filtraba por estado, así que reasignaba
             * un asiento ya SOLD a otro comprador. Ahora solo convierte lo que
             * sigue HELD y comprueba que efectivamente cambió una fila.
             */
            const assigned = await tx.ticket.updateMany({
              where: {
                eventId: order.eventId,
                seatId: hold.seatId,
                status: TicketStatus.HELD,
              },
              data: {
                status: TicketStatus.SOLD,
                buyerEmail: order.buyerEmail,
                buyerName: order.buyerName,
                code: generateTicketCode(),
                orderItemId: orderItem?.id,
              },
            });
            if (assigned.count !== 1) {
              throw new SettlementBlockedError(
                'order.insufficient_inventory',
                `El asiento reservado en ${order.publicId} ya no está disponible (${assigned.count} boletos HELD para el asiento). No se emite; el cobro debe devolverse.`,
                {
                  orderPublicId: order.publicId,
                  holdId: hold.id,
                  seatId: hold.seatId,
                  matchedTickets: assigned.count,
                },
              );
            }
          } else {
            const available = await tx.ticket.findFirst({
              where: { eventId: order.eventId, offerId, status: TicketStatus.HELD },
            });
            if (!available) {
              throw new SettlementBlockedError(
                'order.insufficient_inventory',
                `No queda inventario reservado para la oferta ${offerId} en ${order.publicId}. No se emite; el cobro debe devolverse.`,
                { orderPublicId: order.publicId, holdId: hold.id, offerId },
              );
            }
            await tx.ticket.update({
              where: { id: available.id },
              data: {
                status: TicketStatus.SOLD,
                buyerEmail: order.buyerEmail,
                buyerName: order.buyerName,
                code: generateTicketCode(),
                orderItemId: orderItem?.id,
              },
            });
          }

          await tx.offer.update({
            where: { id: offerId },
            data: {
              soldQuantity: { increment: 1 },
              remainingQuantity: { decrement: 1 },
            },
          });
        }

        /*
         * F1-02(c): aquí se ACUÑABAN boletos para cubrir el hueco entre lo
         * vendido y lo reservado, sin mirar `remainingQuantity`. Un pago tardío
         * sin reservas vivas generaba boletos de la nada y dejaba el contador en
         * negativo. Ahora un hueco es motivo de devolución, no de emisión.
         */
        for (const item of updatedOrder.items) {
          const issued = await tx.ticket.count({
            where: { orderItemId: item.id, status: TicketStatus.SOLD },
          });
          if (issued < item.quantity) {
            throw new SettlementBlockedError(
              'order.insufficient_inventory',
              `La orden ${order.publicId} pagó ${item.quantity} boletos de la oferta ${item.offerId} pero solo hay ${issued} reservados. No se emite inventario que no estaba reservado; el cobro debe devolverse.`,
              {
                orderPublicId: order.publicId,
                orderItemId: item.id,
                offerId: item.offerId,
                requestedQuantity: item.quantity,
                issuedQuantity: issued,
              },
            );
          }
        }

        // Se cierran todos los intents vivos de la orden, no solo el último.
        await tx.paymentIntent.updateMany({
          where: { orderId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.COMPLETED },
        });

        const tickets = await tx.ticket.findMany({
          where: { orderItemId: { in: updatedOrder.items.map((i) => i.id) } },
        });

        this.logger.log(`Banorte: order ${orderId} completed, ${tickets.length} tickets`);
        return { order: updatedOrder, payment, tickets, alreadyCompleted: false };
      })
      .catch(async (error: unknown): Promise<never> => {
        if (error instanceof SettlementBlockedError) {
          await this.markOrderPendingRefund(orderId, externalId, error);
          throw new ConflictException(error.message);
        }
        throw error;
      });

    // Reintento idempotente del IPN: no se reenvía la confirmación al comprador.
    if (result.alreadyCompleted) return result;

    await this.notifications.enqueueOrderConfirmation(
      result.order.id,
      result.order.buyerEmail,
      result.order.buyerName,
    );
    if (result.order.promotionId) {
      const promo = await this.prisma.promotion.findUnique({
        where: { id: result.order.promotionId },
      });
      if (promo) {
        await this.campaigns.recordPromotionUse(result.order.eventId, promo.code);
      }
    }
    return result;
  }

  async createRefund(data: {
    orderId: string;
    reason: string;
    amount?: number;
    notes?: string;
    requestedBy?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { payment: true },
    });
    if (!order?.payment) throw new BadRequestException('No payment found');
    if (
      order.status !== OrderStatus.COMPLETED &&
      order.status !== OrderStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException('Only completed orders can be refunded');
    }

    /*
     * Se devuelve lo COBRADO, no lo facturado. Desde F1-05 `Payment.amount` es
     * el importe liquidado por el banco y puede diferir de `Order.totalAmount`
     * (cobro parcial detectado en modo observación); devolver el total en ese
     * caso regalaría la diferencia.
     */
    const chargedAmount = Number(order.payment.amount);
    const refundAmount = data.amount ?? chargedAmount;
    const result = await this.banorte.refund(order.payment.externalId, refundAmount);
    const requestedBy = data.requestedBy ?? 'admin';

    const refund = await this.prisma.refund.create({
      data: {
        orderId: data.orderId,
        amount: refundAmount,
        reason: 'CUSTOMER_REQUEST',
        status: result.success ? 'COMPLETED' : 'PENDING',
        requestedBy,
        processedAt: result.success ? new Date() : undefined,
        notes:
          data.notes ||
          result.error ||
          (result.success
            ? 'Refund completed via Banorte'
            : 'Pending manual Banorte portal refund — call POST /payments/refunds/:id/complete when done'),
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        action: result.success ? 'REFUND_COMPLETED' : 'REFUND_REQUESTED',
        entityType: 'Refund',
        entityId: refund.id,
        organizationId: order.organizationId,
        metadata: {
          orderId: order.id,
          amount: refundAmount,
          banorteSuccess: result.success,
          banorteError: result.error,
          requestedBy,
        },
      },
    });

    if (result.success) {
      // "Completa" es respecto de lo cobrado: es lo que libera el inventario.
      const fullRefund = refundAmount >= chargedAmount;
      await this.applyRefundInventory(order.id, fullRefund);
      // Avisar al comprador NO era opcional y no lo hacía nadie: se le
      // devolvía el dinero y se le anulaban los boletos en silencio.
      await this.notifyRefund(order.id, order.buyerEmail, refundAmount, {
        reason: data.reason,
        partial: !fullRefund,
      });
    }

    return {
      refund,
      banorte: result,
      nextStep: result.success
        ? null
        : 'Process refund in Banorte portal, then POST /api/v1/payments/refunds/' +
          refund.id +
          '/complete',
    };
  }

  /** After staff completes Banorte portal refund, finalize order + inventory. */
  async completeManualRefund(
    refundId: string,
    processedBy: string,
    banorteReference?: string,
  ) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        order: {
          include: { payment: true, refunds: { select: { id: true, amount: true, status: true } } },
        },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status === 'COMPLETED') {
      return { refund, alreadyCompleted: true };
    }

    /*
     * "Completo" se mide contra lo COBRADO (`Payment.amount`), no contra
     * `Order.totalAmount`: desde F1-05 pueden diferir y comparar con el total
     * facturado dejaba sin liberar el inventario de una devolución que sí era
     * total. Y se suman los reembolsos ya comprometidos de la misma orden: dos
     * parciales que juntos cubren el cobro también liberan butacas.
     */
    const charged = refund.order.payment
      ? new Decimal(refund.order.payment.amount)
      : new Decimal(refund.order.totalAmount);
    const { committed } = this.refundableAmount(
      charged,
      refund.order.refunds.filter((r) => r.id !== refundId),
    );
    const full = committed
      .plus(refund.amount)
      .greaterThanOrEqualTo(charged.minus(SETTLEMENT_TOLERANCE));
    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'COMPLETED',
        processedBy,
        processedAt: new Date(),
        notes: [refund.notes, banorteReference ? `Banorte ref: ${banorteReference}` : null]
          .filter(Boolean)
          .join(' | '),
      },
    });

    await this.applyRefundInventory(refund.orderId, full);

    await this.notifyRefund(refund.orderId, refund.order.buyerEmail, Number(refund.amount), {
      reason: banorteReference ? `Banorte ref: ${banorteReference}` : undefined,
      partial: !full,
    });

    await this.prisma.auditEvent.create({
      data: {
        action: 'REFUND_MANUAL_COMPLETED',
        entityType: 'Refund',
        entityId: refundId,
        organizationId: refund.order.organizationId,
        metadata: { processedBy, banorteReference },
      },
    });

    return { refund: updated, inventoryReleased: true };
  }

  /**
   * Aviso de reembolso al comprador.
   *
   * Se aísla en su propio try/catch a propósito: el dinero ya se devolvió y el
   * inventario ya se liberó. Un SMTP caído no puede revertir eso ni propagar un
   * 500 al operador que acaba de procesar la devolución; queda en el log y en
   * la cola de fallidos de Bull.
   */
  private async notifyRefund(
    orderId: string,
    buyerEmail: string,
    amount: number,
    options?: { reason?: string; partial?: boolean },
  ) {
    try {
      await this.notifications.enqueueRefundNotification(orderId, buyerEmail, amount, options);
    } catch (error) {
      this.logger.error(
        `Reembolso ${orderId} procesado pero no se pudo encolar el aviso al comprador: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Devuelve el inventario de una orden reembolsada por completo.
   *
   * IDEMPOTENTE a propósito: la liberación desengancha el boleto de su
   * `orderItem` (`orderItemId: null`), así que una segunda pasada no encuentra
   * filas y no vuelve a mover contadores. Y los contadores de la oferta se
   * ajustan con las filas REALMENTE liberadas, no con `item.quantity`: si por
   * cualquier motivo se emitieron menos boletos de los comprados, descontar la
   * cantidad comprada dejaría `soldQuantity` en negativo y regalaría aforo.
   *
   * Un reembolso PARCIAL no libera nada: no sabemos qué butaca concreta
   * corresponde a la fracción devuelta. Solo cambia el estado de la orden.
   */
  private async applyRefundInventory(orderId: string, fullRefund: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: fullRefund ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED,
          refundedAt: new Date(),
        },
      });

      if (!fullRefund) return;

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { id: true, offerId: true, quantity: true },
      });

      for (const item of items) {
        const released = await tx.ticket.updateMany({
          where: { orderItemId: item.id },
          data: {
            status: TicketStatus.AVAILABLE,
            orderItemId: null,
            buyerName: null,
            buyerEmail: null,
            checkedInAt: null,
            usedAt: null,
          },
        });
        if (released.count === 0) continue;
        await tx.offer.update({
          where: { id: item.offerId },
          data: {
            soldQuantity: { decrement: released.count },
            remainingQuantity: { increment: released.count },
          },
        });
      }

      await tx.paymentIntent.updateMany({
        where: { orderId, status: { in: [PaymentStatus.PENDING, PaymentStatus.COMPLETED] } },
        data: { status: PaymentStatus.REFUNDED },
      });
    });
  }

  /**
   * Lo que queda por devolver de una orden.
   *
   * Se calcula sobre `Payment.amount` (lo REALMENTE liquidado por el banco), no
   * sobre `Order.totalAmount` (lo esperado). Desde F1-05 pueden diferir: si el
   * banco liquidó de menos y devolviéramos el total facturado, estaríamos
   * regalando la diferencia. Los reembolsos PENDING también cuentan: están
   * comprometidos aunque el portal Banorte aún no los haya cerrado.
   */
  private refundableAmount(
    charged: Decimal,
    refunds: { amount: Decimal; status: RefundStatus }[],
  ) {
    const committed = refunds
      .filter((r) => r.status === RefundStatus.COMPLETED || r.status === RefundStatus.PENDING)
      .reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
    return { committed, remaining: charged.minus(committed) };
  }

  /**
   * Asienta un reembolso YA liquidado fuera del gateway (portal Banorte, caja de
   * taquilla, contracargo aceptado) y libera el inventario.
   *
   * Existe porque `admin.service.manualRefund` creaba el `Refund`, marcaba la
   * orden REFUNDED y ahí acababa: los boletos se quedaban SOLD para siempre y
   * esas butacas no se volvían a vender nunca. Toda ruta de reembolso —
   * gateway, portal manual o asiento contable — pasa ahora por
   * `applyRefundInventory`.
   *
   * No llama a Banorte: el dinero ya salió por otro medio. Para disparar la
   * devolución en el gateway use `createRefund`.
   */
  async recordSettledRefund(data: {
    orderId: string;
    amount?: number;
    reason?: RefundReason;
    notes?: string;
    requestedBy: string;
    /** Si viene, la orden debe pertenecer a esa organización (aislamiento multi-tenant). */
    organizationId?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { payment: true, refunds: { select: { amount: true, status: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    // Mismo 404 que "no existe": no se confirma la existencia de órdenes ajenas.
    if (data.organizationId && order.organizationId !== data.organizationId) {
      throw new NotFoundException('Order not found');
    }
    if (!order.payment) {
      throw new BadRequestException('La orden no tiene cobro asentado: no hay nada que devolver');
    }
    if (
      order.status !== OrderStatus.COMPLETED &&
      order.status !== OrderStatus.PARTIALLY_REFUNDED &&
      order.status !== OrderStatus.PENDING_REFUND
    ) {
      throw new BadRequestException(
        `La orden ${order.publicId} está en estado ${order.status}; solo se reembolsa lo cobrado`,
      );
    }

    const charged = new Decimal(order.payment.amount);
    const { committed, remaining } = this.refundableAmount(charged, order.refunds);
    if (remaining.lessThanOrEqualTo(SETTLEMENT_TOLERANCE)) {
      throw new BadRequestException(
        `La orden ${order.publicId} ya tiene comprometido todo lo cobrado (${committed} de ${charged})`,
      );
    }

    const refundAmount = data.amount !== undefined ? new Decimal(data.amount) : remaining;
    if (refundAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El importe del reembolso debe ser positivo');
    }
    if (refundAmount.minus(remaining).greaterThan(SETTLEMENT_TOLERANCE)) {
      throw new BadRequestException(
        `El reembolso (${refundAmount}) excede lo pendiente de devolver (${remaining}) ` +
          `sobre un cobro liquidado de ${charged}`,
      );
    }

    // "Completo" es respecto de lo COBRADO, y es lo único que libera butacas.
    const fullRefund = committed
      .plus(refundAmount)
      .greaterThanOrEqualTo(charged.minus(SETTLEMENT_TOLERANCE));

    const refund = await this.prisma.refund.create({
      data: {
        orderId: order.id,
        amount: refundAmount,
        reason: data.reason ?? 'CUSTOMER_REQUEST',
        status: RefundStatus.COMPLETED,
        requestedBy: data.requestedBy,
        processedBy: data.requestedBy,
        processedAt: new Date(),
        notes: data.notes ?? 'Reembolso liquidado fuera del gateway y asentado por staff',
      },
    });

    await this.applyRefundInventory(order.id, fullRefund);

    await this.prisma.auditEvent.create({
      data: {
        action: 'REFUND_MANUAL_RECORDED',
        entityType: 'Refund',
        entityId: refund.id,
        organizationId: order.organizationId,
        metadata: {
          orderId: order.id,
          orderPublicId: order.publicId,
          amount: refundAmount.toString(),
          chargedAmount: charged.toString(),
          previouslyCommitted: committed.toString(),
          currency: order.payment.currency,
          fullRefund,
          inventoryReleased: fullRefund,
          requestedBy: data.requestedBy,
        },
      },
    });

    await this.notifyRefund(order.id, order.buyerEmail, refundAmount.toNumber(), {
      reason: data.reason,
      partial: !fullRefund,
    });

    return {
      refund,
      orderPublicId: order.publicId,
      chargedAmount: charged.toString(),
      totalRefunded: committed.plus(refundAmount).toString(),
      remainingRefundable: charged.minus(committed).minus(refundAmount).toString(),
      currency: order.payment.currency,
      fullRefund,
      inventoryReleased: fullRefund,
    };
  }

  async handleBanorteWebhook(payload: unknown, signature?: string) {
    const result = await this.banorte.handleWebhook!(payload, signature);
    if (!result.orderId) {
      this.logger.warn('Banorte webhook without orderId');
      return { received: true };
    }

    const reference = String(result.orderId);
    /*
     * F1-26: el respaldo era `publicId: { contains: reference }`, que casa
     * cualquier orden cuyo publicId contenga la cadena — un IPN podía completar
     * la orden de otro comprador. Solo se aceptan coincidencias exactas: id,
     * publicId o el externalId del intent (que es lo que Banorte devuelve
     * cuando REFERENCIA viaja saneada).
     */
    let order = await this.prisma.order.findUnique({ where: { id: reference } });
    if (!order) {
      order = await this.prisma.order.findUnique({ where: { publicId: reference } });
    }
    if (!order) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: { externalId: reference },
        orderBy: { createdAt: 'desc' },
        select: { orderId: true },
      });
      if (intent?.orderId) {
        order = await this.prisma.order.findUnique({ where: { id: intent.orderId } });
      }
    }

    if (!order) {
      this.logger.warn(
        `Banorte webhook: ninguna orden coincide exactamente con la referencia "${reference}"; no se actúa.`,
      );
      return { received: true };
    }

    if (result.status === 'completed') {
      await this.completeOrder(order.id, result.intentId ?? `banorte_${order.id}`, {
        amount: result.amount,
        currency: result.currency,
        rawCode: result.rawCode,
        source: 'banorte_ipn',
      });
    } else if (result.status === 'failed') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
    }

    return { received: true, status: result.status };
  }

  /**
   * Estado de pago de una orden para la URL de retorno del navegador.
   * Solo lectura e idempotente: no completa nada (F1-06). Devuelve `null` si la
   * referencia no existe y no expone importes: es una ruta sin autenticar.
   */
  async getOrderPaymentStatus(orderIdOrPublicId: string) {
    const order =
      (await this.prisma.order.findUnique({
        where: { id: orderIdOrPublicId },
        select: { id: true, publicId: true, status: true },
      })) ??
      (await this.prisma.order.findUnique({
        where: { publicId: orderIdOrPublicId },
        select: { id: true, publicId: true, status: true },
      }));
    if (!order) return null;
    return {
      publicId: order.publicId,
      status: order.status,
      paid: order.status === OrderStatus.COMPLETED,
    };
  }

  // ==================== LECTURAS DE OPERACIÓN (soporte / conciliación) =======

  /**
   * Cola de reembolsos.
   *
   * Antes no existía ningún GET: el admin armaba la lista de pendientes pidiendo
   * orden por orden. Trae lo necesario para operar sin una segunda petición:
   * folio, importe cobrado, importe devuelto, quién lo pidió, quién lo cerró y
   * cuánto lleva esperando.
   *
   * COSTE: `Refund` no tiene `organizationId` (esquema congelado), así que el
   * aislamiento multi-tenant se resuelve con un filtro sobre la relación
   * `order` — un join contra `Order(organizationId)`, que sí está indexado. El
   * orden por `requestedAt` no tiene índice en `Refund`: con volumen alto habrá
   * que añadir `@@index([status, requestedAt])`.
   */
  async listRefunds(params: {
    organizationId?: string | null;
    status?: RefundStatus;
    eventId?: string;
    cursor?: string;
    limit?: number;
    sort?: 'oldest' | 'newest';
  }) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const orderFilter: Prisma.OrderWhereInput = {};
    if (params.organizationId) orderFilter.organizationId = params.organizationId;
    if (params.eventId) orderFilter.eventId = params.eventId;

    const where: Prisma.RefundWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(Object.keys(orderFilter).length ? { order: orderFilter } : {}),
    };

    const rows = await this.prisma.refund.findMany({
      where,
      // `id` como desempate: `requestedAt` puede repetirse y el cursor necesita
      // un orden total o se saltan/repiten filas entre páginas.
      orderBy:
        params.sort === 'oldest'
          ? [{ requestedAt: 'asc' }, { id: 'asc' }]
          : [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        notes: true,
        requestedBy: true,
        processedBy: true,
        requestedAt: true,
        processedAt: true,
        order: {
          select: {
            id: true,
            publicId: true,
            status: true,
            currency: true,
            totalAmount: true,
            buyerEmail: true,
            buyerName: true,
            organizationId: true,
            event: { select: { id: true, title: true, slug: true } },
            payment: {
              select: {
                amount: true,
                currency: true,
                status: true,
                gateway: true,
                externalId: true,
              },
            },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const now = Date.now();

    return {
      data: page.map((r) => ({
        id: r.id,
        amount: r.amount.toString(),
        // El importe no lleva moneda propia: `Refund` no tiene columna
        // `currency`, se hereda del cobro (o de la orden si no hubo Payment).
        currency: r.order.payment?.currency ?? r.order.currency,
        reason: r.reason,
        status: r.status,
        notes: r.notes,
        requestedBy: r.requestedBy,
        processedBy: r.processedBy,
        requestedAt: r.requestedAt,
        processedAt: r.processedAt,
        pendingForHours:
          r.status === RefundStatus.PENDING
            ? Math.round(((now - r.requestedAt.getTime()) / 3_600_000) * 10) / 10
            : null,
        order: {
          id: r.order.id,
          publicId: r.order.publicId,
          status: r.order.status,
          buyerEmail: r.order.buyerEmail,
          buyerName: r.order.buyerName,
          organizationId: r.order.organizationId,
          expectedAmount: r.order.totalAmount.toString(),
          chargedAmount: r.order.payment ? r.order.payment.amount.toString() : null,
          paymentStatus: r.order.payment?.status ?? null,
          gateway: r.order.payment?.gateway ?? null,
          gatewayReference: r.order.payment?.externalId ?? null,
          event: r.order.event,
        },
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      hasMore,
      limit,
    };
  }

  /**
   * Conciliación por periodo: esperado vs. liquidado vs. reembolsado, por moneda.
   *
   * Los `AuditEvent` de `payment.settlement_mismatch` no se podían consultar, así
   * que el descuadre se recalculaba a ojo en pantalla. Aquí se cuadra de verdad:
   * `expected` sale de `Order.totalAmount`, `settled` de `Payment.amount` (lo que
   * el banco declaró haber cobrado) y `refunded` de los `Refund` COMPLETED.
   *
   * COSTE: no hay forma de agregar `Payment.amount` por organización con
   * `groupBy` (Payment no tiene tenant ni fecha de orden), así que se recorren
   * las órdenes de la ventana por lotes. La ventana se apoya en
   * `Order(createdAt)` y el recorrido está acotado: si se supera el tope se
   * devuelve `truncated: true` en lugar de una consulta que muera con volumen.
   */
  async reconciliationReport(params: {
    organizationId?: string | null;
    eventId?: string;
    from?: string;
    to?: string;
  }) {
    const to = params.to ? new Date(params.to) : new Date();
    const from = params.from
      ? new Date(params.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Rango de fechas inválido (usa ISO 8601)');
    }

    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: from, lte: to },
      // Todo estado en el que el dinero YA entró: PENDING_REFUND incluido, que
      // es precisamente el cobro sin emisión que hay que detectar y devolver.
      status: {
        in: [
          OrderStatus.COMPLETED,
          OrderStatus.PARTIALLY_REFUNDED,
          OrderStatus.REFUNDED,
          OrderStatus.PENDING_REFUND,
        ],
      },
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      ...(params.eventId ? { eventId: params.eventId } : {}),
    };

    type Bucket = {
      currency: string;
      orders: number;
      expected: Decimal;
      settled: Decimal;
      refunded: Decimal;
      pendingRefunds: Decimal;
      ordersWithoutPayment: number;
      mismatchedOrders: number;
    };
    const buckets = new Map<string, Bucket>();
    const bucketFor = (currency: string) => {
      let b = buckets.get(currency);
      if (!b) {
        b = {
          currency,
          orders: 0,
          expected: new Decimal(0),
          settled: new Decimal(0),
          refunded: new Decimal(0),
          pendingRefunds: new Decimal(0),
          ordersWithoutPayment: 0,
          mismatchedOrders: 0,
        };
        buckets.set(currency, b);
      }
      return b;
    };

    const BATCH_SIZE = 500;
    const MAX_BATCHES = 100; // 50 000 órdenes por informe
    const mismatches: {
      orderId: string;
      publicId: string;
      status: OrderStatus;
      reason: string;
      expected: string;
      settled: string | null;
      difference: string | null;
      expectedCurrency: string;
      settledCurrency: string | null;
      createdAt: Date;
    }[] = [];
    let cursor: string | undefined;
    let truncated = false;
    let scanned = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const orders = await this.prisma.order.findMany({
        where,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          publicId: true,
          status: true,
          currency: true,
          totalAmount: true,
          createdAt: true,
          payment: { select: { amount: true, currency: true } },
          refunds: { select: { amount: true, status: true } },
        },
      });
      if (orders.length === 0) break;
      scanned += orders.length;
      cursor = orders[orders.length - 1]!.id;

      for (const o of orders) {
        const b = bucketFor(o.currency);
        b.orders += 1;
        b.expected = b.expected.plus(o.totalAmount);

        for (const r of o.refunds) {
          if (r.status === RefundStatus.COMPLETED) b.refunded = b.refunded.plus(r.amount);
          else if (r.status === RefundStatus.PENDING) {
            b.pendingRefunds = b.pendingRefunds.plus(r.amount);
          }
        }

        if (!o.payment) {
          b.ordersWithoutPayment += 1;
          if (mismatches.length < 100) {
            mismatches.push({
              orderId: o.id,
              publicId: o.publicId,
              status: o.status,
              reason: 'orden sin Payment asociado',
              expected: o.totalAmount.toString(),
              settled: null,
              difference: null,
              expectedCurrency: o.currency,
              settledCurrency: null,
              createdAt: o.createdAt,
            });
          }
          continue;
        }

        const settled = new Decimal(o.payment.amount);
        b.settled = b.settled.plus(settled);
        const diff = settled.minus(o.totalAmount);
        const currencyMismatch = o.payment.currency !== o.currency;
        if (diff.abs().greaterThan(SETTLEMENT_TOLERANCE) || currencyMismatch) {
          b.mismatchedOrders += 1;
          if (mismatches.length < 100) {
            mismatches.push({
              orderId: o.id,
              publicId: o.publicId,
              status: o.status,
              reason: currencyMismatch
                ? `moneda liquidada ${o.payment.currency} ≠ moneda de la orden ${o.currency}`
                : 'importe liquidado ≠ total de la orden',
              expected: o.totalAmount.toString(),
              settled: settled.toString(),
              difference: diff.toString(),
              expectedCurrency: o.currency,
              settledCurrency: o.payment.currency,
              createdAt: o.createdAt,
            });
          }
        }
      }

      if (orders.length < BATCH_SIZE) break;
      if (batch === MAX_BATCHES - 1) truncated = true;
    }

    const byCurrency = [...buckets.values()].map((b) => ({
      currency: b.currency,
      orders: b.orders,
      expected: b.expected.toString(),
      settled: b.settled.toString(),
      refunded: b.refunded.toString(),
      pendingRefunds: b.pendingRefunds.toString(),
      /** liquidado − esperado: negativo = se cobró de menos. */
      difference: b.settled.minus(b.expected).toString(),
      /** Lo que debería quedar en la cuenta tras devoluciones. */
      net: b.settled.minus(b.refunded).toString(),
      ordersWithoutPayment: b.ordersWithoutPayment,
      mismatchedOrders: b.mismatchedOrders,
      balanced: b.settled.minus(b.expected).abs().lessThanOrEqualTo(SETTLEMENT_TOLERANCE),
    }));

    return {
      period: { from, to },
      scope: {
        organizationId: params.organizationId ?? null,
        eventId: params.eventId ?? null,
      },
      byCurrency,
      // Se cortan a 100 para no devolver un informe ilegible; el conteo real por
      // moneda vive en `byCurrency[].mismatchedOrders`.
      mismatches,
      mismatchesTruncated: mismatches.length >= 100,
      ordersScanned: scanned,
      truncated,
      note: truncated
        ? `Se alcanzó el tope de ${BATCH_SIZE * MAX_BATCHES} órdenes: acota el periodo para cuadrar el resto.`
        : null,
      strictSettlementMode: isStrictSettlementMode(),
      generatedAt: new Date(),
    };
  }

  /**
   * Incidencias de liquidación auditadas (`payment.settlement_mismatch`,
   * `payment.late_settlement`, `order.insufficient_inventory`).
   *
   * COSTE: `AuditEvent` no tiene índice por `action`; la consulta se apoya en
   * `@@index([organizationId])` / `@@index([createdAt])` y filtra `action` sobre
   * ese subconjunto, por eso la ventana temporal es obligatoria en la práctica
   * (por defecto 30 días).
   */
  async listSettlementIncidents(params: {
    organizationId?: string | null;
    action?: string;
    entityId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const KNOWN_ACTIONS = [
      'payment.settlement_mismatch',
      'payment.late_settlement',
      'order.insufficient_inventory',
    ];
    if (params.action && !KNOWN_ACTIONS.includes(params.action)) {
      throw new BadRequestException(`action debe ser una de: ${KNOWN_ACTIONS.join(', ')}`);
    }
    const to = params.to ? new Date(params.to) : new Date();
    const from = params.from
      ? new Date(params.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.auditEvent.findMany({
      where: {
        action: params.action ? params.action : { in: KNOWN_ACTIONS },
        ...(params.entityId ? { entityId: params.entityId } : {}),
        ...(params.organizationId ? { organizationId: params.organizationId } : {}),
        createdAt: { gte: from, lte: to },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      hasMore,
      limit,
      period: { from, to },
    };
  }

  getBanortePublicConfig() {
    const cfg = getBanorteConfig();
    const validation = validateBanorteProductionConfig();
    const ipn = getBanorteIpnEndpoints();
    const demo = cfg.isDemo;
    return {
      gateway: 'BANORTE',
      demo,
      mode: demo ? ('demo' as const) : ('live' as const),
      productionReady: validation.ready && !demo,
      methods: ['CARD', 'SPEI', 'OXXO'],
      settlement: demo
        ? 'Modo demo — no hay cobro real ni liquidación Banorte'
        : 'Depósito directo en cuenta Banorte empresarial del promotor',
      buyerNote: demo
        ? 'Entorno de prueba: puedes completar el flujo sin cargo real. No uses datos de tarjeta reales.'
        : 'El cobro se procesa con Banorte Payworks / SPEI / OXXO hacia la cuenta del promotor.',
      accountClabeMasked:
        !demo && cfg.accountClabe
          ? `${cfg.accountClabe.slice(0, 4)}…${cfg.accountClabe.slice(-4)}`
          : null,
      validation: {
        ready: validation.ready,
        demo: validation.demo,
        missing: validation.missing,
        warnings: validation.warnings,
      },
      ipn: {
        webhookUrl: ipn.webhookUrl,
        returnUrlBase: ipn.returnUrlBase,
        cancelUrl: ipn.cancelUrl,
        webhookSecretConfigured: ipn.webhookSecretConfigured,
        signatureHeaders: [...ipn.signatureHeaders],
      },
    };
  }

  validateBanorteSetup() {
    const validation = validateBanorteProductionConfig();
    const ipn = getBanorteIpnEndpoints();
    return {
      ...validation,
      checkedAt: new Date().toISOString(),
      ipn: {
        webhookUrl: ipn.webhookUrl,
        returnUrlBase: ipn.returnUrlBase,
        cancelUrl: ipn.cancelUrl,
        webhookSecretConfigured: ipn.webhookSecretConfigured,
        signatureHeaders: [...ipn.signatureHeaders],
        registerHint:
          'Registra la URL IPN en el portal Banorte Payworks y firma con BANORTE_WEBHOOK_SECRET.',
      },
    };
  }
}


