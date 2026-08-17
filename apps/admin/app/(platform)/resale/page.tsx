'use client';

/**
 * Marketplace de reventa.
 *
 * La pantalla anterior pedía los listados con un `fetch` anónimo y mostraba
 * `${'$'}{askingPrice}` sin moneda: imposible distinguir "no hay reventa" de
 * "la petición falló", y un precio sin moneda no sirve para vigilar sobreprecio.
 * Ahora la petición va autenticada, el sobreprecio se calcula contra el precio
 * original y los listados por encima del umbral se señalan.
 */

import { useCallback, useMemo, useState } from 'react';
import { adminApi } from '@/lib/api';
import platform from '../_styles/platform.module.scss';
import styles from '../orders/orders.module.scss';
import { EmptyBlock, Notice, ResourceView } from '../orders/_ui/States';
import { useResource } from '../orders/_ui/useResource';
import { formatDateTime, formatMoney, formatPercent, toNumber } from '../orders/_ui/format';

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

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Activo', cls: 'paid' },
  PENDING: { label: 'Pendiente', cls: 'pending' },
  SOLD: { label: 'Vendido', cls: 'refunded' },
  CANCELLED: { label: 'Cancelado', cls: 'refunded' },
  EXPIRED: { label: 'Expirado', cls: 'refunded' },
};

/** Umbral a partir del cual el sobreprecio merece revisión. */
const MARKUP_ALERT = 20;

export default function ResaleAdminPage() {
  const [status, setStatus] = useState('ALL');

  const resource = useResource<Listing[]>(
    useCallback(
      async ({ token, signal }) => {
        const res = await adminApi<ListingsResponse>('/resale/listings?limit=50', token, { signal });
        return Array.isArray(res) ? res : (res.listings ?? []);
      },
      [],
    ),
    { requiresOrg: false },
  );

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Reventa</h1>
          <p>Listados del marketplace y control de sobreprecio</p>
        </div>
      </header>

      <ResourceView resource={resource} context="los listados de reventa" loadingRows={5}>
        {(listings) => <ListingsView listings={listings} status={status} setStatus={setStatus} />}
      </ResourceView>
    </div>
  );
}

function ListingsView({
  listings,
  status,
  setStatus,
}: {
  listings: Listing[];
  status: string;
  setStatus: (s: string) => void;
}) {
  const rows = useMemo(
    () =>
      listings.map((l) => {
        const asking = toNumber(l.askingPrice);
        const original = toNumber(
          l.priceComparison?.originalPrice ?? l.ticket?.offer?.basePrice ?? null,
        );
        const markup = original > 0 ? ((asking - original) / original) * 100 : null;
        return { listing: l, asking, original, markup };
      }),
    [listings],
  );

  const statuses = useMemo(
    () => Array.from(new Set(listings.map((l) => l.status))),
    [listings],
  );

  const visible = status === 'ALL' ? rows : rows.filter((r) => r.listing.status === status);
  const flagged = rows.filter((r) => r.markup !== null && r.markup > MARKUP_ALERT);

  return (
    <>
      {flagged.length > 0 && (
        <Notice tone="warn" title={`${flagged.length} listado(s) con sobreprecio alto`}>
          <p>
            Piden más de {MARKUP_ALERT}% por encima del precio original. Revisa si el evento tiene
            tope de reventa antes de dejarlos publicados.
          </p>
        </Notice>
      )}

      <div className={styles.filters} role="group" aria-label="Filtrar por estado">
        <button
          type="button"
          aria-pressed={status === 'ALL'}
          className={status === 'ALL' ? styles.filterActive : styles.filter}
          onClick={() => setStatus('ALL')}
        >
          Todos ({listings.length})
        </button>
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            className={status === s ? styles.filterActive : styles.filter}
            onClick={() => setStatus(s)}
          >
            {STATUS[s]?.label ?? s}
          </button>
        ))}
      </div>

      <section className={platform.panel}>
        {visible.length === 0 ? (
          <EmptyBlock
            title={
              listings.length === 0
                ? 'Sin listados de reventa'
                : 'Ningún listado con ese estado'
            }
            hint={
              listings.length === 0
                ? 'Aparecerán aquí en cuanto un asistente ponga su boleto a la venta.'
                : 'Quita el filtro para ver el resto.'
            }
          />
        ) : (
          <table className={platform.table}>
            <caption className={styles.srOnly}>
              Listados de reventa con boleto, evento, precio pedido y sobreprecio
            </caption>
            <thead>
              <tr>
                <th scope="col">Boleto</th>
                <th scope="col">Evento</th>
                <th scope="col" className={styles.numeric}>
                  Precio original
                </th>
                <th scope="col" className={styles.numeric}>
                  Precio pedido
                </th>
                <th scope="col" className={styles.numeric}>
                  Sobreprecio
                </th>
                <th scope="col">Ofertas</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ listing: l, asking, original, markup }) => {
                const st = STATUS[l.status] ?? { label: l.status, cls: 'refunded' };
                const currency = l.currency || 'MXN';
                const high = markup !== null && markup > MARKUP_ALERT;
                return (
                  <tr key={l.id} className={high ? styles.rowAlert : undefined}>
                    <th scope="row" className={styles.rowHead}>
                      <code className={styles.code}>{l.ticket?.code ?? l.id.slice(0, 8)}</code>
                      {l.createdAt && <small>{formatDateTime(l.createdAt)}</small>}
                    </th>
                    <td>{l.ticket?.event?.title ?? '—'}</td>
                    <td className={styles.numeric}>
                      {original > 0 ? formatMoney(original, currency) : '—'}
                    </td>
                    <td className={styles.numeric}>{formatMoney(asking, currency)}</td>
                    <td className={styles.numeric}>
                      {markup === null ? '—' : formatPercent(markup, 0)}
                      {high && (
                        <>
                          <br />
                          <small className={styles.lookupError}>Revisar</small>
                        </>
                      )}
                    </td>
                    <td>{l.offers?.length ?? 0}</td>
                    <td>
                      <span className={`${styles.status} ${styles[st.cls]}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
