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
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  formatNumber,
  type BadgeTone,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { Notice, ResourceView } from '../orders/_ui/States';
import { useResource } from '../orders/_ui/useResource';
import { formatDateTime, formatMoney, formatPercent, toNumber } from '../orders/_ui/format';
import styles from './resale.module.scss';

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

type ResaleTableRow = {
  id: string;
  listing: Listing;
  asking: number;
  original: number;
  markup: number | null;
  currency: string;
};

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Activo', tone: 'success' },
  PENDING: { label: 'Pendiente', tone: 'warning' },
  SOLD: { label: 'Vendido', tone: 'info' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
  EXPIRED: { label: 'Expirado', tone: 'neutral' },
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
    <div className={styles.page}>
      <PageHeader
        eyebrow="Marketplace"
        title="Reventa"
        description="Listados del marketplace y control de sobreprecio"
        actions={
          <Button
            type="button"
            variant="outline"
            loading={resource.state.phase === 'loading'}
            loadingLabel="Actualizando…"
            onClick={() => resource.reload()}
          >
            Actualizar
          </Button>
        }
      />

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
  const rows = useMemo<ResaleTableRow[]>(
    () =>
      listings.map((listing) => {
        const asking = toNumber(listing.askingPrice);
        const original = toNumber(
          listing.priceComparison?.originalPrice ?? listing.ticket?.offer?.basePrice ?? null,
        );
        const markup = original > 0 ? ((asking - original) / original) * 100 : null;
        return {
          id: listing.id,
          listing,
          asking,
          original,
          markup,
          currency: listing.currency || 'MXN',
        };
      }),
    [listings],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const listing of listings) {
      counts.set(listing.status, (counts.get(listing.status) ?? 0) + 1);
    }
    return counts;
  }, [listings]);

  const statusFilterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: Array.from(statusCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({
            value,
            label: STATUS[value]?.label ?? value,
            count,
          })),
      },
    ],
    [statusCounts],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const selection: Record<string, readonly string[]> = {};
    if (status !== 'ALL') selection.status = [status];
    return selection;
  }, [status]);

  const visible = useMemo(
    () => (status === 'ALL' ? rows : rows.filter((row) => row.listing.status === status)),
    [rows, status],
  );

  const flagged = useMemo(
    () => rows.filter((row) => row.markup !== null && row.markup > MARKUP_ALERT),
    [rows],
  );

  const activeCount = statusCounts.get('ACTIVE') ?? 0;
  const totalOffers = useMemo(
    () => rows.reduce((sum, row) => sum + (row.listing.offers?.length ?? 0), 0),
    [rows],
  );

  const anyFilter = status !== 'ALL';

  const columns = useMemo<readonly DataTableColumn<ResaleTableRow>[]>(
    () => [
      {
        key: 'ticket',
        header: 'Boleto',
        width: 180,
        sortValue: (row) => row.listing.ticket?.code ?? row.id,
        render: (row) => (
          <div className={styles.ticketCell}>
            <code className={styles.code}>
              {row.listing.ticket?.code ?? row.id.slice(0, 8)}
            </code>
            {row.listing.createdAt ? (
              <span className={styles.subtle}>{formatDateTime(row.listing.createdAt)}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'event',
        header: 'Evento',
        width: 220,
        sortValue: (row) => row.listing.ticket?.event?.title ?? '',
        render: (row) => row.listing.ticket?.event?.title ?? '—',
      },
      {
        key: 'original',
        header: 'Precio original',
        width: 140,
        align: 'right',
        sortValue: (row) => row.original,
        render: (row) =>
          row.original > 0 ? formatMoney(row.original, row.currency) : '—',
      },
      {
        key: 'asking',
        header: 'Precio pedido',
        width: 140,
        align: 'right',
        sortValue: (row) => row.asking,
        render: (row) => formatMoney(row.asking, row.currency),
      },
      {
        key: 'markup',
        header: 'Sobreprecio',
        width: 130,
        align: 'right',
        sortValue: (row) => row.markup ?? -1,
        render: (row) => {
          const high = row.markup !== null && row.markup > MARKUP_ALERT;
          if (row.markup === null) return '—';
          return (
            <div className={styles.markupCell}>
              <span className={styles.numeric}>{formatPercent(row.markup, 0)}</span>
              {high ? (
                <Badge tone="danger" variant="soft" size="sm">
                  Revisar
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'offers',
        header: 'Ofertas',
        width: 90,
        align: 'right',
        sortValue: (row) => row.listing.offers?.length ?? 0,
        render: (row) => formatNumber(row.listing.offers?.length ?? 0),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 130,
        sortValue: (row) => row.listing.status,
        render: (row) => {
          const meta = STATUS[row.listing.status] ?? {
            label: row.listing.status,
            tone: 'neutral' as BadgeTone,
          };
          return (
            <Badge tone={meta.tone} variant="soft" size="sm" dot>
              {meta.label}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  if (listings.length === 0) {
    return (
      <EmptyState
        title="Sin listados de reventa"
        description="Aparecerán aquí en cuanto un asistente ponga su boleto a la venta."
      />
    );
  }

  return (
    <>
      <Section columns={4} gap="md" className={styles.kpiStrip}>
        <KpiCard label="Listados" value={formatNumber(listings.length)} tone="accent" />
        <KpiCard
          label="Activos"
          value={formatNumber(activeCount)}
          tone={activeCount > 0 ? 'success' : 'neutral'}
        />
        <KpiCard
          label="Sobreprecio alto"
          value={formatNumber(flagged.length)}
          tone={flagged.length > 0 ? 'warning' : 'neutral'}
          invertDelta
          hint={`Más de ${MARKUP_ALERT}% sobre el precio original`}
        />
        <KpiCard label="Ofertas recibidas" value={formatNumber(totalOffers)} />
      </Section>

      {flagged.length > 0 && (
        <Notice tone="warn" title={`${flagged.length} listado(s) con sobreprecio alto`}>
          <p>
            Piden más de {MARKUP_ALERT}% por encima del precio original. Revisa si el evento tiene
            tope de reventa antes de dejarlos publicados.
          </p>
        </Notice>
      )}

      <div className={styles.panel}>
        <FilterBar
          filters={statusFilterDefs}
          value={filterSelection}
          onChange={(next) => setStatus(next.status?.[0] ?? 'ALL')}
        />
        <div className={styles.panelHead}>
          <p>
            {visible.length === listings.length
              ? `${formatNumber(visible.length)} listados en pantalla`
              : `${formatNumber(visible.length)} de ${formatNumber(listings.length)} listados coinciden con los filtros`}
          </p>
          {anyFilter ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setStatus('ALL')}>
              Limpiar filtros
            </Button>
          ) : null}
        </div>

        <DataTable
          label="Listados de reventa con boleto, evento, precio pedido y sobreprecio"
          columns={columns}
          data={visible}
          rowKey={(row) => row.id}
          defaultSort={{ key: 'markup', direction: 'desc' }}
          empty={
            <EmptyState
              title="Ningún listado con ese estado"
              description="Quita el filtro para ver el resto."
              action={
                <Button type="button" variant="outline" onClick={() => setStatus('ALL')}>
                  Limpiar filtros
                </Button>
              }
            />
          }
        />
      </div>
    </>
  );
}
