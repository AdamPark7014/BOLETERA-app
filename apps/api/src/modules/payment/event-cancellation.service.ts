import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventStatus, OrderStatus, RefundStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PaymentService } from './payment.service';

/**
 * Cancelación y reprogramación de eventos, con las devoluciones que exige la ley.
 *
 * Este flujo NO EXISTÍA. Se podía vender un evento pero no cancelarlo: no había
 * endpoint que pusiera `EventStatus.CANCELLED`, ni forma de devolver el dinero
 * en masa, ni aviso a los compradores. El escenario que la ley regula era
 * precisamente el único que el sistema no sabía ejecutar.
 *
 * MARCO LEGAL (México — LFPC art. 92 Bis, criterio PROFECO):
 *
 *  1. Si el evento no se realiza en la fecha programada, el consumidor tiene
 *     derecho al reembolso COMPLETO del boleto **incluidos los cargos por
 *     servicio**. Aquí sale gratis: se devuelve `Payment.amount`, que es lo
 *     realmente liquidado y ya incluye cargos e impuestos.
 *  2. Cuando la cancelación es IMPUTABLE al promotor o al vendedor, procede
 *     además una bonificación de al menos el 20% de lo pagado.
 *  3. Si la causa NO es imputable (clima extremo, enfermedad del artista) y está
 *     respaldada por autoridad competente, la bonificación no aplica — pero el
 *     reembolso sí. Por eso `attributable` es obligatorio y se audita junto con
 *     su justificación: es la diferencia entre cumplir y no cumplir.
 *  4. Si el evento se REPROGRAMA, el comprador elige entre conservar su boleto
 *     para la nueva fecha o pedir el reembolso. No se puede decidir por él, así
 *     que reprogramar no devuelve dinero automáticamente: avisa y habilita la
 *     solicitud.
 *  5. La devolución va por el mismo medio de pago, salvo que el consumidor
 *     acepte otro.
 */

/** Mínimo legal de bonificación cuando la cancelación es imputable al promotor. */
const MINIMUM_COMPENSATION_RATE = 0.2;

/** Tolerancia de un centavo al comparar importes. */
const TOLERANCE = 0.01;

export interface CancelEventInput {
  eventId: string;
  /** Acota al inquilino: una organización no cancela eventos de otra. */
  organizationId?: string;
  /** Motivo que verá el comprador en el correo. */
  reason: string;
  /**
   * ¿La causa es imputable al promotor/vendedor? Determina si procede la
   * bonificación del art. 92 Bis. Obligatorio y sin valor por defecto: elegir
   * por omisión sería decidir una obligación legal sin que nadie lo asuma.
   */
  attributable: boolean;
  /** Respaldo de la causa no imputable (autoridad, aviso oficial). Se audita. */
  justification?: string;
  /** Bonificación aplicada. Nunca por debajo del mínimo legal si es imputable. */
  compensationRate?: number;
  requestedBy: string;
  /** Previsualiza el impacto sin mover dinero. */
  dryRun?: boolean;
}

@Injectable()
export class EventCancellationService {
  private readonly logger = new Logger(EventCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
  ) {}

  async cancelEvent(input: CancelEventInput) {
    const event = await this.loadEvent(input.eventId, input.organizationId);

    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException(`El evento ${event.title} ya está cancelado`);
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException('El motivo es obligatorio: lo lee el comprador');
    }
    if (!input.attributable && !input.justification?.trim()) {
      throw new BadRequestException(
        'Una causa no imputable debe justificarse (respaldo de autoridad competente): ' +
          'de ella depende que no se pague la bonificación del 20%.',
      );
    }

    const rate = this.resolveCompensationRate(input);
    const orders = await this.affectedOrders(event.id);
    const projection = this.project(orders, rate);

    if (input.dryRun) {
      return {
        dryRun: true as const,
        eventId: event.id,
        eventTitle: event.title,
        ...projection,
        compensationRate: rate,
      };
    }

    // 1. Cerrar la venta ANTES de devolver: si no, alguien compra a mitad del
    //    proceso y su orden nace ya huérfana de un evento cancelado.
    await this.prisma.$transaction([
      this.prisma.event.update({
        where: { id: event.id },
        data: { status: EventStatus.CANCELLED, cancelledAt: new Date() },
      }),
      this.prisma.offer.updateMany({
        where: { eventId: event.id },
        data: { isAvailable: false },
      }),
    ]);

    // 2. Devolver orden por orden. Una que falle no puede abortar el resto:
    //    dejar a medias una cancelación masiva es peor que reintentar la parte
    //    que falló, y el resultado dice exactamente cuáles quedaron pendientes.
    const refunded: string[] = [];
    const failed: Array<{ publicId: string; error: string }> = [];
    let refundedTotal = new Decimal(0);
    let compensationTotal = new Decimal(0);

    for (const order of orders) {
      try {
        const result = await this.payments.recordSettledRefund({
          orderId: order.id,
          reason: 'EVENT_CANCELLED',
          requestedBy: input.requestedBy,
          notes: `Cancelación de "${event.title}": ${input.reason}`,
          organizationId: input.organizationId,
        });
        refundedTotal = refundedTotal.plus(new Decimal(result.refund.amount));

        if (rate > 0) {
          const compensation = await this.recordCompensation(order, rate, input, event.title);
          if (compensation) compensationTotal = compensationTotal.plus(compensation);
        }
        refunded.push(order.publicId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ publicId: order.publicId, error: message });
        this.logger.error(`Cancelación ${event.id}: falló la orden ${order.publicId}: ${message}`);
      }
    }

    // 3. Avisar. La difusión abre un job por orden, así que un correo que falle
    //    no reenvía a todo el aforo.
    await this.notifications
      .enqueueEventCancelled(event.id, input.reason)
      .catch((error: unknown) =>
        this.logger.error(
          `Cancelación ${event.id} asentada pero sin aviso a compradores: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );

    await this.prisma.auditEvent.create({
      data: {
        action: 'event.cancelled',
        entityType: 'Event',
        entityId: event.id,
        organizationId: event.organizationId,
        metadata: {
          reason: input.reason,
          attributable: input.attributable,
          justification: input.justification ?? null,
          compensationRate: rate,
          ordersAffected: orders.length,
          ordersRefunded: refunded.length,
          ordersFailed: failed.length,
          refundedTotal: refundedTotal.toFixed(2),
          compensationTotal: compensationTotal.toFixed(2),
          requestedBy: input.requestedBy,
          legalBasis: 'LFPC art. 92 Bis',
        },
      },
    });

    this.logger.log(
      `Evento ${event.id} cancelado: ${refunded.length}/${orders.length} órdenes devueltas ` +
        `(${refundedTotal.toFixed(2)} + ${compensationTotal.toFixed(2)} de bonificación)`,
    );

    return {
      dryRun: false as const,
      eventId: event.id,
      eventTitle: event.title,
      compensationRate: rate,
      ordersAffected: orders.length,
      ordersRefunded: refunded.length,
      refundedTotal: refundedTotal.toFixed(2),
      compensationTotal: compensationTotal.toFixed(2),
      failed,
    };
  }

  /**
   * Reprogramación: avisa y deja elegir, no devuelve por su cuenta.
   *
   * La ley da al comprador la opción de conservar el boleto para la nueva fecha
   * o pedir el reembolso. Devolver automáticamente le quitaría su lugar a quien
   * sí quiere ir; no avisar le quitaría la opción. Así que se marca, se avisa, y
   * el reembolso queda disponible a solicitud por la vía normal.
   */
  async rescheduleEvent(input: {
    eventId: string;
    organizationId?: string;
    newStartsAt: Date;
    reason: string;
    requestedBy: string;
  }) {
    const event = await this.loadEvent(input.eventId, input.organizationId);
    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Un evento cancelado no se reprograma; crea uno nuevo');
    }
    if (input.newStartsAt.getTime() <= Date.now()) {
      throw new BadRequestException('La nueva fecha debe ser futura');
    }

    const orders = await this.affectedOrders(event.id);

    await this.prisma.event.update({
      where: { id: event.id },
      data: { status: EventStatus.RESCHEDULED, startsAt: input.newStartsAt },
    });

    await this.notifications
      .enqueueEventCancelled(
        event.id,
        `${input.reason} — Nueva fecha: ${input.newStartsAt.toISOString()}. ` +
          'Puedes conservar tu boleto para la nueva fecha o solicitar el reembolso completo.',
      )
      .catch(() => undefined);

    await this.prisma.auditEvent.create({
      data: {
        action: 'event.rescheduled',
        entityType: 'Event',
        entityId: event.id,
        organizationId: event.organizationId,
        metadata: {
          reason: input.reason,
          newStartsAt: input.newStartsAt.toISOString(),
          previousStartsAt: event.startsAt.toISOString(),
          ordersNotified: orders.length,
          requestedBy: input.requestedBy,
          legalBasis: 'LFPC art. 92 Bis — el comprador elige conservar o reembolsar',
        },
      },
    });

    return {
      eventId: event.id,
      eventTitle: event.title,
      newStartsAt: input.newStartsAt,
      ordersNotified: orders.length,
      note: 'Los compradores pueden conservar su boleto o solicitar reembolso completo.',
    };
  }

  // ---------------------------------------------------------------------------

  private async loadEvent(eventId: string, organizationId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        status: true,
        startsAt: true,
        organizationId: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    // Mismo 404 que "no existe": no se confirma la existencia de eventos ajenos.
    if (organizationId && event.organizationId !== organizationId) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  /** Órdenes con dinero dentro. Las PENDING no cobraron, no hay qué devolver. */
  private async affectedOrders(eventId: string) {
    return this.prisma.order.findMany({
      where: {
        eventId,
        status: { in: [OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED] },
      },
      select: {
        id: true,
        publicId: true,
        organizationId: true,
        currency: true,
        payment: { select: { amount: true } },
        refunds: { select: { amount: true, status: true } },
      },
    });
  }

  private resolveCompensationRate(input: CancelEventInput): number {
    if (!input.attributable) return 0;
    const requested = input.compensationRate ?? MINIMUM_COMPENSATION_RATE;
    if (requested < MINIMUM_COMPENSATION_RATE) {
      throw new BadRequestException(
        `La bonificación no puede bajar del ${MINIMUM_COMPENSATION_RATE * 100}% ` +
          'cuando la cancelación es imputable (LFPC art. 92 Bis)',
      );
    }
    if (requested > 1) {
      throw new BadRequestException('La bonificación no puede superar el 100% de lo pagado');
    }
    return requested;
  }

  /** Proyección del impacto: cuánto dinero sale, sin moverlo. */
  private project(orders: Awaited<ReturnType<typeof this.affectedOrders>>, rate: number) {
    let refundable = new Decimal(0);
    let compensation = new Decimal(0);
    for (const order of orders) {
      const charged = new Decimal(order.payment?.amount ?? 0);
      const already = order.refunds
        .filter((r) => r.status === RefundStatus.COMPLETED || r.status === RefundStatus.PENDING)
        .reduce((sum, r) => sum.plus(new Decimal(r.amount)), new Decimal(0));
      const pending = Decimal.max(charged.minus(already), new Decimal(0));
      refundable = refundable.plus(pending);
      compensation = compensation.plus(charged.mul(rate));
    }
    return {
      ordersAffected: orders.length,
      refundableTotal: refundable.toFixed(2),
      compensationTotal: compensation.toFixed(2),
      grandTotal: refundable.plus(compensation).toFixed(2),
    };
  }

  /**
   * Bonificación del art. 92 Bis.
   *
   * Va como `Refund` aparte y a propósito: NO es devolución de lo cobrado, es
   * una indemnización que se suma. Por eso no puede pasar por
   * `recordSettledRefund`, que —correctamente— impide devolver más de lo
   * liquidado. Separarlas mantiene el cuadre legible: lo devuelto cuadra contra
   * el cobro, y la bonificación se identifica por su motivo y su nota.
   */
  private async recordCompensation(
    order: { id: string; publicId: string; payment: { amount: Decimal } | null },
    rate: number,
    input: CancelEventInput,
    eventTitle: string,
  ): Promise<Decimal | null> {
    const charged = new Decimal(order.payment?.amount ?? 0);
    const amount = charged.mul(rate);
    if (amount.lessThanOrEqualTo(TOLERANCE)) return null;

    await this.prisma.refund.create({
      data: {
        orderId: order.id,
        amount,
        reason: 'EVENT_CANCELLED',
        status: RefundStatus.PENDING,
        requestedBy: input.requestedBy,
        notes:
          `BONIFICACIÓN LFPC art. 92 Bis (${(rate * 100).toFixed(0)}% de ${charged.toFixed(2)}) ` +
          `por cancelación imputable de "${eventTitle}". No es devolución del cobro: ` +
          'se paga además del reembolso y se liquida por el portal del banco.',
      },
    });
    return amount;
  }
}
