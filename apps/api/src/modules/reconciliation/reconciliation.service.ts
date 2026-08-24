import { Injectable } from '@nestjs/common';
import {
  HoldStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ReconciliationCheck,
  ReconciliationCheckStatus,
  ReconciliationReport,
  ReconciliationSample,
} from './reconciliation.types';

const SAMPLE_LIMIT = 5;

type OrgScope = { organizationId?: string };

@Injectable()
export class ReconciliationService {
  constructor(private prisma: PrismaService) {}

  async runHealthChecks(scope: OrgScope = {}): Promise<ReconciliationReport> {
    const { organizationId } = scope;
    const orderWhere = organizationId ? { organizationId } : {};
    const eventOrgFilter = organizationId
      ? { event: { organizationId } }
      : {};
    const now = new Date();

    const checks = await Promise.all([
      this.checkOrdersWithoutPayment(orderWhere),
      this.checkPaymentWithoutOrder(organizationId),
      this.checkOrphanTickets(eventOrgFilter),
      this.checkExpiredActiveHolds(eventOrgFilter, now),
      this.checkSoldTicketsOnOpenOrders(eventOrgFilter),
      this.checkAvailableTicketsWithOrderLink(eventOrgFilter),
      this.checkActiveHoldsOnSoldSeats(eventOrgFilter, now),
      this.checkRefundedOrdersWithoutRefunds(orderWhere),
      this.checkCompletedRefundsOnOpenOrders(orderWhere),
      this.checkPaymentRefundedOrderOpen(orderWhere),
      this.checkRefundAmountMismatch(orderWhere),
    ]);

    const summary = {
      ok: checks.filter((c) => c.status === 'ok').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      error: checks.filter((c) => c.status === 'error').length,
    };

    return {
      generatedAt: now.toISOString(),
      scope: organizationId ? 'organization' : 'platform',
      organizationId: organizationId ?? null,
      checks,
      summary,
    };
  }

  private buildCheck(
    id: string,
    label: string,
    description: string,
    count: number,
    samples: ReconciliationSample[],
    severity: 'warn' | 'error',
  ): ReconciliationCheck {
    const status: ReconciliationCheckStatus =
      count === 0 ? 'ok' : severity;
    return { id, label, description, status, count, samples };
  }

  /** COMPLETED orders missing payment or with non-completed payment. */
  private async checkOrdersWithoutPayment(
    orderWhere: Prisma.OrderWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.OrderWhereInput = {
      ...orderWhere,
      status: OrderStatus.COMPLETED,
      OR: [
        { paymentId: null },
        { payment: { status: { not: PaymentStatus.COMPLETED } } },
      ],
    };

    const [count, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          publicId: true,
          paymentId: true,
          payment: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'orders_without_payment',
      'Órdenes completadas sin pago válido',
      'Órdenes COMPLETED sin paymentId o cuyo pago no está COMPLETED.',
      count,
      rows.map((r) => ({
        orderId: r.id,
        publicId: r.publicId,
        paymentId: r.paymentId,
        paymentStatus: r.payment?.status ?? null,
      })),
      'error',
    );
  }

  /** COMPLETED payments with no linked orders. */
  private async checkPaymentWithoutOrder(
    organizationId?: string,
  ): Promise<ReconciliationCheck> {
    let where: Prisma.PaymentWhereInput = {
      status: PaymentStatus.COMPLETED,
      orders: { none: {} },
    };

    if (organizationId) {
      const orgPaymentRefs = await this.prisma.order.findMany({
        where: { organizationId, paymentId: { not: null } },
        select: { paymentId: true },
        distinct: ['paymentId'],
      });
      const paymentIds = orgPaymentRefs
        .map((o) => o.paymentId)
        .filter((id): id is string => Boolean(id));
      if (paymentIds.length === 0) {
        return this.buildCheck(
          'payment_without_order',
          'Pagos completados sin orden',
          'Pagos COMPLETED que no están vinculados a ninguna orden.',
          0,
          [],
          'error',
        );
      }
      where = {
        status: PaymentStatus.COMPLETED,
        orders: { none: {} },
        id: { in: paymentIds },
      };
    }

    const [count, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        select: { id: true, externalId: true, amount: true, status: true, gateway: true },
        orderBy: { createdAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'payment_without_order',
      'Pagos completados sin orden',
      'Pagos COMPLETED que no están vinculados a ninguna orden.',
      count,
      rows.map((r) => ({
        paymentId: r.id,
        externalId: r.externalId,
        amount: r.amount.toString(),
        gateway: r.gateway,
      })),
      'error',
    );
  }

  /** Sold/held tickets with no order line, or tied to cancelled/failed orders. */
  private async checkOrphanTickets(
    ticketWhere: Prisma.TicketWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.TicketWhereInput = {
      ...ticketWhere,
      OR: [
        {
          status: { in: [TicketStatus.SOLD, TicketStatus.HELD] },
          orderItemId: null,
        },
        {
          status: { in: [TicketStatus.SOLD, TicketStatus.HELD] },
          orderItem: {
            order: { status: { in: [OrderStatus.CANCELLED, OrderStatus.FAILED] } },
          },
        },
      ],
    };

    const [count, rows] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        select: {
          id: true,
          code: true,
          status: true,
          orderItemId: true,
          orderItem: { select: { order: { select: { publicId: true, status: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'orphan_tickets',
      'Boletos huérfanos',
      'Boletos SOLD/HELD sin línea de orden o ligados a órdenes canceladas/fallidas.',
      count,
      rows.map((r) => ({
        ticketId: r.id,
        code: r.code,
        status: r.status,
        orderItemId: r.orderItemId,
        orderPublicId: r.orderItem?.order.publicId ?? null,
        orderStatus: r.orderItem?.order.status ?? null,
      })),
      'error',
    );
  }

  /** Seat holds still ACTIVE after expiry. */
  private async checkExpiredActiveHolds(
    holdWhere: Prisma.SeatHoldWhereInput,
    now: Date,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.SeatHoldWhereInput = {
      ...holdWhere,
      status: HoldStatus.ACTIVE,
      expiresAt: { lt: now },
    };

    const [count, rows] = await Promise.all([
      this.prisma.seatHold.count({ where }),
      this.prisma.seatHold.findMany({
        where,
        select: {
          id: true,
          eventId: true,
          seatId: true,
          expiresAt: true,
          sessionId: true,
        },
        orderBy: { expiresAt: 'asc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'expired_active_holds',
      'Reservas activas vencidas',
      'SeatHold ACTIVE cuyo expiresAt ya pasó (deberían estar EXPIRED o RELEASED).',
      count,
      rows.map((r) => ({
        holdId: r.id,
        eventId: r.eventId,
        seatId: r.seatId,
        expiresAt: r.expiresAt.toISOString(),
        sessionId: r.sessionId,
      })),
      'warn',
    );
  }

  /** SOLD tickets on orders that are not COMPLETED. */
  private async checkSoldTicketsOnOpenOrders(
    ticketWhere: Prisma.TicketWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.TicketWhereInput = {
      ...ticketWhere,
      status: TicketStatus.SOLD,
      orderItem: {
        order: { status: { not: OrderStatus.COMPLETED } },
      },
    };

    const [count, rows] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        select: {
          id: true,
          code: true,
          orderItem: { select: { order: { select: { publicId: true, status: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'sold_tickets_open_order',
      'Boletos vendidos en orden abierta',
      'Boletos SOLD cuya orden no está COMPLETED.',
      count,
      rows.map((r) => ({
        ticketId: r.id,
        code: r.code,
        orderPublicId: r.orderItem?.order.publicId ?? null,
        orderStatus: r.orderItem?.order.status ?? null,
      })),
      'error',
    );
  }

  /** AVAILABLE tickets still linked to an order line. */
  private async checkAvailableTicketsWithOrderLink(
    ticketWhere: Prisma.TicketWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.TicketWhereInput = {
      ...ticketWhere,
      status: TicketStatus.AVAILABLE,
      orderItemId: { not: null },
    };

    const [count, rows] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        select: { id: true, code: true, orderItemId: true, eventId: true },
        orderBy: { updatedAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'available_ticket_order_link',
      'Disponibles con enlace a orden',
      'Boletos AVAILABLE que aún tienen orderItemId (inventario inconsistente).',
      count,
      rows.map((r) => ({
        ticketId: r.id,
        code: r.code,
        orderItemId: r.orderItemId,
        eventId: r.eventId,
      })),
      'warn',
    );
  }

  /** ACTIVE holds on seats already SOLD for the same event. */
  private async checkActiveHoldsOnSoldSeats(
    holdWhere: Prisma.SeatHoldWhereInput,
    now: Date,
  ): Promise<ReconciliationCheck> {
    const holds = await this.prisma.seatHold.findMany({
      where: {
        ...holdWhere,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: now },
        seatId: { not: null },
      },
      select: { id: true, eventId: true, seatId: true, sessionId: true },
      take: 200,
    });

    if (holds.length === 0) {
      return this.buildCheck(
        'hold_on_sold_seat',
        'Reservas sobre butaca vendida',
        'SeatHold ACTIVE en butacas que ya tienen boleto SOLD.',
        0,
        [],
        'warn',
      );
    }

    const seatKeys = holds.map((h) => ({ eventId: h.eventId, seatId: h.seatId! }));
    const soldTickets = await this.prisma.ticket.findMany({
      where: {
        status: TicketStatus.SOLD,
        OR: seatKeys.map((k) => ({ eventId: k.eventId, seatId: k.seatId })),
      },
      select: { eventId: true, seatId: true },
    });

    const soldSet = new Set(
      soldTickets.map((t) => `${t.eventId}:${t.seatId}`),
    );

    const conflicts = holds.filter(
      (h) => h.seatId && soldSet.has(`${h.eventId}:${h.seatId}`),
    );

    return this.buildCheck(
      'hold_on_sold_seat',
      'Reservas sobre butaca vendida',
      'SeatHold ACTIVE en butacas que ya tienen boleto SOLD.',
      conflicts.length,
      conflicts.slice(0, SAMPLE_LIMIT).map((r) => ({
        holdId: r.id,
        eventId: r.eventId,
        seatId: r.seatId,
        sessionId: r.sessionId,
      })),
      'error',
    );
  }

  /** REFUNDED orders with no completed refund records. */
  private async checkRefundedOrdersWithoutRefunds(
    orderWhere: Prisma.OrderWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.OrderWhereInput = {
      ...orderWhere,
      status: { in: [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED] },
      refunds: { none: { status: RefundStatus.COMPLETED } },
    };

    const [count, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: { id: true, publicId: true, status: true, totalAmount: true },
        orderBy: { updatedAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'refunded_order_no_refund',
      'Orden reembolsada sin registro',
      'Órdenes REFUNDED/PARTIALLY_REFUNDED sin reembolso COMPLETED.',
      count,
      rows.map((r) => ({
        orderId: r.id,
        publicId: r.publicId,
        status: r.status,
        totalAmount: r.totalAmount.toString(),
      })),
      'error',
    );
  }

  /** COMPLETED refunds while order still COMPLETED. */
  private async checkCompletedRefundsOnOpenOrders(
    orderWhere: Prisma.OrderWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.RefundWhereInput = {
      status: RefundStatus.COMPLETED,
      order: {
        ...orderWhere,
        status: OrderStatus.COMPLETED,
      },
    };

    const [count, rows] = await Promise.all([
      this.prisma.refund.count({ where }),
      this.prisma.refund.findMany({
        where,
        select: {
          id: true,
          amount: true,
          order: { select: { id: true, publicId: true, status: true } },
        },
        orderBy: { processedAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'refund_completed_order_open',
      'Reembolso aplicado, orden abierta',
      'Reembolsos COMPLETED en órdenes que siguen COMPLETED.',
      count,
      rows.map((r) => ({
        refundId: r.id,
        amount: r.amount.toString(),
        orderId: r.order.id,
        publicId: r.order.publicId,
        orderStatus: r.order.status,
      })),
      'warn',
    );
  }

  /** Payment REFUNDED but order not marked refunded. */
  private async checkPaymentRefundedOrderOpen(
    orderWhere: Prisma.OrderWhereInput,
  ): Promise<ReconciliationCheck> {
    const where: Prisma.OrderWhereInput = {
      ...orderWhere,
      status: { notIn: [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.PENDING_REFUND] },
      payment: { status: PaymentStatus.REFUNDED },
    };

    const [count, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          publicId: true,
          status: true,
          payment: { select: { id: true, status: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);

    return this.buildCheck(
      'payment_refunded_order_open',
      'Pago reembolsado, orden sin marcar',
      'Pago REFUNDED en órdenes que no están REFUNDED/PARTIALLY_REFUNDED.',
      count,
      rows.map((r) => ({
        orderId: r.id,
        publicId: r.publicId,
        orderStatus: r.status,
        paymentId: r.payment?.id ?? null,
        paymentStatus: r.payment?.status ?? null,
      })),
      'error',
    );
  }

  /** REFUNDED orders where sum of completed refunds != order total (±0.01). */
  private async checkRefundAmountMismatch(
    orderWhere: Prisma.OrderWhereInput,
  ): Promise<ReconciliationCheck> {
    const orders = await this.prisma.order.findMany({
      where: {
        ...orderWhere,
        status: OrderStatus.REFUNDED,
      },
      select: {
        id: true,
        publicId: true,
        totalAmount: true,
        refunds: {
          where: { status: RefundStatus.COMPLETED },
          select: { amount: true },
        },
      },
      take: 500,
      orderBy: { updatedAt: 'desc' },
    });

    const tolerance = 0.01;
    const mismatches = orders.filter((o) => {
      const refunded = o.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      return Math.abs(refunded - Number(o.totalAmount)) > tolerance;
    });

    return this.buildCheck(
      'refund_amount_mismatch',
      'Importe de reembolso inconsistente',
      'Órdenes REFUNDED cuyo total reembolsado no coincide con totalAmount.',
      mismatches.length,
      mismatches.slice(0, SAMPLE_LIMIT).map((r) => {
        const refunded = r.refunds.reduce((sum, x) => sum + Number(x.amount), 0);
        return {
          orderId: r.id,
          publicId: r.publicId,
          totalAmount: r.totalAmount.toString(),
          refundedTotal: refunded.toFixed(2),
        };
      }),
      'warn',
    );
  }
}
