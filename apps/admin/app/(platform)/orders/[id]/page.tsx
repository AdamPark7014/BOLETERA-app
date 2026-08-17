'use client';

/**
 * Detalle de orden.
 *
 * Responde las tres preguntas que llegan a soporte:
 *  1. ¿Dónde se atoró? → línea de tiempo creada → intento → liquidada → emitida.
 *  2. ¿Cuánto se le cobró de verdad? → desglose esperado vs. liquidado, porque
 *     `Payment.amount` ya no es necesariamente `Order.totalAmount`.
 *  3. ¿Se le devolvió el dinero? → reembolsos con su segundo paso a la vista.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../../_styles/platform.module.scss';
import styles from '../orders.module.scss';
import { Notice, ResourceView } from '../_ui/States';
import { useResource } from '../_ui/useResource';
import {
  formatDateTime,
  formatMoney,
  formatMoneyDelta,
  formatNumber,
  toNumber,
} from '../_ui/format';
import {
  buildOrderTimeline,
  checkSettlement,
  isRefundOpen,
  orderStatusMeta,
  refundStatusMeta,
  type OrderStatusTone,
  type PaymentLike,
  type TimelineStep,
} from '../_ui/orderModel';

type Refund = {
  id: string;
  amount: string;
  reason: string;
  status: string;
  notes: string | null;
  requestedBy: string | null;
  processedBy: string | null;
  requestedAt: string;
  processedAt: string | null;
};

type OrderDetail = {
  id: string;
  publicId: string;
  status: string;
  channel: string;
  subtotal: string | null;
  fees: string | null;
  discountAmount: string | null;
  taxAmount: string | null;
  totalAmount: string;
  commissionAmount: string | null;
  currency: string;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  paymentMethod: string | null;
  createdAt: string;
  completedAt: string | null;
  refundedAt: string | null;
  event: { id: string; title: string; slug: string };
  payment: (PaymentLike & { id?: string }) | null;
  refunds: Refund[];
  items: {
    id: string;
    quantity: number;
    unitPrice: string;
    unitFees: string | null;
    subtotal: string;
    tickets: {
      id: string;
      code: string;
      status: string;
      section: string | null;
      row: string | null;
      seatNumber: string | null;
    }[];
  }[];
};

const toneClass: Record<OrderStatusTone, string> = {
  ok: 'paid',
  pending: 'pending',
  danger: 'canceled',
  neutral: 'refunded',
  attention: 'hold',
};

const REFUND_REASONS: { value: string; label: string }[] = [
  { value: 'CUSTOMER_REQUEST', label: 'Solicitud del cliente' },
  { value: 'EVENT_CANCELLED', label: 'Evento cancelado' },
  { value: 'PAYMENT_ERROR', label: 'Error de cobro' },
  { value: 'TICKET_NOT_RECEIVED', label: 'No recibió los boletos' },
  { value: 'DUPLICATE', label: 'Cobro duplicado' },
  { value: 'CUSTOMER_CHANGED_MIND', label: 'Cambio de opinión' },
  { value: 'FRAUD', label: 'Fraude' },
];

/** Boletos que cuentan como emitidos para la línea de tiempo. */
const ISSUED_TICKET_STATES = new Set(['VALID', 'ISSUED', 'USED', 'TRANSFERRED', 'SCANNED']);

export default function OrderDetailPage() {
  const params = useParams();
  const id = String(params.id);

  const resource = useResource<OrderDetail>(
    useCallback(
      ({ token, signal }) => adminApi<OrderDetail>(`/admin/orders/${id}`, token, { signal }),
      [id],
    ),
    { requiresOrg: false, deps: [id] },
  );

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Orden {resource.state.phase === 'ready' ? resource.state.data.publicId : id}</h1>
          <p>Detalle, conciliación y reembolsos</p>
        </div>
        <Link href="/orders" className={platform.ghostBtn}>
          ← Volver a órdenes
        </Link>
      </header>

      <ResourceView resource={resource} context="la orden" loadingRows={5}>
        {(order) => <OrderBody order={order} reload={resource.reload} />}
      </ResourceView>
    </div>
  );
}

function OrderBody({ order, reload }: { order: OrderDetail; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('CUSTOMER_REQUEST');
  const [refundNotes, setRefundNotes] = useState('');
  /** Instrucción del backend cuando el reembolso queda a medias. */
  const [nextStep, setNextStep] = useState<string | null>(null);

  const meta = orderStatusMeta(order.status);
  const settlement = checkSettlement(order.totalAmount, order.payment, order.currency);
  const tickets = order.items.flatMap((i) => i.tickets);
  const issued = tickets.filter((t) => ISSUED_TICKET_STATES.has(t.status)).length;
  const openRefunds = order.refunds.filter((r) => isRefundOpen(r.status));
  const refundedTotal = order.refunds
    .filter((r) => r.status === 'COMPLETED')
    .reduce((s, r) => s + toNumber(r.amount), 0);

  const timeline = buildOrderTimeline({
    status: order.status,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    refundedAt: order.refundedAt,
    payment: order.payment,
    refunds: order.refunds,
    ticketCount: tickets.length,
    issuedTicketCount: issued,
  });

  /** Lo que aún se le debe al cliente si la orden quedó en reembolso obligado. */
  const owedToCustomer = Math.max((settlement.settled ?? 0) - refundedTotal, 0);

  function fail(e: unknown, fallback: string) {
    toast.error(e instanceof ApiError ? e.userMessage : e instanceof Error ? e.message : fallback);
  }

  async function requestRefund() {
    const token = getStoredToken();
    if (!token) return;
    const amount = refundAmount.trim() ? Number(refundAmount) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      toast.error('El monto a reembolsar debe ser un número mayor que cero.');
      return;
    }
    setBusy('refund');
    setNextStep(null);
    try {
      const res = await adminApi<{
        refund: { id: string; status: string; amount: string };
        nextStep?: string | null;
      }>(`/admin/orders/${order.id}/refund`, token, {
        method: 'POST',
        body: JSON.stringify({
          reason: refundReason,
          amount,
          notes: refundNotes.trim() || undefined,
        }),
      });
      if (res.refund?.status === 'COMPLETED') {
        toast.success('Reembolso completado por la pasarela.');
      } else {
        // Camino normal en producción: Banorte no reembolsa por API.
        setNextStep(
          res.nextStep ??
            'Procesa el reembolso en el portal Banorte y márcalo como completado aquí.',
        );
        toast.success('Reembolso registrado — falta el paso 2 en el portal Banorte.');
      }
      setRefundAmount('');
      setRefundNotes('');
      reload();
    } catch (e) {
      fail(e, 'No se pudo registrar el reembolso');
    } finally {
      setBusy(null);
    }
  }

  async function completeRefund(refundId: string) {
    const token = getStoredToken();
    if (!token) return;
    const ref = window.prompt(
      'Referencia Banorte del reembolso ya ejecutado (opcional pero recomendada para conciliar).',
      '',
    );
    if (ref === null) return;
    setBusy(refundId);
    try {
      await adminApi(`/payments/refunds/${refundId}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({ banorteReference: ref.trim() || undefined }),
      });
      toast.success('Reembolso cerrado · inventario liberado');
      setNextStep(null);
      reload();
    } catch (e) {
      fail(e, 'No se pudo cerrar el reembolso');
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    const token = getStoredToken();
    if (!token) return;
    setBusy('resend');
    try {
      await adminApi(`/admin/orders/${order.id}/resend-email`, token, {
        method: 'POST',
        body: '{}',
      });
      toast.success(`Correo reenviado a ${order.buyerEmail ?? 'el comprador'}`);
    } catch (e) {
      fail(e, 'No se pudo reenviar el correo');
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    const token = getStoredToken();
    if (!token) return;
    if (!confirm('¿Cancelar esta orden pendiente? Se liberará el inventario apartado.')) return;
    setBusy('cancel');
    try {
      await adminApi(`/admin/orders/${order.id}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelada desde el panel de administración' }),
      });
      toast.success('Orden cancelada');
      reload();
    } catch (e) {
      fail(e, 'No se pudo cancelar la orden');
    } finally {
      setBusy(null);
    }
  }

  const canRefund = order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED' || order.status === 'PENDING_REFUND';

  return (
    <>
      {order.status === 'PENDING_REFUND' && (
        <Notice tone="danger" title="Reembolso obligado — el dinero es del cliente">
          <p>
            El cobro se liquidó pero no fue posible emitir los boletos. Hay que devolver{' '}
            <strong>{formatMoney(owedToCustomer, settlement.currency)}</strong>
            {refundedTotal > 0 && (
              <> (ya se devolvieron {formatMoney(refundedTotal, settlement.currency)})</>
            )}
            .
          </p>
        </Notice>
      )}

      {settlement.mismatch && (
        <Notice tone="warn" title="Lo liquidado no coincide con el total de la orden">
          <p>
            La orden esperaba {formatMoney(settlement.expected, settlement.currency)} y la pasarela
            liquidó {formatMoney(settlement.settled ?? 0, settlement.currency)} (
            {formatMoneyDelta(settlement.difference, settlement.currency)}). Concilia contra el
            estado de cuenta antes de liquidar al promotor; el backend registra este caso como{' '}
            <code>payment.settlement_mismatch</code> en la bitácora.
          </p>
        </Notice>
      )}

      {openRefunds.length > 0 && (
        <Notice
          tone="warn"
          title={`${openRefunds.length} reembolso(s) sin cerrar`}
        >
          <p>
            Están registrados en el sistema pero el dinero no ha salido hasta que se ejecuten en el
            portal Banorte y se marquen aquí como completados. Mientras tanto el inventario no se
            libera.
          </p>
        </Notice>
      )}

      <section className={platform.panel}>
        <div className={styles.detailGrid}>
          <div>
            <h2>Estado</h2>
            <p>
              <span className={`${styles.status} ${styles[toneClass[meta.tone]]}`}>{meta.label}</span>
              <br />
              <small className={styles.subtle}>{meta.hint}</small>
            </p>
          </div>
          <div>
            <h2>Comprador</h2>
            <p>
              <strong>{order.buyerName || 'Sin nombre'}</strong>
              <br />
              {order.buyerEmail || '—'}
              {order.buyerPhone && (
                <>
                  <br />
                  {order.buyerPhone}
                </>
              )}
            </p>
          </div>
          <div>
            <h2>Evento</h2>
            <p>
              {order.event.title}
              <br />
              <small className={styles.subtle}>Canal {order.channel}</small>
            </p>
          </div>
          <div>
            <h2>Creada</h2>
            <p>{formatDateTime(order.createdAt)}</p>
          </div>
        </div>

        <div className={styles.actions}>
          {canRefund && (
            <a href="#reembolsos" className={platform.ghostBtn}>
              Ir a reembolsos
            </a>
          )}
          <button
            type="button"
            className={platform.ghostBtn}
            disabled={busy !== null}
            onClick={() => void resend()}
          >
            {busy === 'resend' ? 'Reenviando…' : 'Reenviar correo'}
          </button>
          {order.status === 'PENDING' && (
            <button
              type="button"
              className={platform.ghostBtn}
              disabled={busy !== null}
              onClick={() => void cancel()}
            >
              {busy === 'cancel' ? 'Cancelando…' : 'Cancelar orden'}
            </button>
          )}
        </div>
      </section>

      <div className={styles.detailCols}>
        <section className={platform.panel}>
          <h2>Desglose de dinero</h2>
          <table className={styles.breakdown}>
            <caption className={styles.srOnly}>
              Comparación entre lo esperado por la orden y lo liquidado por la pasarela
            </caption>
            <tbody>
              <tr>
                <th scope="row">Subtotal</th>
                <td>{formatMoney(order.subtotal, order.currency)}</td>
              </tr>
              <tr>
                <th scope="row">Cargos por servicio</th>
                <td>{formatMoney(order.fees, order.currency)}</td>
              </tr>
              {toNumber(order.discountAmount) > 0 && (
                <tr>
                  <th scope="row">Descuento</th>
                  <td>−{formatMoney(order.discountAmount, order.currency)}</td>
                </tr>
              )}
              {toNumber(order.taxAmount) > 0 && (
                <tr>
                  <th scope="row">Impuestos</th>
                  <td>{formatMoney(order.taxAmount, order.currency)}</td>
                </tr>
              )}
              <tr className={styles.breakdownTotal}>
                <th scope="row">Esperado (total de la orden)</th>
                <td>{formatMoney(order.totalAmount, order.currency)}</td>
              </tr>
              <tr className={styles.breakdownSettled}>
                <th scope="row">Cobrado (liquidado por la pasarela)</th>
                <td>
                  {settlement.settled === null
                    ? 'Sin pago registrado'
                    : formatMoney(settlement.settled, settlement.currency)}
                </td>
              </tr>
              {settlement.mismatch && (
                <tr className={styles.breakdownDiff}>
                  <th scope="row">Diferencia</th>
                  <td>{formatMoneyDelta(settlement.difference, settlement.currency)}</td>
                </tr>
              )}
              {refundedTotal > 0 && (
                <tr>
                  <th scope="row">Reembolsado (completado)</th>
                  <td>−{formatMoney(refundedTotal, settlement.currency)}</td>
                </tr>
              )}
              {toNumber(order.commissionAmount) > 0 && (
                <tr>
                  <th scope="row">Comisión de la plataforma</th>
                  <td>{formatMoney(order.commissionAmount, order.currency)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2 className={platform.withBorder}>Pago</h2>
          {order.payment ? (
            <dl className={styles.metaList}>
              <dt>Pasarela</dt>
              <dd>{order.payment.gateway ?? '—'}</dd>
              <dt>Estado</dt>
              <dd>{order.payment.status ?? '—'}</dd>
              <dt>Método</dt>
              <dd>
                {[order.payment.brand, order.payment.method, order.payment.lastFourDigits && `••••${order.payment.lastFourDigits}`]
                  .filter(Boolean)
                  .join(' · ') || order.paymentMethod || '—'}
              </dd>
              <dt>Referencia</dt>
              <dd>
                <code>{order.payment.externalId ?? '—'}</code>
              </dd>
              <dt>Liquidado</dt>
              <dd>{formatDateTime(order.payment.processedAt)}</dd>
              {order.payment.errorMessage && (
                <>
                  <dt>Error de la pasarela</dt>
                  <dd>{order.payment.errorMessage}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className={styles.subtle}>
              No hay registro de pago para esta orden. Si el cliente asegura haber pagado, revisa la
              conciliación SPEI antes de reembolsar.
            </p>
          )}
        </section>

        <section className={platform.panel}>
          <h2>Línea de tiempo</h2>
          <ol className={styles.timeline}>
            {timeline.map((step) => (
              <TimelineRow key={step.key} step={step} />
            ))}
          </ol>
        </section>
      </div>

      <section className={platform.panel} id="reembolsos">
        <h2>Reembolsos</h2>
        <p className={styles.subtle} style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
          Proceso de dos pasos. <strong>Paso 1</strong>: registrar la solicitud aquí.{' '}
          <strong>Paso 2</strong>: ejecutarla en el portal Banorte y marcarla como completada — en
          producción la pasarela no reembolsa por API, así que sin el paso 2 el dinero no sale.
        </p>

        {canRefund && (
          <div className={styles.refundForm}>
            <label htmlFor="refund-amount">
              Monto (vacío = total liquidado)
              <input
                id="refund-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder={
                  settlement.settled !== null ? String(settlement.settled) : order.totalAmount
                }
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </label>
            <label htmlFor="refund-reason">
              Motivo
              <select
                id="refund-reason"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              >
                {REFUND_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="refund-notes">
              Nota interna
              <input
                id="refund-notes"
                type="text"
                value={refundNotes}
                placeholder="Opcional"
                onChange={(e) => setRefundNotes(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={platform.primaryBtn}
              disabled={busy !== null}
              onClick={() => void requestRefund()}
            >
              <span className={styles.stepBadge}>Paso 1</span>
              {busy === 'refund' ? 'Registrando…' : 'Registrar reembolso'}
            </button>
          </div>
        )}

        {nextStep && (
          <Notice tone="info" title="Siguiente paso indicado por el sistema">
            <p className={styles.nextStep}>{nextStep}</p>
          </Notice>
        )}

        {order.refunds.length === 0 ? (
          <p className={styles.refundEmpty}>
            Sin reembolsos registrados para esta orden.
          </p>
        ) : (
          <ul className={styles.refundList}>
            {order.refunds.map((r) => {
              const rmeta = refundStatusMeta(r.status);
              return (
                <li key={r.id} className={styles.refundRow}>
                  <div>
                    <p>
                      <strong>{formatMoney(r.amount, order.currency)}</strong>{' '}
                      <span className={`${styles.status} ${styles[toneClass[rmeta.tone]]}`}>
                        {rmeta.label}
                      </span>
                    </p>
                    <small>{rmeta.hint}</small>
                    <small>
                      Solicitado {formatDateTime(r.requestedAt)}
                      {r.requestedBy ? ` por ${r.requestedBy}` : ''}
                      {r.processedAt ? ` · cerrado ${formatDateTime(r.processedAt)}` : ''}
                      {r.processedBy ? ` por ${r.processedBy}` : ''}
                    </small>
                    {r.notes && <small>Nota: {r.notes}</small>}
                  </div>
                  {isRefundOpen(r.status) && (
                    <button
                      type="button"
                      className={platform.primaryBtn}
                      disabled={busy !== null}
                      onClick={() => void completeRefund(r.id)}
                    >
                      <span className={styles.stepBadge}>Paso 2</span>
                      {busy === r.id ? 'Cerrando…' : 'Marcar pagado en Banorte'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={platform.panel}>
        <h2>Boletos ({formatNumber(tickets.length)})</h2>
        {tickets.length === 0 ? (
          <p className={styles.subtle}>
            Esta orden no tiene boletos emitidos.
            {order.status === 'PENDING_REFUND' &&
              ' Ese es justamente el motivo del reembolso obligado.'}
          </p>
        ) : (
          <table className={styles.ticketTable}>
            <caption className={styles.srOnly}>Boletos emitidos para esta orden</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Ubicación</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <th scope="row">
                    <code className={styles.code}>{t.code}</code>
                  </th>
                  <td>
                    {[t.section, t.row && `Fila ${t.row}`, t.seatNumber && `Asiento ${t.seatNumber}`]
                      .filter(Boolean)
                      .join(' · ') || 'General'}
                  </td>
                  <td>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

const STEP_LABEL: Record<TimelineStep['state'], string> = {
  done: 'Listo',
  current: 'En curso',
  pending: 'Pendiente',
  failed: 'Falló',
};

function TimelineRow({ step }: { step: TimelineStep }) {
  const dotClass =
    step.state === 'done'
      ? styles.tlDone
      : step.state === 'current'
        ? styles.tlCurrent
        : step.state === 'failed'
          ? styles.tlFailed
          : styles.tlPending;
  return (
    <li className={styles.tlItem}>
      <span className={`${styles.tlDot} ${dotClass}`} aria-hidden="true" />
      <p>
        {step.label}
        {/* El estado va también en texto: el punto de color no basta. */}
        <span className={styles.tlState}>{STEP_LABEL[step.state]}</span>
      </p>
      {step.at && <small>{formatDateTime(step.at)}</small>}
      {step.detail && <small>{step.detail}</small>}
    </li>
  );
}
