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

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Field, Money, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Param, SheetSelect } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount, formatWhen } from '../../events/_ticket/read';
import bt from '../_bt/bt.module.scss';
import {
  REFUND_REASON_OPTIONS,
  channelWord,
  refundReasonWord,
  ticketStatusWord,
} from '../_bt/read';
import { formatMoney, formatMoneyDelta, toNumber } from '../_ui/format';
import {
  buildOrderTimeline,
  checkSettlement,
  isRefundOpen,
  orderStatusMeta,
  refundStatusMeta,
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
  /** Cuenta que dejó el comprador para devolución SPEI/OXXO. */
  payoutClabe?: string | null;
  payoutAccountHolder?: string | null;
  payoutClabeAt?: string | null;
};

/** Roles que ven la CLABE completa para pagar el reembolso. El resto, últimos 4. */
const CLABE_FULL_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'FINANCE']);

/** Últimos 4 a la vista; el resto con puntos. */
function maskClabe(clabe: string): string {
  return `${'•'.repeat(Math.max(clabe.length - 4, 0))}${clabe.slice(-4)}`;
}

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
  posOps?: { affiliateRef?: string; isComp?: boolean; compReason?: string } | null;
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

/** Boletos que cuentan como emitidos para la línea de tiempo. */
const ISSUED_TICKET_STATES = new Set(['VALID', 'ISSUED', 'USED', 'TRANSFERRED', 'SCANNED']);

const STEP_LABEL: Record<TimelineStep['state'], string> = {
  done: 'Listo',
  current: 'En curso',
  pending: 'Pendiente',
  failed: 'Falló',
};

function failMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <OrdenBody />
      </AdminFrame>
    </Suspense>
  );
}

function OrdenBody() {
  const params = useParams();
  const id = String(params.id);
  const session = useSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'orders.view');

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<OrderDetail>(`/admin/orders/${encodeURIComponent(id)}`, token)
      .then((payload) => {
        if (alive) setOrder(payload);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, token, canSee, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Orden</h1>
          <p className={styles.quiet}>Tu rol no ve órdenes.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView error={error} context="abrir la orden" onRetry={() => setNonce((n) => n + 1)} />
    );
  }
  if (loading || !token || !order) return <p className={styles.quiet}>Cargando orden.</p>;

  return (
    <OrderView
      order={order}
      token={token}
      role={session.role}
      reload={() => setNonce((n) => n + 1)}
    />
  );
}

function OrderView({
  order,
  token,
  role,
  reload,
}: {
  order: OrderDetail;
  token: string;
  role: string | null;
  reload: () => void;
}) {
  const seesFullClabe = CLABE_FULL_ROLES.has(String(role ?? '').toUpperCase());
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('CUSTOMER_REQUEST');
  const [refundNotes, setRefundNotes] = useState('');
  const [references, setReferences] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** Instrucción del backend cuando el reembolso queda a medias. */
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currency = (order.currency || 'MXN').toUpperCase();
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
  const affiliateRef =
    typeof order.posOps?.affiliateRef === 'string' ? order.posOps.affiliateRef : null;
  const canRefund =
    order.status === 'COMPLETED' ||
    order.status === 'PARTIALLY_REFUNDED' ||
    order.status === 'PENDING_REFUND';

  function begin(key: string) {
    setBusy(key);
    setActionError(null);
    setNotice(null);
  }

  async function requestRefund() {
    const amount = refundAmount.trim() ? Number(refundAmount) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      setActionError('El monto a reembolsar debe ser un número mayor que cero.');
      return;
    }
    begin('refund');
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
        setNotice('Reembolso completado por la pasarela.');
      } else {
        // Camino normal en producción: Banorte no reembolsa por API.
        setNextStep(
          res.nextStep ??
            'Procesa el reembolso en el portal Banorte y márcalo como completado aquí.'
        );
        setNotice('Reembolso registrado. Falta el paso 2 en el portal Banorte.');
      }
      setRefundAmount('');
      setRefundNotes('');
      reload();
    } catch (e) {
      setActionError(failMessage(e, 'No se pudo registrar el reembolso.'));
    } finally {
      setBusy(null);
    }
  }

  async function completeRefund(refundId: string) {
    begin(refundId);
    const ref = (references[refundId] ?? '').trim();
    try {
      await adminApi(`/payments/refunds/${refundId}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({ banorteReference: ref || undefined }),
      });
      setNotice('Reembolso cerrado · inventario liberado.');
      setNextStep(null);
      reload();
    } catch (e) {
      setActionError(failMessage(e, 'No se pudo cerrar el reembolso.'));
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    begin('resend');
    try {
      await adminApi(`/admin/orders/${order.id}/resend-email`, token, {
        method: 'POST',
        body: '{}',
      });
      setNotice(`Correo reenviado a ${order.buyerEmail ?? 'el comprador'}.`);
    } catch (e) {
      setActionError(failMessage(e, 'No se pudo reenviar el correo.'));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    begin('cancel');
    try {
      await adminApi(`/admin/orders/${order.id}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelada desde el panel de administración' }),
      });
      setNotice('Orden cancelada. Se liberó el inventario apartado.');
      setConfirmCancel(false);
      reload();
    } catch (e) {
      setActionError(failMessage(e, 'No se pudo cancelar la orden.'));
    } finally {
      setBusy(null);
    }
  }

  const paymentMethod = order.payment
    ? [
        order.payment.brand,
        order.payment.method,
        order.payment.lastFourDigits ? `•••• ${order.payment.lastFourDigits}` : null,
      ]
        .filter(Boolean)
        .join(' · ') ||
      order.paymentMethod ||
      '—'
    : null;

  const moneyLines = [
    { label: 'Subtotal', amount: toNumber(order.subtotal) },
    { label: 'Cargos por servicio', amount: toNumber(order.fees) },
    ...(toNumber(order.discountAmount) > 0
      ? [{ label: 'Descuento', amount: -toNumber(order.discountAmount) }]
      : []),
    ...(toNumber(order.taxAmount) > 0
      ? [{ label: 'Impuestos', amount: toNumber(order.taxAmount) }]
      : []),
  ];

  return (
    <section>
      <header className={styles.sectionHead}>
        <div className={bt.actions}>
          <TicketButton variant="ghost" onClick={() => router.push('/orders')}>
            Órdenes
          </TicketButton>
        </div>
        <h1 className={styles.sectionTitle}>
          Orden <span className={styles.mono}>{order.publicId}</span>
        </h1>
        <p className={styles.quiet}>
          {order.event.title} · {order.buyerName || 'Sin nombre'}
        </p>
      </header>

      {order.status === 'PENDING_REFUND' ? (
        <p className={styles.danger} role="alert">
          Reembolso obligado: el cobro se liquidó pero no fue posible emitir los boletos. Hay que
          devolver {formatMoney(owedToCustomer, settlement.currency)}
          {refundedTotal > 0
            ? ` (ya se devolvieron ${formatMoney(refundedTotal, settlement.currency)})`
            : ''}
          .
        </p>
      ) : null}
      {settlement.mismatch ? (
        <p className={styles.danger} role="alert">
          Lo liquidado no coincide con el total. La orden esperaba{' '}
          {formatMoney(settlement.expected, settlement.currency)} y la pasarela liquidó{' '}
          {formatMoney(settlement.settled ?? 0, settlement.currency)} (
          {formatMoneyDelta(settlement.difference, settlement.currency)}). Concilia contra el estado
          de cuenta antes de liquidar al promotor; la bitácora lo registra como
          payment.settlement_mismatch.
        </p>
      ) : null}
      {openRefunds.length > 0 ? (
        <p className={styles.quiet}>
          {formatCount(openRefunds.length)} reembolso(s) sin cerrar. El dinero no sale hasta
          ejecutarlos en el portal Banorte y marcarlos aquí; mientras tanto el inventario no se
          libera.
        </p>
      ) : null}

      <div className={styles.stack}>
        <Param name="Estado">
          <ParameterCard name="Estado" value={meta.label} effect={meta.hint} />
        </Param>
        <Param name="Comprador">
          <ParameterCard
            name="Comprador"
            value={order.buyerName || 'Sin nombre'}
            effect={[order.buyerEmail || 'Sin correo', order.buyerPhone]
              .filter(Boolean)
              .join(' · ')}
          />
        </Param>
        <Param name="Evento">
          <ParameterCard
            name="Evento"
            value={order.event.title}
            effect={[
              `Canal ${channelWord(order.channel)}`,
              affiliateRef ? `Ref. afiliado ${affiliateRef}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </Param>
        <Param name="Creada">
          <ParameterCard
            name="Creada"
            value={formatWhen(order.createdAt)}
            effect="Hora de la Ciudad de México."
          />
        </Param>
      </div>

      <div className={bt.block}>
        <p className={styles.rowTitle}>Acciones</p>
        <div className={bt.actions}>
          <TicketButton variant="secondary" disabled={busy !== null} onClick={() => void resend()}>
            {busy === 'resend' ? 'Reenviando' : 'Reenviar correo'}
          </TicketButton>
          {order.status === 'PENDING' ? (
            confirmCancel ? (
              <>
                <TicketButton
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => void cancel()}
                >
                  {busy === 'cancel'
                    ? 'Cancelando'
                    : `Cancelar ${order.publicId} y liberar inventario`}
                </TicketButton>
                <TicketButton
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => setConfirmCancel(false)}
                >
                  No cancelar
                </TicketButton>
              </>
            ) : (
              <TicketButton
                variant="danger"
                disabled={busy !== null}
                onClick={() => setConfirmCancel(true)}
              >
                Cancelar orden
              </TicketButton>
            )
          ) : null}
        </div>
      </div>

      <div className={bt.block}>
        <p className={styles.rowTitle}>Dinero</p>
        <Money
          label="Total de la orden"
          amount={toNumber(order.totalAmount)}
          currency
          lines={moneyLines}
        />
        <div className={styles.rows}>
          <div className={bt.pair}>
            <p className={bt.pairLabel}>Cobrado (liquidado por la pasarela)</p>
            <p className={bt.pairValue}>
              {settlement.settled === null
                ? 'Sin pago registrado'
                : formatMoney(settlement.settled, settlement.currency)}
            </p>
          </div>
          {settlement.mismatch ? (
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Diferencia</p>
              <p className={`${bt.pairValue} ${styles.danger}`}>
                {formatMoneyDelta(settlement.difference, settlement.currency)}
              </p>
            </div>
          ) : null}
          {refundedTotal > 0 ? (
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Reembolsado (completado)</p>
              <p className={`${bt.pairValue} ${styles.out}`}>
                −{formatMoney(refundedTotal, settlement.currency)}
              </p>
            </div>
          ) : null}
          {toNumber(order.commissionAmount) > 0 ? (
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Comisión de la plataforma</p>
              <p className={bt.pairValue}>{formatMoney(order.commissionAmount, currency)}</p>
            </div>
          ) : null}
          <div className={bt.pair}>
            <p className={bt.pairLabel}>Boletos emitidos</p>
            <p className={bt.pairValue}>
              {formatCount(issued)} de {formatCount(tickets.length)}
            </p>
          </div>
        </div>
      </div>

      <div className={bt.block}>
        <p className={styles.rowTitle}>Pago</p>
        {order.payment ? (
          <div className={styles.rows}>
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Pasarela</p>
              <p className={bt.pairValue}>{order.payment.gateway ?? '—'}</p>
            </div>
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Estado</p>
              <p className={bt.pairValue}>{order.payment.status ?? '—'}</p>
            </div>
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Método</p>
              <p className={bt.pairValue}>{paymentMethod}</p>
            </div>
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Referencia</p>
              <p className={`${bt.pairValue} ${styles.mono}`}>{order.payment.externalId ?? '—'}</p>
            </div>
            <div className={bt.pair}>
              <p className={bt.pairLabel}>Liquidado</p>
              <p className={bt.pairValue}>{formatWhen(order.payment.processedAt)}</p>
            </div>
            {order.payment.errorMessage ? (
              <div className={bt.pair}>
                <p className={bt.pairLabel}>Error de la pasarela</p>
                <p className={`${bt.pairValue} ${styles.danger}`}>{order.payment.errorMessage}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.quiet}>
            No hay registro de pago para esta orden
            {order.paymentMethod ? ` (método declarado: ${order.paymentMethod})` : ''}. Si el
            cliente asegura haber pagado, revisa la conciliación SPEI antes de reembolsar.
          </p>
        )}
      </div>

      <div className={bt.block}>
        <p className={styles.rowTitle}>Línea de tiempo</p>
        <ol className={styles.rows}>
          {timeline.map((step) => (
            <li key={step.key} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{step.label}</p>
                <p className={styles.rowMeta}>
                  {[step.at ? formatWhen(step.at) : null, step.detail]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
              <span />
              <p
                className={
                  step.state === 'failed'
                    ? styles.danger
                    : step.state === 'done'
                      ? styles.quiet
                      : styles.tertiary
                }
              >
                {STEP_LABEL[step.state]}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className={bt.block} id="reembolsos">
        <p className={styles.rowTitle}>Reembolsos</p>
        <p className={styles.quiet}>
          Dos pasos. Paso 1: registrar la solicitud aquí. Paso 2: ejecutarla en el portal Banorte y
          marcarla como completada. En producción la pasarela no reembolsa por API: sin el paso 2 el
          dinero no sale.
        </p>

        {canRefund ? (
          <div className={styles.stack}>
            <Field
              label="Monto"
              kind="money"
              hint="Vacío = total liquidado."
              placeholder={
                settlement.settled !== null ? String(settlement.settled) : order.totalAmount
              }
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
            />
            <div>
              <p className={bt.filterLabel}>Motivo</p>
              <SheetSelect
                label="Motivo"
                value={refundReason}
                placeholder="Motivo"
                options={REFUND_REASON_OPTIONS}
                onChange={setRefundReason}
              />
            </div>
            <Field
              label="Nota interna"
              hint="Opcional."
              value={refundNotes}
              onChange={(e) => setRefundNotes(e.target.value)}
            />
            <div className={bt.actions}>
              <TicketButton disabled={busy !== null} onClick={() => void requestRefund()}>
                {busy === 'refund' ? 'Registrando' : 'Paso 1 · Registrar reembolso'}
              </TicketButton>
            </div>
          </div>
        ) : null}

        {nextStep ? <p className={styles.quiet}>Siguiente paso: {nextStep}</p> : null}

        {order.refunds.length === 0 ? (
          <p className={styles.quiet}>Sin reembolsos registrados para esta orden.</p>
        ) : (
          <ul className={styles.rows}>
            {order.refunds.map((r) => {
              const rmeta = refundStatusMeta(r.status);
              const open = isRefundOpen(r.status);
              return (
                <li key={r.id} className={styles.stack}>
                  <div className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>
                        {rmeta.label} · {refundReasonWord(r.reason)}
                      </p>
                      <p className={styles.rowMeta}>
                        {[
                          `Solicitado ${formatWhen(r.requestedAt)}${r.requestedBy ? ` por ${r.requestedBy}` : ''}`,
                          r.processedAt
                            ? `cerrado ${formatWhen(r.processedAt)}${r.processedBy ? ` por ${r.processedBy}` : ''}`
                            : null,
                          r.notes ? `Nota: ${r.notes}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className={styles.rowMeta}>{rmeta.hint}</p>
                      {r.payoutClabe ? (
                        <p className={styles.rowMeta}>
                          Cuenta del cliente:{' '}
                          <span className={styles.mono}>
                            {seesFullClabe ? r.payoutClabe : maskClabe(r.payoutClabe)}
                          </span>
                          {r.payoutAccountHolder ? ` · ${r.payoutAccountHolder}` : ''}
                          {r.payoutClabeAt ? ` · registrada ${formatWhen(r.payoutClabeAt)}` : ''}
                          {seesFullClabe ? '' : ' · Finanzas ve la CLABE completa'}
                        </p>
                      ) : null}
                    </div>
                    <span />
                    <p className={`${styles.figure} ${styles.out}`}>
                      {formatMoney(r.amount, currency)}
                    </p>
                  </div>
                  {open ? (
                    <div className={styles.stack}>
                      <Field
                        label="Referencia Banorte"
                        hint="Opcional, pero ayuda a conciliar."
                        value={references[r.id] ?? ''}
                        onChange={(e) =>
                          setReferences((current) => ({ ...current, [r.id]: e.target.value }))
                        }
                      />
                      <div className={bt.actions}>
                        <TicketButton
                          variant="secondary"
                          disabled={busy !== null}
                          onClick={() => void completeRefund(r.id)}
                        >
                          {busy === r.id ? 'Cerrando' : 'Paso 2 · Marcar pagado en Banorte'}
                        </TicketButton>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={bt.block}>
        <p className={styles.rowTitle}>Boletos · {formatCount(tickets.length)}</p>
        {tickets.length === 0 ? (
          <p className={styles.quiet}>
            Esta orden no tiene boletos emitidos.
            {order.status === 'PENDING_REFUND'
              ? ' Ese es justamente el motivo del reembolso obligado.'
              : ''}
          </p>
        ) : (
          <ul className={styles.rows}>
            {tickets.map((t) => (
              <li key={t.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.mono}>{t.code}</p>
                  <p className={styles.rowMeta}>
                    {[
                      t.section,
                      t.row && `Fila ${t.row}`,
                      t.seatNumber && `Asiento ${t.seatNumber}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'General'}
                  </p>
                </div>
                <span />
                <p className={styles.quiet}>{ticketStatusWord(t.status)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {actionError || notice ? (
        <div className={styles.saveBar}>
          {actionError ? (
            <p className={styles.danger} role="alert">
              {actionError}
            </p>
          ) : (
            <p className={styles.quiet} aria-live="polite">
              {notice}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
