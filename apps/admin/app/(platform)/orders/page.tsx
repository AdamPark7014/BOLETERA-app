'use client';

/**
 * Lista de órdenes — la herramienta de soporte.
 *
 * Limitación conocida del API: `GET /admin/orders` no acepta búsqueda, filtros
 * ni paginación; devuelve un sobre con las más recientes de la organización del
 * JWT. Se dice en pantalla en vez de fingir que el filtro busca en todo el
 * histórico, y la búsqueda por folio cae al servidor (`GET /admin/orders/:id`
 * acepta también `publicId`) para poder llegar a una orden vieja.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount, formatWhen } from '../events/_ticket/read';
import bt from './_bt/bt.module.scss';
import { channelWord, readOrderRows, type OrderListRow } from './_bt/read';
import { formatMoney } from './_ui/format';
import { orderStatusMeta } from './_ui/orderModel';

/** Órdenes que exigen intervención humana, no solo lectura. */
const NEEDS_ACTION = new Set(['PENDING_REFUND', 'FAILED']);

const FOLIO_RE = /^[A-Za-z0-9-]{4,}$/;

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <OrdenesBody />
      </AdminFrame>
    </Suspense>
  );
}

function OrdenesBody() {
  const session = useSession();
  const [rows, setRows] = useState<OrderListRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
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
    adminApi<unknown>('/admin/orders', token)
      .then((payload) => {
        if (!alive) return;
        const page = readOrderRows(payload);
        setRows(page.rows);
        setTotal(page.total);
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
          <h1 className={styles.sectionTitle}>Órdenes</h1>
          <p className={styles.quiet}>Tu rol no ve órdenes.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir las órdenes"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando órdenes.</p>;

  return <OrdersList token={token} orders={rows} total={total} hasMore={hasMore} />;
}

function OrdersList({
  token,
  orders,
  total,
  hasMore,
}: {
  token: string;
  orders: OrderListRow[];
  total: number | null;
  hasMore: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        if (channel !== 'ALL' && o.channel !== channel) return false;
        if (status !== 'ALL' && o.status !== status) return false;
        if (!needle) return true;
        return (
          o.publicId.toLowerCase().includes(needle) ||
          (o.buyerName ?? '').toLowerCase().includes(needle) ||
          (o.buyerEmail ?? '').toLowerCase().includes(needle) ||
          o.eventTitle.toLowerCase().includes(needle)
        );
      }),
    [orders, needle, channel, status]
  );

  const channelOptions = useMemo(
    () => [
      { value: 'ALL', label: 'Todos los canales' },
      ...Array.from(new Set(orders.map((o) => o.channel))).map((c) => ({
        value: c,
        label: channelWord(c),
      })),
    ],
    [orders]
  );

  /** Conteo por estado para que el filtro diga cuánto hay antes de aplicarlo. */
  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return [
      { value: 'ALL', label: `Todos los estados (${orders.length})` },
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => ({ value: s, label: `${orderStatusMeta(s).label} (${n})` })),
    ];
  }, [orders]);

  const attention = useMemo(() => orders.filter((o) => NEEDS_ACTION.has(o.status)), [orders]);
  const completedCount = useMemo(
    () =>
      orders.filter((o) => o.status === 'COMPLETED' || o.status === 'PARTIALLY_REFUNDED').length,
    [orders]
  );

  /**
   * Totales solo de lo cargado. Se etiqueta como tal: sumar la muestra y
   * llamarlo "ingresos" sería un reporte falso.
   */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const o of orders) {
      if (o.status !== 'COMPLETED' && o.status !== 'PARTIALLY_REFUNDED') continue;
      byCurrency.set(o.currency, (byCurrency.get(o.currency) ?? 0) + o.amount);
    }
    return Array.from(byCurrency.entries());
  }, [orders]);

  /** Busca el folio en el servidor cuando no está entre las recientes. */
  async function lookupFolio() {
    const folio = q.trim();
    if (!folio) return;
    setLookup({ busy: true, message: null });
    try {
      const found = await adminApi<{ id: string }>(
        `/admin/orders/${encodeURIComponent(folio)}`,
        token
      );
      setLookup({ busy: false, message: null });
      router.push(`/orders/${found.id}`);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.isNotFound
            ? `No existe ninguna orden con folio ${folio} en tu organización.`
            : e.userMessage
          : 'No se pudo consultar el folio.';
      setLookup({ busy: false, message: msg });
    }
  }

  const canLookup = FOLIO_RE.test(q.trim()) && filtered.length === 0;
  const filtering = needle !== '' || channel !== 'ALL' || status !== 'ALL';

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Órdenes</h1>
        <p className={styles.quiet}>
          {formatCount(orders.length)} más recientes
          {hasMore || (total != null && total > orders.length)
            ? ' · busca las anteriores por folio'
            : ''}
        </p>
      </header>

      <div className={styles.kpis} aria-label="Resumen de órdenes">
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Cobrado en esta lista</p>
          <p className={styles.kpiValue}>
            {totals.length > 0
              ? totals.map(([cur, amount]) => formatMoney(amount, cur)).join(' · ')
              : '—'}
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Completadas</p>
          <p className={styles.kpiValue}>{formatCount(completedCount)}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Requieren acción</p>
          <p
            className={styles.kpiValue}
            style={attention.length > 0 ? { color: 'var(--danger)' } : undefined}
          >
            {formatCount(attention.length)}
          </p>
        </div>
      </div>

      {attention.length > 0 ? (
        <div className={bt.block}>
          <p className={styles.danger} role="alert">
            {attention.length === 1
              ? '1 orden cobrada sin boletos: hay que devolver el dinero.'
              : `${formatCount(attention.length)} órdenes cobradas sin boletos: hay que devolver el dinero.`}
          </p>
          <div className={bt.actions}>
            <TicketButton variant="ghost" onClick={() => setStatus('PENDING_REFUND')}>
              Ver solo reembolsos obligados
            </TicketButton>
          </div>
        </div>
      ) : null}

      <div className={bt.block}>
        <div className={bt.toolbar}>
          <Field
            label="Buscar"
            kind="search"
            value={q}
            placeholder="Folio, correo, comprador o evento"
            onChange={(event) => {
              setQ(event.target.value);
              setLookup({ busy: false, message: null });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canLookup) void lookupFolio();
            }}
          />
          <div>
            <p className={bt.filterLabel}>Canal</p>
            <SheetSelect
              label="Canal"
              value={channel}
              placeholder="Todos los canales"
              options={channelOptions}
              onChange={setChannel}
            />
          </div>
          <div>
            <p className={bt.filterLabel}>Estado</p>
            <SheetSelect
              label="Estado"
              value={status}
              placeholder="Todos los estados"
              options={statusOptions}
              onChange={setStatus}
            />
          </div>
        </div>
        <div className={bt.actions}>
          <p className={styles.tertiary} role="status">
            {formatCount(filtered.length)} de {formatCount(orders.length)}
          </p>
          {filtering ? (
            <TicketButton
              variant="ghost"
              onClick={() => {
                setQ('');
                setChannel('ALL');
                setStatus('ALL');
              }}
            >
              Limpiar filtros
            </TicketButton>
          ) : null}
          <TicketButton variant="secondary" onClick={() => router.push('/orders/refunds')}>
            Por reembolsar
          </TicketButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={bt.block}>
          {orders.length === 0 ? (
            <p className={styles.quiet}>
              Sin órdenes todavía. La primera orden cobrada aparecerá aquí.
            </p>
          ) : (
            <p className={styles.quiet}>
              {canLookup
                ? 'Nada con ese criterio. Si es un folio anterior a las recientes, búscalo en el servidor.'
                : 'Nada con ese criterio. Prueba con el folio completo o quita algún filtro.'}
            </p>
          )}
          {canLookup ? (
            <div className={bt.actions}>
              <TicketButton
                variant="secondary"
                disabled={lookup.busy}
                onClick={() => void lookupFolio()}
              >
                {lookup.busy ? 'Buscando' : `Buscar folio ${q.trim()} en el servidor`}
              </TicketButton>
            </div>
          ) : null}
          {lookup.message ? (
            <p className={styles.danger} role="alert">
              {lookup.message}
            </p>
          ) : null}
        </div>
      ) : (
        <div className={`${styles.tableWrap} ${bt.block}`}>
          <table className={styles.table} aria-label="Órdenes recientes">
            <thead>
              <tr>
                <th scope="col">Folio</th>
                <th scope="col">Evento</th>
                <th scope="col">Comprador</th>
                <th scope="col">Canal</th>
                <th scope="col">Estado</th>
                <th scope="col" className={styles.num}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const meta = orderStatusMeta(o.status);
                const urgent = NEEDS_ACTION.has(o.status);
                const chip = urgent
                  ? styles.chipDanger
                  : o.status === 'COMPLETED'
                    ? styles.chipOk
                    : o.status === 'PENDING' || o.status === 'PARTIALLY_REFUNDED'
                      ? styles.chipWarn
                      : styles.chip;
                return (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/orders/${o.id}`}
                        className={`${styles.cellLink} ${styles.mono}`}
                      >
                        {o.publicId}
                      </Link>
                      <p className={styles.rowMeta}>{formatWhen(o.createdAt)}</p>
                    </td>
                    <td>{o.eventTitle}</td>
                    <td>
                      <p className={styles.rowTitle}>{o.buyerName || 'Sin nombre'}</p>
                      <p className={styles.rowMeta}>{o.buyerEmail}</p>
                    </td>
                    <td>{channelWord(o.channel)}</td>
                    <td title={meta.hint}>
                      <span className={chip}>{meta.label}</span>
                    </td>
                    <td className={styles.num}>
                      <strong
                        style={
                          o.status === 'REFUNDED' || o.status === 'CANCELLED'
                            ? { color: 'var(--text-secondary)', textDecoration: 'line-through' }
                            : undefined
                        }
                      >
                        {formatMoney(o.amount, o.currency)}
                      </strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
