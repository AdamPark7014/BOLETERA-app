'use client';

/**
 * Cola de reembolsos abiertos.
 *
 * Un reembolso queda `PENDING` hasta que alguien lo ejecuta en el portal
 * Banorte y lo cierra con `POST /payments/refunds/:id/complete`. Hasta ahora no
 * había ninguna pantalla que los listara, así que un reembolso a medias era
 * invisible: el cliente sin su dinero y el inventario sin liberar.
 *
 * Limitación del API: **no existe** un `GET` de reembolsos. Esta cola se deriva
 * pidiendo el detalle de las órdenes recientes que pueden tener reembolso. Se
 * dice explícitamente en pantalla para que nadie la lea como "no hay pendientes
 * en toda la historia".
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../../_styles/platform.module.scss';
import styles from '../orders.module.scss';
import { EmptyBlock, Notice, ResourceView } from '../_ui/States';
import { useResource } from '../_ui/useResource';
import { formatDateTime, formatMoney, toNumber } from '../_ui/format';
import { isRefundOpen, orderStatusMeta, refundStatusMeta } from '../_ui/orderModel';

type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  currency: string;
  totalAmount: string;
  buyerEmail: string | null;
  buyerName: string | null;
  event: { title: string };
};

type OrderDetail = OrderRow & {
  payment: { amount?: string | null; status?: string | null } | null;
  refunds: {
    id: string;
    amount: string;
    status: string;
    reason: string;
    notes: string | null;
    requestedAt: string;
    requestedBy: string | null;
  }[];
};

type QueueRow = {
  order: OrderDetail;
  refund: OrderDetail['refunds'][number];
};

type Queue = {
  rows: QueueRow[];
  /** Órdenes en `PENDING_REFUND` que ni siquiera tienen solicitud registrada. */
  unrequested: OrderDetail[];
  scanned: number;
  totalRecent: number;
  /** Detalles que no se pudieron leer; se reportan en vez de omitirse. */
  failed: number;
};

/** Estados de orden que pueden arrastrar un reembolso abierto. */
const CANDIDATE_STATUSES = new Set([
  'PENDING_REFUND',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'FAILED',
  'CANCELLED',
]);

const CONCURRENCY = 5;

/** Pide los detalles en tandas para no disparar 50 peticiones a la vez. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    results.push(...(await Promise.allSettled(chunk.map(fn))));
  }
  return results;
}

export default function RefundsQueuePage() {
  const resource = useResource<Queue>(
    useCallback(async ({ token, signal }) => {
      const orders = await adminApi<OrderRow[]>('/admin/orders', token, { signal });
      const candidates = orders.filter((o) => CANDIDATE_STATUSES.has(o.status));
      const settled = await mapLimited(candidates, CONCURRENCY, (o) =>
        adminApi<OrderDetail>(`/admin/orders/${o.id}`, token, { signal }),
      );

      const rows: QueueRow[] = [];
      const unrequested: OrderDetail[] = [];
      let failed = 0;
      for (const result of settled) {
        if (result.status === 'rejected') {
          failed += 1;
          continue;
        }
        const detail = result.value;
        const open = (detail.refunds ?? []).filter((r) => isRefundOpen(r.status));
        for (const refund of open) rows.push({ order: detail, refund });
        if (detail.status === 'PENDING_REFUND' && (detail.refunds ?? []).length === 0) {
          unrequested.push(detail);
        }
      }
      rows.sort((a, b) => a.refund.requestedAt.localeCompare(b.refund.requestedAt));
      return { rows, unrequested, scanned: candidates.length, totalRecent: orders.length, failed };
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

  const pendingTotal = queue.rows.reduce((s, r) => s + toNumber(r.refund.amount), 0);
  const currency = queue.rows[0]?.order.currency ?? 'MXN';

  return (
    <>
      <p className={styles.scopeNote}>
        Revisadas <strong>{queue.scanned}</strong> de las {queue.totalRecent} órdenes más recientes.
        El API todavía no expone un listado de reembolsos, así que esta cola se arma consultando
        orden por orden: <strong>no cubre el histórico completo</strong>.
      </p>

      {queue.failed > 0 && (
        <Notice tone="warn" title={`${queue.failed} orden(es) no se pudieron revisar`}>
          <p>
            Sus reembolsos podrían no aparecer en esta cola. Vuelve a cargar; si persiste, revisa
            esas órdenes una por una.
          </p>
        </Notice>
      )}

      {queue.unrequested.length > 0 && (
        <Notice
          tone="danger"
          title={`${queue.unrequested.length} orden(es) en reembolso obligado sin solicitud`}
        >
          <p>
            Se cobró y no se emitieron boletos, y nadie ha registrado siquiera el reembolso:{' '}
            {queue.unrequested.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ', '}
                <Link href={`/orders/${o.id}`}>{o.publicId}</Link>
              </span>
            ))}
            .
          </p>
        </Notice>
      )}

      <section className={platform.panel}>
        {queue.rows.length === 0 ? (
          <EmptyBlock
            title="Ningún reembolso abierto entre las órdenes revisadas"
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
                {queue.rows.map(({ order, refund }) => {
                  const rmeta = refundStatusMeta(refund.status);
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
                        {formatMoney(refund.amount, order.currency)}
                      </td>
                      <td>
                        {formatDateTime(refund.requestedAt)}
                        {refund.requestedBy && (
                          <>
                            <br />
                            <small className={styles.subtle}>por {refund.requestedBy}</small>
                          </>
                        )}
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
