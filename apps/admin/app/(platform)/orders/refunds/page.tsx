'use client';

/**
 * Cola de reembolsos abiertos.
 *
 * Usa `GET /payments/refunds` con filtro `status=PENDING` — el endpoint
 * dedicado reemplaza el escaneo N+1 de órdenes recientes.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import styles from '../../events/_ticket/frame.module.scss';
import {
  asRecord,
  formatCount,
  formatWhen,
  readNumber,
  readString,
} from '../../events/_ticket/read';
import bt from '../_bt/bt.module.scss';
import { readListPage, refundReasonWord } from '../_bt/read';
import { formatMoney } from '../_ui/format';
import { orderStatusMeta, refundStatusMeta } from '../_ui/orderModel';

type RefundRow = {
  id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  notes: string | null;
  requestedBy: string | null;
  requestedAt: string;
  pendingForHours: number | null;
  orderId: string | null;
  publicId: string;
  orderStatus: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  eventTitle: string | null;
};

function readRefund(raw: unknown): RefundRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  if (!id) return null;
  const order = asRecord(row.order);
  return {
    id,
    amount: readNumber(row.amount) ?? 0,
    currency: (readString(row.currency) ?? 'MXN').toUpperCase(),
    reason: readString(row.reason) ?? '—',
    status: readString(row.status) ?? 'PENDING',
    notes: readString(row.notes),
    requestedBy: readString(row.requestedBy),
    requestedAt: readString(row.requestedAt) ?? '',
    pendingForHours: readNumber(row.pendingForHours),
    orderId: readString(order.id),
    publicId: readString(order.publicId) ?? '—',
    orderStatus: readString(order.status),
    buyerName: readString(order.buyerName),
    buyerEmail: readString(order.buyerEmail),
    eventTitle: readString(asRecord(order.event).title),
  };
}

export default function RefundsQueuePage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ColaBody />
      </AdminFrame>
    </Suspense>
  );
}

function ColaBody() {
  const session = useSession();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
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
    adminApi<unknown>('/payments/refunds?status=PENDING&limit=100&sort=oldest', token)
      .then((payload) => {
        if (!alive) return;
        const page = readListPage(payload);
        const next = page.items
          .flatMap((item) => {
            const refund = readRefund(item);
            return refund ? [refund] : [];
          })
          .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
        setRows(next);
        setHasMore(page.hasMore);
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
  }, [token, canSee, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Por reembolsar</h1>
          <p className={styles.quiet}>Tu rol no ve órdenes.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir los reembolsos"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando reembolsos.</p>;

  return (
    <QueueView token={token} rows={rows} hasMore={hasMore} reload={() => setNonce((n) => n + 1)} />
  );
}

function QueueView({
  token,
  rows,
  hasMore,
  reload,
}: {
  token: string;
  rows: RefundRow[];
  hasMore: boolean;
  reload: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(rows[0]?.id ?? null);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const row of rows)
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
    return Array.from(byCurrency.entries());
  }, [rows]);
  const staleCount = useMemo(
    () => rows.filter((row) => (row.pendingForHours ?? 0) >= 24).length,
    [rows]
  );

  async function complete(refund: RefundRow) {
    if (busy) return;
    setBusy(refund.id);
    setActionError(null);
    setNotice(null);
    const ref = (references[refund.id] ?? '').trim();
    try {
      await adminApi(`/payments/refunds/${refund.id}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({ banorteReference: ref || undefined }),
      });
      setNotice(`Reembolso cerrado · ${refund.publicId} · inventario liberado.`);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.userMessage : 'No se pudo cerrar el reembolso.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Por reembolsar</h1>
        <p className={styles.quiet}>
          Solicitudes registradas que todavía no devuelven el dinero. El dinero no sale hasta
          ejecutarlas en el portal Banorte y marcarlas aquí como pagadas.
        </p>
        {hasMore ? (
          <p className={styles.tertiary}>
            Se muestran las 100 más antiguas; hay más en el servidor.
          </p>
        ) : null}
      </header>

      <div className={styles.rows}>
        <div className={styles.row}>
          <p className={styles.rowTitle}>En cola</p>
          <span />
          <p className={styles.figure}>{formatCount(rows.length)}</p>
        </div>
        <div className={styles.row}>
          <p className={styles.rowTitle}>Monto pendiente</p>
          <span />
          <p className={styles.figure}>
            {totals.length > 0
              ? totals.map(([cur, amount]) => formatMoney(amount, cur)).join(' · ')
              : '—'}
          </p>
        </div>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Más de 24 h</p>
            <p className={styles.rowMeta}>Requieren seguimiento prioritario</p>
          </div>
          <span />
          <p className={staleCount > 0 ? `${styles.figure} ${styles.danger}` : styles.figure}>
            {formatCount(staleCount)}
          </p>
        </div>
      </div>

      <div className={bt.block}>
        {rows.length === 0 ? (
          <p className={styles.quiet}>
            Ningún reembolso pendiente. Los completados no aparecen aquí; se consultan en el detalle
            de cada orden.
          </p>
        ) : null}
        {rows.map((refund) => {
          const open = openId === refund.id;
          const rmeta = refundStatusMeta(refund.status);
          return (
            <div key={refund.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : refund.id)}
              >
                <span>
                  <span className={styles.mono}>{refund.publicId}</span>
                  {refund.eventTitle ? ` · ${refund.eventTitle}` : ''}
                </span>
                <span className={styles.figure}>{formatMoney(refund.amount, refund.currency)}</span>
              </button>
              {open ? (
                <div className={bt.detail}>
                  <div className={styles.rows}>
                    <div className={bt.pair}>
                      <p className={bt.pairLabel}>Comprador</p>
                      <p className={bt.pairValue}>
                        {[refund.buyerName || 'Sin nombre', refund.buyerEmail]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className={bt.pair}>
                      <p className={bt.pairLabel}>Motivo</p>
                      <p className={bt.pairValue}>{refundReasonWord(refund.reason)}</p>
                    </div>
                    <div className={bt.pair}>
                      <p className={bt.pairLabel}>Solicitado</p>
                      <p className={bt.pairValue}>
                        {formatWhen(refund.requestedAt)}
                        {refund.requestedBy ? ` · ${refund.requestedBy}` : ''}
                      </p>
                    </div>
                    {refund.pendingForHours != null ? (
                      <div className={bt.pair}>
                        <p className={bt.pairLabel}>En cola</p>
                        <p
                          className={
                            refund.pendingForHours >= 24
                              ? `${bt.pairValue} ${styles.danger}`
                              : bt.pairValue
                          }
                        >
                          {Math.round(refund.pendingForHours)} h
                        </p>
                      </div>
                    ) : null}
                    <div className={bt.pair}>
                      <p className={bt.pairLabel}>Estado del reembolso</p>
                      <p className={bt.pairValue}>{rmeta.label}</p>
                    </div>
                    {refund.orderStatus ? (
                      <div className={bt.pair}>
                        <p className={bt.pairLabel}>Estado de la orden</p>
                        <p className={bt.pairValue}>{orderStatusMeta(refund.orderStatus).label}</p>
                      </div>
                    ) : null}
                    {refund.notes ? (
                      <div className={bt.pair}>
                        <p className={bt.pairLabel}>Nota</p>
                        <p className={bt.pairValue}>{refund.notes}</p>
                      </div>
                    ) : null}
                  </div>
                  {refund.orderId ? (
                    <Link href={`/orders/${refund.orderId}`} className={bt.link}>
                      Abrir la orden {refund.publicId}
                    </Link>
                  ) : null}
                  <Field
                    label="Referencia Banorte"
                    hint="Opcional, pero ayuda a conciliar."
                    value={references[refund.id] ?? ''}
                    onChange={(e) =>
                      setReferences((current) => ({ ...current, [refund.id]: e.target.value }))
                    }
                  />
                  <div className={bt.actions}>
                    <TicketButton
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void complete(refund)}
                    >
                      {busy === refund.id ? 'Cerrando' : 'Paso 2 · Marcar pagado'}
                    </TicketButton>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.quiet} aria-live="polite">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
