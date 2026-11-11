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
          Las {formatCount(orders.length)} más recientes de tu organización. El API no busca ni
          pagina el listado: los filtros aplican solo sobre ellas y una orden anterior se busca por
          folio exacto.
        </p>
        {hasMore || (total != null && total > orders.length) ? (
          <p className={styles.tertiary}>Hay más órdenes en el servidor que no se listan aquí.</p>
        ) : null}
      </header>

      <div className={styles.rows}>
        <div className={styles.row}>
          <p className={styles.rowTitle}>Órdenes cargadas</p>
          <span />
          <p className={styles.figure}>{formatCount(orders.length)}</p>
        </div>
        <div className={styles.row}>
          <p className={styles.rowTitle}>Requieren acción</p>
          <span />
          <p className={attention.length > 0 ? `${styles.figure} ${styles.danger}` : styles.figure}>
            {formatCount(attention.length)}
          </p>
        </div>
        <div className={styles.row}>
          <p className={styles.rowTitle}>Completadas</p>
          <span />
          <p className={styles.figure}>{formatCount(completedCount)}</p>
        </div>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Cobrado en lo mostrado</p>
            <p className={styles.rowMeta}>Solo completadas y con reembolso parcial de esta lista</p>
          </div>
          <span />
          <p className={styles.figure}>
            {totals.length > 0
              ? totals.map(([cur, amount]) => formatMoney(amount, cur)).join(' · ')
              : '—'}
          </p>
        </div>
      </div>

      {attention.length > 0 ? (
        <div className={bt.block}>
          <p className={styles.danger} role="alert">
            {formatCount(attention.length)} orden(es) requieren acción. En reembolso obligado el
            cobro entró pero no se emitieron boletos: el dinero es del cliente hasta que se
            devuelva.
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
        <ul className={`${styles.rows} ${bt.block}`} aria-label="Órdenes recientes">
          {filtered.map((o) => {
            const meta = orderStatusMeta(o.status);
            const urgent = NEEDS_ACTION.has(o.status);
            const payment = o.paymentGateway
              ? `${o.paymentGateway}${o.paymentStatus ? ` · ${o.paymentStatus}` : ''}`
              : 'Sin pago registrado';
            return (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className={`${styles.row} ${bt.rowLink}`}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      <span className={styles.mono}>{o.publicId}</span> · {o.eventTitle}
                    </p>
                    <p className={styles.rowMeta}>
                      {[
                        o.buyerName || 'Sin nombre',
                        o.buyerEmail,
                        channelWord(o.channel),
                        payment,
                        formatWhen(o.createdAt),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <p className={urgent ? styles.danger : styles.quiet} title={meta.hint}>
                    {meta.label}
                  </p>
                  <p className={styles.figure}>{formatMoney(o.amount, o.currency)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
