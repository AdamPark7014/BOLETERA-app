'use client';

/**
 * Lista de órdenes — la herramienta de soporte.
 *
 * Limitación conocida del API: `GET /admin/orders` no acepta búsqueda, filtros
 * ni paginación; devuelve las 50 más recientes de la organización del JWT. Se
 * dice en pantalla en vez de fingir que el filtro busca en todo el histórico, y
 * la búsqueda por folio cae al servidor (`GET /admin/orders/:id` acepta también
 * `publicId`) para poder llegar a una orden vieja.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import platform from '../_styles/platform.module.scss';
import styles from './orders.module.scss';
import { EmptyBlock, Notice, ResourceView } from './_ui/States';
import { useResource } from './_ui/useResource';
import { formatDateTime, formatMoney, toNumber } from './_ui/format';
import { orderStatusMeta, type OrderStatusTone } from './_ui/orderModel';

type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  channel: string;
  totalAmount: string;
  currency: string;
  buyerName: string | null;
  buyerEmail: string | null;
  createdAt: string;
  event: { title: string; slug?: string };
  /** El listado solo trae estado y pasarela; el monto liquidado vive en el detalle. */
  payment: { gateway: string; status: string } | null;
};

const toneClass: Record<OrderStatusTone, string> = {
  ok: 'paid',
  pending: 'pending',
  danger: 'canceled',
  neutral: 'refunded',
  attention: 'hold',
};

/** Órdenes que exigen intervención humana, no solo lectura. */
const NEEDS_ACTION = new Set(['PENDING_REFUND', 'FAILED']);

const FOLIO_RE = /^[A-Za-z0-9-]{4,}$/;

export default function OrdersPage() {
  const resource = useResource<OrderRow[]>(
    ({ token, signal }) => adminApi<OrderRow[]>('/admin/orders', token, { signal }),
    { requiresOrg: false },
  );

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Órdenes</h1>
          <p>Consulta, conciliación y reembolsos</p>
        </div>
        <Link href="/orders/refunds" className={platform.ghostBtn}>
          Reembolsos abiertos
        </Link>
      </header>

      <ResourceView resource={resource} context="las órdenes" loadingRows={6}>
        {(orders) => <OrdersTable orders={orders} />}
      </ResourceView>
    </div>
  );
}

function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (channel !== 'ALL' && o.channel !== channel) return false;
      if (status !== 'ALL' && o.status !== status) return false;
      if (!needle) return true;
      return (
        o.publicId.toLowerCase().includes(needle) ||
        (o.buyerName ?? '').toLowerCase().includes(needle) ||
        (o.buyerEmail ?? '').toLowerCase().includes(needle) ||
        o.event.title.toLowerCase().includes(needle)
      );
    });
  }, [orders, needle, channel, status]);

  const channels = useMemo(
    () => ['ALL', ...Array.from(new Set(orders.map((o) => o.channel)))],
    [orders],
  );

  /** Conteo por estado para que el filtro diga cuánto hay antes de aplicarlo. */
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return counts;
  }, [orders]);

  const attention = useMemo(() => orders.filter((o) => NEEDS_ACTION.has(o.status)), [orders]);

  /**
   * Totales solo de lo cargado. Se etiqueta como tal: sumar 50 órdenes y
   * llamarlo "ingresos" sería un reporte falso.
   */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const o of orders) {
      if (o.status !== 'COMPLETED' && o.status !== 'PARTIALLY_REFUNDED') continue;
      const cur = (o.currency || 'MXN').toUpperCase();
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + toNumber(o.totalAmount));
    }
    return Array.from(byCurrency.entries());
  }, [orders]);

  /** Busca el folio en el servidor cuando no está entre las 50 recientes. */
  async function lookupFolio() {
    const token = getStoredToken();
    const folio = q.trim();
    if (!token || !folio) return;
    setLookup({ busy: true, message: null });
    try {
      const found = await adminApi<{ id: string }>(
        `/admin/orders/${encodeURIComponent(folio)}`,
        token,
      );
      router.push(`/orders/${found.id}`);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.isNotFound
            ? `No existe ninguna orden con folio ${folio} en tu organización.`
            : e.userMessage
          : 'No se pudo consultar el folio.';
      setLookup({ busy: false, message: msg });
      return;
    }
    setLookup({ busy: false, message: null });
  }

  const canLookup = FOLIO_RE.test(q.trim()) && filtered.length === 0;

  return (
    <>
      {attention.length > 0 && (
        <Notice
          tone="danger"
          title={`${attention.length} orden(es) requieren acción`}
          actions={
            <button
              type="button"
              className={styles.filter}
              onClick={() => setStatus('PENDING_REFUND')}
            >
              Ver solo reembolsos obligados
            </button>
          }
        >
          <p>
            Incluye órdenes en <strong>reembolso obligado</strong>: el cobro entró pero no se
            emitieron boletos. El dinero es del cliente hasta que se devuelva.
          </p>
        </Notice>
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            id="orders-search"
            type="search"
            aria-label="Buscar por folio, correo, comprador o evento"
            placeholder="Folio, correo, comprador o evento…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLookup({ busy: false, message: null });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canLookup) void lookupFolio();
            }}
          />
        </div>

        <div className={styles.filters} role="group" aria-label="Filtrar por canal">
          {channels.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={channel === c}
              className={channel === c ? styles.filterActive : styles.filter}
              onClick={() => setChannel(c)}
            >
              {c === 'ALL' ? 'Todos los canales' : c}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filters} role="group" aria-label="Filtrar por estado">
        <button
          type="button"
          aria-pressed={status === 'ALL'}
          className={status === 'ALL' ? styles.filterActive : styles.filter}
          onClick={() => setStatus('ALL')}
        >
          Todos ({orders.length})
        </button>
        {Array.from(statusCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([s, n]) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              className={status === s ? styles.filterActive : styles.filter}
              onClick={() => setStatus(s)}
            >
              {orderStatusMeta(s).label} ({n})
            </button>
          ))}
      </div>

      <p className={styles.scopeNote}>
        Mostrando las <strong>{orders.length} órdenes más recientes</strong> de tu organización —
        el API todavía no acepta búsqueda ni paginación en el listado. Los filtros aplican solo
        sobre ellas; para una orden anterior usa el folio exacto.
        {totals.length > 0 && (
          <>
            {' '}
            Cobrado en lo mostrado:{' '}
            {totals.map(([cur, amount], i) => (
              <strong key={cur}>
                {i > 0 ? ' · ' : ''}
                {formatMoney(amount, cur)}
              </strong>
            ))}
            .
          </>
        )}
      </p>

      <section className={platform.panel}>
        <table className={platform.table}>
          <caption className={styles.srOnly}>
            Órdenes recientes con folio, evento, comprador, canal, pago, total y estado
          </caption>
          <thead>
            <tr>
              <th scope="col">Folio</th>
              <th scope="col">Evento</th>
              <th scope="col">Comprador</th>
              <th scope="col">Canal</th>
              <th scope="col">Pago</th>
              <th scope="col" className={styles.numeric}>
                Total de la orden
              </th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const meta = orderStatusMeta(o.status);
              return (
                <tr key={o.id} className={NEEDS_ACTION.has(o.status) ? styles.rowAlert : undefined}>
                  <th scope="row" className={styles.rowHead}>
                    <Link href={`/orders/${o.id}`} className={styles.folioLink}>
                      <code className={styles.code}>{o.publicId}</code>
                    </Link>
                    <small>{formatDateTime(o.createdAt)}</small>
                  </th>
                  <td>{o.event.title}</td>
                  <td>
                    <strong>{o.buyerName || 'Sin nombre'}</strong>
                    <br />
                    <small className={styles.subtle}>{o.buyerEmail || '—'}</small>
                  </td>
                  <td>{o.channel}</td>
                  <td>
                    {o.payment ? (
                      <span className={styles.gateway}>
                        {o.payment.gateway}
                        <small>{o.payment.status}</small>
                      </span>
                    ) : (
                      <span className={styles.subtle}>Sin pago registrado</span>
                    )}
                  </td>
                  <td className={styles.numeric}>{formatMoney(o.totalAmount, o.currency)}</td>
                  <td>
                    <span
                      className={`${styles.status} ${styles[toneClass[meta.tone]]}`}
                      title={meta.hint}
                    >
                      {meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  {orders.length === 0 ? (
                    <EmptyBlock
                      title="Sin órdenes registradas todavía"
                      hint="Cuando se cobre la primera orden de esta organización aparecerá aquí."
                    />
                  ) : (
                    <EmptyBlock
                      title="Ningún resultado con los filtros actuales"
                      hint={
                        canLookup
                          ? 'Si es un folio anterior a las 50 recientes, búscalo directo en el servidor.'
                          : 'Prueba con el folio completo o quita algún filtro.'
                      }
                      action={
                        canLookup ? (
                          <button
                            type="button"
                            className={styles.lookupBtn}
                            disabled={lookup.busy}
                            onClick={() => void lookupFolio()}
                          >
                            {lookup.busy ? 'Buscando…' : `Buscar folio ${q.trim()} en el servidor`}
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                  {lookup.message && (
                    <p role="alert" className={styles.lookupError}>
                      {lookup.message}
                    </p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
