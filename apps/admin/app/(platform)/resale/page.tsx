'use client';

/**
 * Reventa: listados del mercado secundario y control de sobreprecio.
 *
 * Solo lectura. La petición va autenticada y el sobreprecio se calcula contra el
 * precio original que devuelve el API; un listado arriba del umbral se señala.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { TicketButton, formatTicketAmount } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { AnonymousView, ApiErrorView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount, formatWhen, readNumber } from '../events/_ticket/read';
import local from './resale.module.scss';

type Listing = {
  id: string;
  askingPrice: string;
  currency?: string | null;
  status: string;
  createdAt?: string;
  ticket?: {
    code: string;
    event?: { title?: string } | null;
    offer?: { name?: string; basePrice?: string } | null;
  } | null;
  priceComparison?: { originalPrice?: string | number | null } | null;
  offers?: { id: string }[];
};

type ListingsResponse = { listings?: Listing[] } | Listing[];

type Row = {
  listing: Listing;
  asking: number;
  original: number;
  markup: number | null;
};

const STATUS: Record<string, string> = {
  ACTIVE: 'Activo',
  PENDING: 'Pendiente',
  SOLD: 'Vendido',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
};

/** Umbral a partir del cual el sobreprecio merece revisión. */
const MARKUP_ALERT = 20;

function statusWord(value: string): string {
  return STATUS[value] ?? value;
}

function markupLabel(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export default function ResaleAdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ReventaBody />
      </AdminFrame>
    </Suspense>
  );
}

function ReventaBody() {
  const session = useSession();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState('ALL');
  const [nonce, setNonce] = useState(0);
  const token = session.token;

  useEffect(() => {
    if (!token) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setRefreshing(true);
    adminApi<ListingsResponse>('/resale/listings?limit=50', token)
      .then((res) => {
        if (!alive) return;
        setError(null);
        setListings(Array.isArray(res) ? res : (res.listings ?? []));
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      alive = false;
    };
  }, [token, session.status, nonce]);

  const rows = useMemo<Row[]>(
    () =>
      listings
        .map((listing) => {
          const asking = readNumber(listing.askingPrice) ?? 0;
          const original =
            readNumber(
              listing.priceComparison?.originalPrice ?? listing.ticket?.offer?.basePrice ?? null
            ) ?? 0;
          const markup = original > 0 ? ((asking - original) / original) * 100 : null;
          return { listing, asking, original, markup };
        })
        .sort((a, b) => (b.markup ?? -Infinity) - (a.markup ?? -Infinity)),
    [listings]
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const listing of listings) map.set(listing.status, (map.get(listing.status) ?? 0) + 1);
    return map;
  }, [listings]);

  const flagged = rows.filter((row) => row.markup !== null && row.markup > MARKUP_ALERT).length;
  const offers = rows.reduce((sum, row) => sum + (row.listing.offers?.length ?? 0), 0);
  const visible = status === 'ALL' ? rows : rows.filter((row) => row.listing.status === status);
  const statusOptions = [
    { value: 'ALL', label: 'Todos' },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: `${statusWord(value)} · ${count}` })),
  ];

  if (session.status === 'anonymous') return <AnonymousView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir reventa"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando reventa.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Reventa</h1>
        <p className={styles.quiet}>
          Listados del mercado secundario. Se señala lo que pide más de {MARKUP_ALERT}% sobre el
          precio original.
        </p>
      </header>

      <ul className={styles.rows}>
        <li className={styles.row}>
          <p className={styles.rowTitle}>Listados</p>
          <span />
          <p className={styles.figure}>{formatCount(listings.length)}</p>
        </li>
        <li className={styles.row}>
          <p className={styles.rowTitle}>Activos</p>
          <span />
          <p className={styles.figure}>{formatCount(counts.get('ACTIVE') ?? 0)}</p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Sobreprecio alto</p>
            <p className={styles.rowMeta}>Más de {MARKUP_ALERT}% sobre el precio original</p>
          </div>
          <span />
          <p className={styles.figure}>{formatCount(flagged)}</p>
        </li>
        <li className={styles.row}>
          <p className={styles.rowTitle}>Ofertas recibidas</p>
          <span />
          <p className={styles.figure}>{formatCount(offers)}</p>
        </li>
      </ul>

      {flagged > 0 ? (
        <p className={`${styles.out} ${local.note}`} role="status">
          {flagged === 1 ? 'Un listado pide' : `${flagged} listados piden`} más de {MARKUP_ALERT}%
          sobre el original. Revisa el tope de reventa del evento antes de dejarlos publicados.
        </p>
      ) : null}

      <div className={`${styles.stack} ${local.block}`}>
        {listings.length > 0 ? (
          <Segment
            label="Estado del listado"
            value={status}
            options={statusOptions}
            onChange={setStatus}
          />
        ) : null}
        {listings.length === 0 ? (
          <p className={styles.quiet}>
            Sin listados. Aparecen cuando un asistente pone su boleto a la venta.
          </p>
        ) : null}
        {listings.length === 50 ? <p className={styles.tertiary}>Se muestran 50.</p> : null}
        {listings.length > 0 && visible.length === 0 ? (
          <p className={styles.quiet}>Ningún listado con ese estado.</p>
        ) : null}
        {visible.length > 0 ? (
          <ul className={styles.rows}>
            {visible.map((row) => {
              const currency = row.listing.currency || 'MXN';
              const high = row.markup !== null && row.markup > MARKUP_ALERT;
              const meta = [
                row.listing.ticket?.code ?? row.listing.id.slice(0, 8),
                statusWord(row.listing.status),
                row.listing.offers?.length
                  ? `${formatCount(row.listing.offers.length)} ofertas`
                  : null,
                row.listing.createdAt ? formatWhen(row.listing.createdAt) : null,
              ].filter(Boolean);
              return (
                <li key={row.listing.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      {row.listing.ticket?.event?.title ?? 'Evento sin nombre'}
                    </p>
                    <p className={styles.rowMeta}>{meta.join(' · ')}</p>
                    <p className={styles.rowMeta}>
                      Original{' '}
                      {row.original > 0 ? `${formatTicketAmount(row.original)} ${currency}` : '—'}
                    </p>
                  </div>
                  <p className={high ? styles.out : styles.tertiary}>
                    {row.markup === null ? '—' : markupLabel(row.markup)}
                    {high ? ' · Revisar' : ''}
                  </p>
                  <p className={styles.figure}>
                    {formatTicketAmount(row.asking)} {currency}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {refreshing ? 'Actualizando.' : ''}
        </p>
        <TicketButton
          variant="secondary"
          disabled={refreshing}
          onClick={() => setNonce((current) => current + 1)}
        >
          Actualizar
        </TicketButton>
      </div>
    </section>
  );
}
