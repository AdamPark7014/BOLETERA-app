'use client';

import { formatMoney } from '@/lib/pricing';
import {
  COMPENSATION_LEGAL_NOTE,
  type OrderRefund,
  formatPolicyDate,
  formatShortDate,
  orderHasRefund,
  buyerRefundPolicy,
  refundDeadlines,
  refundFallbackCopy,
  refundMethodLabel,
  refundStatusCopy,
  summarizeRefunds,
  isCompensationRefund,
} from '@/lib/refund-policy';
import { RefundClabeForm, type RefundPayout } from './RefundClabeForm';
import styles from './order.module.scss';

/** Fila de reembolso con la cuenta SPEI que el API devuelve (CLABE enmascarada). */
export type BuyerRefund = OrderRefund & Omit<RefundPayout, 'id'>;

/**
 * Métodos cuyo reembolso vuelve al mismo instrumento. Mismo criterio que el
 * API (`buyer-self-service.service.ts`): ahí no se pide CLABE.
 */
const CARD_LIKE_METHODS = new Set(['CARD', 'CLIP', 'APPLE_PAY', 'GOOGLE_PAY', 'PAYPAL']);

/** Credencial y destino para que el panel pueda guardar la CLABE. */
export type RefundPanelAccess = {
  apiBase: string;
  publicId: string;
  accessToken?: string | null;
  onSaved?: () => void;
  /** Falso si la vista ya pinta otro botón primario. */
  primary?: boolean;
};

/**
 * Lo que esta vista necesita saber de la orden para contar el reembolso.
 *
 * `refunds` va opcional porque hoy `GET /orders/:publicId` no lo devuelve: el
 * `include` vive en el módulo `orders`, fuera de este cambio. Con el detalle se
 * enseña el desglose y las fechas; sin él se degrada a un mensaje honesto
 * derivado del estado de la orden, nunca a un importe inventado.
 */
export type RefundAwareOrder = {
  status: string;
  currency: string;
  paymentMethod?: string | null;
  totalAmount: string;
  subtotal?: string;
  fees?: string;
  taxAmount?: string;
  createdAt?: string | null;
  completedAt?: string | null;
  refundedAt?: string | null;
  refunds?: BuyerRefund[] | null;
  /** Plazo que el API calculó para esta orden. El correo lee el mismo número. */
  settlementBusinessDays?: number | null;
  bankBusinessDays?: number | null;
  event?: { title?: string; status?: string | null; cancelledAt?: string | null } | null;
};

/**
 * Aviso de evento cancelado, arriba del todo.
 *
 * Si el evento se cayó, esa es la noticia: enterrarla bajo el detalle de la
 * compra obliga al comprador a deducirla de un estado en inglés.
 */
export function EventCancelledBanner({ order }: { order: RefundAwareOrder }) {
  if (order.event?.status !== 'CANCELLED') return null;
  const when = order.event?.cancelledAt ? formatShortDate(order.event.cancelledAt) : null;

  return (
    <section className={styles.cancelBanner} aria-labelledby="cancel-banner-title">
      <p className={styles.cancelKicker}>Evento cancelado</p>
      <h2 id="cancel-banner-title">
        {order.event?.title
          ? `${order.event.title} no se va a realizar`
          : 'El evento fue cancelado'}
      </h2>
      <p>
        {when ? `Se canceló el ${when}. ` : ''}
        Tus boletos ya no sirven para entrar y no tienes que hacer ningún trámite: la devolución la
        iniciamos nosotros.
      </p>
    </section>
  );
}

/** Fila etiqueta/valor del desglose. */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <li className={strong ? styles.refundRowStrong : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );
}

/**
 * Estado del reembolso: cuánto, por qué medio, para cuándo y por qué.
 *
 * El plazo NO se escribe aquí. Sale de `lib/refund-policy`, que es el único
 * sitio donde está definido y configurable por entorno; si cada pantalla lo
 * escribiera, acabarían contradiciéndose entre ellas y con el correo.
 */
export function RefundStatusPanel({
  order,
  access,
}: {
  order: RefundAwareOrder;
  /** Sin esto el panel solo informa; con esto ofrece capturar la CLABE. */
  access?: RefundPanelAccess;
}) {
  const summary = summarizeRefunds(order.refunds);
  if (!summary && !orderHasRefund(order.status)) return null;

  const currency = order.currency || 'MXN';
  const methodLabel = refundMethodLabel(order.paymentMethod);

  // Sin filas de `Refund` no hay importe ni fecha que afirmar: se dice lo que
  // se sabe y se remite al correo, en vez de fabricar una promesa.
  if (!summary) {
    const fallback = refundFallbackCopy(order.status);
    if (!fallback) return null;
    return (
      <section
        className={`${styles.refundPanel} ${styles[`tone_${fallback.tone}`]}`}
        aria-labelledby="refund-title"
      >
        <p className={styles.refundKicker}>Reembolso</p>
        <h2 id="refund-title">{fallback.headline}</h2>
        <p className={styles.refundDetail}>{fallback.detail}</p>
        <ul className={styles.refundRows}>
          <Row label="Medio" value={methodLabel} />
        </ul>
      </section>
    );
  }

  const anchor =
    summary.requestedAt ?? (order.refundedAt ? new Date(order.refundedAt) : new Date());
  const deadlines = refundDeadlines(
    anchor,
    buyerRefundPolicy(order.settlementBusinessDays, order.bankBusinessDays)
  );
  const sentBy = formatPolicyDate(deadlines.sentBy);
  const visibleBy = formatPolicyDate(deadlines.visibleBy);
  const copy = refundStatusCopy(summary.status, { methodLabel, sentBy, visibleBy });

  // La CLABE se pide sobre la devolución pendiente (no la bonificación) y solo
  // si el pago no fue con tarjeta: el API aplica la misma regla y es quien manda.
  const method = String(order.paymentMethod ?? '').toUpperCase();
  const pending = (order.refunds ?? []).find(
    (r) => Boolean(r.id) && String(r.status).toUpperCase() === 'PENDING' && !isCompensationRefund(r)
  );
  const payoutRefund: RefundPayout | null =
    pending?.id && !CARD_LIKE_METHODS.has(method) ? { ...pending, id: pending.id } : null;

  const total = Number(order.totalAmount) || 0;
  // El desglose solo se enseña si lo devuelto ES el cobro íntegro. Repartir un
  // importe parcial entre boleto, cargo e IVA sería aritmética inventada.
  const isFull = Math.abs(summary.refundedTotal - total) < 0.01;
  const hasBreakdown =
    isFull && order.subtotal != null && order.fees != null && order.taxAmount != null;

  return (
    <section
      className={`${styles.refundPanel} ${styles[`tone_${copy.tone}`]}`}
      aria-labelledby="refund-title"
    >
      <p className={styles.refundKicker}>Reembolso</p>
      <h2 id="refund-title">{copy.headline}</h2>
      <p className={styles.refundDetail}>{copy.detail}</p>

      <ul className={styles.refundRows}>
        {hasBreakdown && (
          <>
            <Row label="Precio de los boletos" value={formatMoney(order.subtotal ?? 0, currency)} />
            <Row label="Cargo por servicio" value={formatMoney(order.fees ?? 0, currency)} />
            <Row label="IVA" value={formatMoney(order.taxAmount ?? 0, currency)} />
          </>
        )}
        <Row
          label={isFull ? 'Total que te devolvemos' : 'Importe que te devolvemos'}
          value={formatMoney(summary.refundedTotal, currency)}
          strong
        />
        <Row label="Medio" value={methodLabel} />
        <Row label="Sale hacia tu banco" value={`a más tardar el ${sentBy}`} />
        <Row label="Lo verás abonado" value={`a más tardar el ${visibleBy}`} />
      </ul>

      {hasBreakdown && (
        <p className={styles.refundNote}>
          Te devolvemos el importe completo: el precio del boleto y también el cargo por servicio y
          el IVA. No descontamos nada por gestión.
        </p>
      )}

      {summary.compensationTotal > 0 && (
        <div className={styles.compensation}>
          <h3>Además: bonificación de {formatMoney(summary.compensationTotal, currency)}</h3>
          <p>
            Es una indemnización adicional por la cancelación, <strong>no</strong> parte de tu
            devolución. Se paga aparte, por el mismo medio y con el mismo plazo.
          </p>
          <p className={styles.refundNote}>{COMPENSATION_LEGAL_NOTE}</p>
        </div>
      )}

      {access && payoutRefund && (
        <RefundClabeForm
          key={payoutRefund.id}
          apiBase={access.apiBase}
          publicId={access.publicId}
          accessToken={access.accessToken}
          refund={payoutRefund}
          onSaved={access.onSaved}
          primary={access.primary}
        />
      )}
    </section>
  );
}

type Step = {
  label: string;
  detail?: string;
  date: Date | null;
  /** Todavía no ha pasado: se marca con palabras, no solo con color. */
  future?: boolean;
};

/**
 * Línea de tiempo de la orden.
 *
 * Un comprador con una orden reembolsada veía un estado y poco más. Aquí ve
 * qué pasó y cuándo, con fechas reales; los pasos que aún no ocurren se
 * etiquetan «Previsto» en texto, no solo con un color más pálido (WCAG 1.4.1).
 */
export function OrderTimeline({
  order,
  hasTickets,
}: {
  order: RefundAwareOrder;
  hasTickets: boolean;
}) {
  const summary = summarizeRefunds(order.refunds);
  const parse = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const steps: Step[] = [];
  const createdAt = parse(order.createdAt);
  if (createdAt) steps.push({ label: 'Orden creada', date: createdAt });

  const completedAt = parse(order.completedAt);
  if (completedAt) {
    steps.push({ label: 'Pago confirmado', date: completedAt });
    if (hasTickets) {
      steps.push({
        label: 'Boletos emitidos',
        detail: 'Se emitieron al confirmarse el pago.',
        date: completedAt,
      });
    }
  }

  const cancelledAt = parse(order.event?.cancelledAt);
  if (order.event?.status === 'CANCELLED' && cancelledAt) {
    steps.push({ label: 'Evento cancelado', date: cancelledAt });
  }

  const refundedAt = summary?.requestedAt ?? parse(order.refundedAt);
  if (refundedAt) {
    steps.push({
      label: 'Reembolso aprobado',
      detail: 'Autorizado e importe apartado.',
      date: refundedAt,
    });
    const deadlines = refundDeadlines(
      refundedAt,
      buyerRefundPolicy(order.settlementBusinessDays, order.bankBusinessDays)
    );
    if (summary?.status === 'COMPLETED') {
      steps.push({
        label: 'Reembolso enviado a tu banco',
        detail: `Tu banco lo refleja a más tardar el ${formatPolicyDate(deadlines.visibleBy)}.`,
        date: null,
      });
    } else if (!summary || summary.status === 'PENDING') {
      steps.push({
        label: 'Envío al banco',
        detail: 'Lo liquidamos en el portal del banco.',
        date: deadlines.sentBy,
        future: true,
      });
      steps.push({
        label: 'Abono visible en tu cuenta',
        date: deadlines.visibleBy,
        future: true,
      });
    }
  } else if (orderHasRefund(order.status)) {
    steps.push({ label: 'Reembolso en proceso', date: null });
  }

  if (steps.length < 2) return null;

  return (
    <section className={styles.section} aria-labelledby="timeline-title">
      <h2 id="timeline-title">Historia de tu orden</h2>
      <ol className={styles.timeline}>
        {steps.map((step, index) => (
          <li
            key={`${step.label}-${index}`}
            className={step.future ? styles.timelineFuture : undefined}
          >
            <span className={styles.timelineDot} aria-hidden="true" />
            <div>
              <p className={styles.timelineLabel}>
                {step.label}
                {step.future && <span className={styles.timelineTag}> · Previsto</span>}
              </p>
              <p className={styles.timelineDate}>
                {step.date
                  ? `${step.future ? 'A más tardar el ' : ''}${formatShortDate(step.date)}`
                  : 'Sin fecha registrada'}
              </p>
              {step.detail && <p className={styles.timelineDetail}>{step.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
