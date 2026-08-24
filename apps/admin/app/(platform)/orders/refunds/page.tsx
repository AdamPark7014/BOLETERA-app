'use client';

/**
 * Cola de reembolsos abiertos.
 *
 * Usa `GET /payments/refunds` con filtro `status=PENDING` — el endpoint
 * dedicado reemplaza el escaneo N+1 de órdenes recientes.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../../_styles/platform.module.scss';
import styles from '../orders.module.scss';
import { EmptyBlock, ResourceView } from '../_ui/States';
import { useResource } from '../_ui/useResource';
import { formatDateTime, formatMoney, toNumber } from '../_ui/format';
import { orderStatusMeta, refundStatusMeta } from '../_ui/orderModel';

type RefundRow = {
  id: string;
  amount: string;
  currency: string;
  reason: string;
  status: string;
  notes: string | null;
  requestedBy: string;
  requestedAt: string;
  pendingForHours: number | null;
  order: {
    id: string;
    publicId: string;
    status: string;
    buyerEmail: string;
    buyerName: string;
    event: { title: string };
  };
};

type RefundListResponse = {
  data: RefundRow[];
  hasMore: boolean;
  limit: number;
};

type Queue = {
  rows: RefundRow[];
  total: number;
};

export default function RefundsQueuePage() {
  const resource = useResource<Queue>(
    useCallback(async ({ token, signal }) => {
      const response = await adminApi<RefundListResponse>(
        '/payments/refunds?status=PENDING&limit=100&sort=oldest',
        token,
        { signal },
      );
      const rows = [...response.data].sort((a, b) =>
        a.requestedAt.localeCompare(b.requestedAt),
      );
      return { rows, total: rows.length };
    }, []),
    { requiresOrg: false },
  );

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Reembolsos abiertos</h1>
          <p>Solicitudes registradas que todavía no han devuelto el dinero</p>
        </div>
        <Link href="/orders" className={platform.ghostBtn}>
          ← Órdenes
        </Link>
      </header>

      <ResourceView resource={resource} context="los reembolsos" loadingRows={4}>
        {(queue) => <QueueView queue={queue} reload={resource.reload} />}
      </ResourceView>
    </div>
  );
}

function QueueView({ queue, reload }: { queue: Queue; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function complete(refundId: string) {
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
      reload();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.userMessage : 'No se pudo cerrar el reembolso',
      );
    } finally {
      setBusy(null);
    }
  }

  const pendingTotal = queue.rows.reduce((s, r) => s + toNumber(r.amount), 0);
  const currency = queue.rows[0]?.currency ?? 'MXN';

  return (
    <>
      <p className={styles.scopeNote}>
        Mostrando <strong>{queue.total}</strong> reembolso(s) con estado pendiente en tu
        organización.
      </p>

      <section className={platform.panel}>
        {queue.rows.length === 0 ? (
          <EmptyBlock
            title="Ningún reembolso pendiente"
            hint="Los reembolsos completados no aparecen aquí; consúltalos en el detalle de cada orden."
          />
        ) : (
          <>
            <p className={styles.scopeNote}>
              <strong>{queue.rows.length}</strong> reembolso(s) sin cerrar por un total de{' '}
              <strong>{formatMoney(pendingTotal, currency)}</strong>. El dinero no sale hasta
              ejecutarlos en el portal Banorte y marcarlos aquí.
            </p>
            <table className={platform.table}>
              <caption className={styles.srOnly}>
                Reembolsos pendientes de cerrar, con folio, comprador, monto y antigüedad
              </caption>
              <thead>
                <tr>
                  <th scope="col">Folio</th>
                  <th scope="col">Comprador</th>
                  <th scope="col">Motivo</th>
                  <th scope="col" className={styles.numeric}>
                    Monto
                  </th>
                  <th scope="col">Solicitado</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Cerrar</th>
                </tr>
              </thead>
              <tbody>
                {queue.rows.map((refund) => {
                  const rmeta = refundStatusMeta(refund.status);
                  const order = refund.order;
                  return (
                    <tr key={refund.id} className={styles.rowAlert}>
                      <th scope="row" className={styles.rowHead}>
                        <Link href={`/orders/${order.id}`} className={styles.folioLink}>
                          <code className={styles.code}>{order.publicId}</code>
                        </Link>
                        <small>
                          {order.event.title} · {orderStatusMeta(order.status).label}
                        </small>
                      </th>
                      <td>
                        {order.buyerName || 'Sin nombre'}
                        <br />
                        <small className={styles.subtle}>{order.buyerEmail || '—'}</small>
                      </td>
                      <td>{refund.reason}</td>
                      <td className={styles.numeric}>
                        {formatMoney(refund.amount, refund.currency)}
                      </td>
                      <td>
                        {formatDateTime(refund.requestedAt)}
                        {refund.requestedBy && (
                          <>
                            <br />
                            <small className={styles.subtle}>por {refund.requestedBy}</small>
                          </>
                        )}
                        {refund.pendingForHours != null && refund.pendingForHours >= 24 ? (
                          <>
                            <br />
                            <small className={styles.subtle}>
                              {Math.round(refund.pendingForHours)} h en cola
                            </small>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <span className={`${styles.status} ${styles.canceled}`}>{rmeta.label}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={platform.primaryBtn}
                          disabled={busy !== null}
                          onClick={() => void complete(refund.id)}
                        >
                          <span className={styles.stepBadge}>Paso 2</span>
                          {busy === refund.id ? 'Cerrando…' : 'Marcar pagado'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  );
}
