/**
 * Vocabulario de órdenes, pagos y reembolsos compartido entre lista y detalle.
 *
 * Dos cambios del backend obligan a modelar esto en un solo sitio:
 *
 * 1. `Payment.amount` guarda lo REALMENTE liquidado por la pasarela y puede
 *    diferir de `Order.totalAmount`. Todo lo que asumía que eran el mismo
 *    número está mal. El backend emite `AuditEvent payment.settlement_mismatch`
 *    cuando pasa.
 * 2. Existe el estado `PENDING_REFUND`: el dinero entró pero no se pudieron
 *    emitir los boletos. Es la situación más urgente del sistema y hasta ahora
 *    la interfaz la pintaba como un estado desconocido gris.
 */

import { isSettlementMismatch, toNumber } from './format';

export type OrderStatusTone = 'ok' | 'pending' | 'danger' | 'neutral' | 'attention';

export type OrderStatusMeta = {
  label: string;
  tone: OrderStatusTone;
  /** Qué significa para quien atiende al cliente. */
  hint: string;
};

export const ORDER_STATUS: Record<string, OrderStatusMeta> = {
  COMPLETED: {
    label: 'Completada',
    tone: 'ok',
    hint: 'Pago liquidado y boletos emitidos.',
  },
  PENDING: {
    label: 'Pendiente',
    tone: 'pending',
    hint: 'Esperando confirmación de pago. El inventario sigue apartado.',
  },
  PROCESSING: {
    label: 'Procesando',
    tone: 'pending',
    hint: 'La pasarela aún no confirma el cobro.',
  },
  PENDING_REFUND: {
    label: 'Reembolso obligado',
    tone: 'danger',
    hint: 'El cobro entró pero no se pudieron emitir los boletos. Hay que devolver el dinero.',
  },
  CANCELLED: {
    label: 'Cancelada',
    tone: 'neutral',
    hint: 'Se liberó el inventario sin cobro.',
  },
  REFUNDED: {
    label: 'Reembolsada',
    tone: 'neutral',
    hint: 'Devuelta en su totalidad.',
  },
  PARTIALLY_REFUNDED: {
    label: 'Reembolso parcial',
    tone: 'attention',
    hint: 'Se devolvió una parte del cobro.',
  },
  FAILED: {
    label: 'Fallida',
    tone: 'danger',
    hint: 'El cobro no se completó.',
  },
  EXPIRED: {
    label: 'Expirada',
    tone: 'neutral',
    hint: 'Venció el apartado sin pago.',
  },
};

export function orderStatusMeta(status: string): OrderStatusMeta {
  return (
    ORDER_STATUS[status] ?? {
      label: status,
      tone: 'neutral',
      hint: 'Estado no reconocido por esta versión del panel.',
    }
  );
}

export type RefundStatusMeta = { label: string; tone: OrderStatusTone; hint: string };

/** Espejo de `RefundStatus` en el esquema: PENDING, COMPLETED, FAILED, DISPUTED. */
export const REFUND_STATUS: Record<string, RefundStatusMeta> = {
  PENDING: {
    label: 'Pendiente de cerrar',
    tone: 'danger',
    hint: 'Solicitado en el sistema. Falta ejecutarlo en el portal Banorte y marcarlo aquí.',
  },
  COMPLETED: { label: 'Completado', tone: 'ok', hint: 'Dinero devuelto y confirmado.' },
  FAILED: { label: 'Fallido', tone: 'danger', hint: 'No se pudo devolver. Hay que reintentarlo.' },
  DISPUTED: {
    label: 'En disputa',
    tone: 'danger',
    hint: 'El cliente lo disputó con su banco. Requiere seguimiento manual.',
  },
};

export function refundStatusMeta(status: string): RefundStatusMeta {
  return (
    REFUND_STATUS[status] ?? {
      label: status,
      tone: 'neutral',
      hint: 'Estado no reconocido por esta versión del panel.',
    }
  );
}

/**
 * Un reembolso que sigue abierto: nadie ha cerrado el segundo paso.
 * En producción Banorte no reembolsa por API, así que este es el estado normal
 * al solicitar — y el que quedaba invisible.
 */
export function isRefundOpen(status: string): boolean {
  return status === 'PENDING' || status === 'DISPUTED';
}

/** Espejo parcial de `Payment` (esquema Prisma). */
export type PaymentLike = {
  gateway?: string | null;
  status?: string | null;
  /** Lo realmente liquidado por la pasarela. Puede diferir del total de la orden. */
  amount?: string | number | null;
  currency?: string | null;
  /** Identificador de la pasarela. */
  externalId?: string | null;
  method?: string | null;
  brand?: string | null;
  lastFourDigits?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  /** Momento en que la pasarela cerró el cobro. */
  processedAt?: string | null;
} | null;

export type SettlementCheck = {
  /** Lo que la orden dice que se debía cobrar. */
  expected: number;
  /** Lo que la pasarela liquidó, si hay pago. */
  settled: number | null;
  /** `settled - expected`. Negativo = se liquidó de menos. */
  difference: number;
  /** Hay descuadre por encima de la tolerancia de centavos. */
  mismatch: boolean;
  currency: string;
};

/**
 * Compara total de orden contra lo liquidado.
 *
 * Se calcula siempre en la interfaz en vez de confiar en un flag del backend,
 * porque el `AuditEvent` de descuadre se emite en el momento del cobro y una
 * orden vieja puede no tenerlo aunque hoy no cuadre.
 */
export function checkSettlement(
  totalAmount: string | number | null | undefined,
  payment: PaymentLike,
  currency: string | null | undefined,
): SettlementCheck {
  const expected = toNumber(totalAmount);
  const hasSettledAmount = payment && payment.amount !== null && payment.amount !== undefined;
  const settled = hasSettledAmount ? toNumber(payment.amount) : null;
  const difference = settled === null ? 0 : settled - expected;
  return {
    expected,
    settled,
    difference,
    mismatch: settled !== null && isSettlementMismatch(expected, settled),
    currency: (payment?.currency || currency || 'MXN').toUpperCase(),
  };
}

export type TimelineStep = {
  key: string;
  label: string;
  at: string | null;
  detail?: string;
  state: 'done' | 'current' | 'pending' | 'failed';
};

export type OrderTimelineInput = {
  status: string;
  createdAt: string;
  completedAt?: string | null;
  refundedAt?: string | null;
  payment: PaymentLike;
  refunds: { status: string; requestedAt?: string | null; processedAt?: string | null }[];
  ticketCount: number;
  issuedTicketCount: number;
};

const FAILED_ORDER_STATES = new Set(['FAILED', 'CANCELLED', 'EXPIRED']);

/**
 * Línea de tiempo creada → intento de cobro → liquidada → emitida → reembolsada.
 *
 * Sirve para responder la pregunta que llega a soporte: "pagué y no me llegaron
 * los boletos, ¿dónde se atoró?". El paso de emisión es el que distingue un
 * `PENDING_REFUND` de una orden sana.
 */
export function buildOrderTimeline(order: OrderTimelineInput): TimelineStep[] {
  const { status, payment, refunds } = order;
  const steps: TimelineStep[] = [];

  steps.push({
    key: 'created',
    label: 'Orden creada',
    at: order.createdAt,
    state: 'done',
  });

  const attemptedAt = payment?.createdAt ?? null;
  const paymentStatus = (payment?.status ?? '').toUpperCase();
  const paymentFailed = paymentStatus === 'FAILED' || paymentStatus === 'DECLINED';
  steps.push({
    key: 'attempt',
    label: 'Intento de cobro',
    at: attemptedAt,
    detail: payment ? `${payment.gateway ?? 'pasarela'} · ${payment.status ?? 'sin estado'}` : undefined,
    state: !payment
      ? FAILED_ORDER_STATES.has(status)
        ? 'failed'
        : 'pending'
      : paymentFailed
        ? 'failed'
        : 'done',
  });

  const settledAt = payment?.processedAt ?? order.completedAt ?? null;
  const settled = !!payment && !paymentFailed && (paymentStatus === 'COMPLETED' || !!payment.processedAt);
  steps.push({
    key: 'settled',
    label: 'Liquidada por la pasarela',
    at: settledAt,
    state: settled ? 'done' : paymentFailed ? 'failed' : 'pending',
  });

  const issued = order.issuedTicketCount > 0;
  steps.push({
    key: 'issued',
    label: 'Boletos emitidos',
    at: null,
    detail: order.ticketCount
      ? `${order.issuedTicketCount} de ${order.ticketCount}`
      : 'Sin boletos asociados',
    state:
      status === 'PENDING_REFUND'
        ? 'failed'
        : issued && order.issuedTicketCount >= order.ticketCount
          ? 'done'
          : issued
            ? 'current'
            : 'pending',
  });

  const anyRefund = refunds.length > 0;
  if (anyRefund || status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED' || status === 'PENDING_REFUND') {
    const completed = refunds.filter((r) => r.status === 'COMPLETED');
    const open = refunds.filter((r) => isRefundOpen(r.status));
    steps.push({
      key: 'refunded',
      label: 'Reembolso',
      at: completed[0]?.processedAt ?? order.refundedAt ?? refunds[0]?.requestedAt ?? null,
      detail: !anyRefund
        ? 'Todavía no se ha solicitado'
        : open.length
          ? `${open.length} sin cerrar en Banorte`
          : `${completed.length} completado(s)`,
      state: !anyRefund ? 'pending' : open.length ? 'current' : completed.length ? 'done' : 'failed',
    });
  }

  return steps;
}
