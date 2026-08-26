'use client';

import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  SkeletonCard,
  formatNumber,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import type { EgressOverviewVenue } from '@/lib/platform-api';
import { useEgressOverview, useVenues } from '@/lib/queries/venues';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { CreateVenueModal } from './_components/CreateVenueModal';
import { VenueInspector } from './_components/VenueInspector';
import {
  HEALTH_LABEL,
  buildPortfolioRows,
  formatCapacity,
  formatRelativeDate,
  healthRank,
  healthTone,
  venueMatchesQuery,
} from './_lib/format';
import type { HealthStatus, VenuePortfolioRow } from './_lib/types';
import { useVenuesUrlState } from './_lib/use-venues-url-state';
import styles from './venues.module.scss';

const VIEW_OPTIONS = [
  { value: 'table', label: 'Tabla' },
  { value: 'cards', label: 'Tarjetas' },
] as const;

function VenuesPageContent() {
  const session = useSession();
  const url = useVenuesUrlState();
  const venuesQuery = useVenues();
  const egressQuery = useEgressOverview();
  const [createOpen, setCreateOpen] = useState(false);
  const deferredQ = useDeferredValue(url.q);

  const egressByVenueId = useMemo(() => {
    const map = new Map<string, EgressOverviewVenue>();
    for (const venue of egressQuery.data?.venues ?? []) {
      map.set(venue.venueId, venue);
    }
    return map;
  }, [egressQuery.data]);

  const rows = useMemo(
    () => buildPortfolioRows(venuesQuery.data ?? [], egressByVenueId),
    [venuesQuery.data, egressByVenueId],
  );

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.city, (counts.get(row.city) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'es-MX'))
      .map(([city, count]) => ({ value: city, label: city, count }));
  }, [rows]);

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const healthCounts = new Map<HealthStatus, number>();
    const mapCounts = { with: 0, without: 0 };
    for (const row of rows) {
      if (row.health) healthCounts.set(row.health, (healthCounts.get(row.health) ?? 0) + 1);
      if (row.hasActiveMap) mapCounts.with += 1;
      else mapCounts.without += 1;
    }

    return [
      {
        id: 'health',
        label: 'Salud',
        options: (Object.keys(HEALTH_LABEL) as HealthStatus[]).map((status) => ({
          value: status,
          label: HEALTH_LABEL[status],
          count: healthCounts.get(status) ?? 0,
        })),
      },
      {
        id: 'map',
        label: 'Mapa',
        options: [
          { value: 'with', label: 'Con mapa activo', count: mapCounts.with },
          { value: 'without', label: 'Sin mapa activo', count: mapCounts.without },
        ],
      },
      ...(cityOptions.length > 1
        ? [
            {
              id: 'city',
              label: 'Ciudad',
              options: cityOptions,
            } satisfies FilterDefinition,
          ]
        : []),
    ];
  }, [rows, cityOptions]);

  const filtered = useMemo(() => {
    return rows
      .filter((row) => {
        if (!venueMatchesQuery(row, deferredQ)) return false;
        if (url.health.length && (!row.health || !url.health.includes(row.health))) return false;
        if (url.maps.includes('with') && !row.hasActiveMap) return false;
        if (url.maps.includes('without') && row.hasActiveMap) return false;
        if (url.cities.length && !url.cities.includes(row.city)) return false;
        return true;
      })
      .sort((a, b) => healthRank(b.health) - healthRank(a.health) || a.name.localeCompare(b.name, 'es-MX'));
  }, [rows, deferredQ, url.health, url.maps, url.cities]);

  const selected = useMemo(() => {
    if (!url.selectedId) return null;
    return filtered.find((row) => row.id === url.selectedId) ?? rows.find((row) => row.id === url.selectedId) ?? null;
  }, [filtered, rows, url.selectedId]);

  const stats = useMemo(() => {
    const withMap = rows.filter((row) => row.hasActiveMap).length;
    const attention = rows.filter((row) => row.health === 'critical' || row.health === 'warn').length;
    const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
    return { total: rows.length, withMap, attention, capacity };
  }, [rows]);

  const columns = useMemo<readonly DataTableColumn<VenuePortfolioRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Venue',
        sortable: true,
        render: (row) => (
          <div className={styles.nameCell}>
            <strong>{row.name}</strong>
            <code>{row.slug}</code>
          </div>
        ),
      },
      {
        key: 'city',
        header: 'Ciudad',
        sortable: true,
        width: 140,
      },
      {
        key: 'capacity',
        header: 'Aforo',
        sortable: true,
        align: 'right',
        width: 110,
        render: (row) => formatCapacity(row.capacity),
      },
      {
        key: 'events',
        header: 'Eventos',
        sortable: true,
        align: 'right',
        width: 90,
        render: (row) => formatNumber(row.events),
      },
      {
        key: 'health',
        header: 'Salud',
        width: 130,
        render: (row) => (
          <Badge tone={healthTone(row.health)} variant="soft" size="sm" dot>
            {row.health ? HEALTH_LABEL[row.health] : 'Sin análisis'}
          </Badge>
        ),
      },
      {
        key: 'layoutUpdatedAt',
        header: 'Actualizado',
        sortable: true,
        width: 160,
        render: (row) => formatRelativeDate(row.layoutUpdatedAt),
      },
      {
        key: 'actions',
        header: '',
        width: 170,
        render: (row) => (
          <div className={styles.actionGroup}>
            <Link href={`/venues/${row.id}/map`} className={styles.mapLink}>
              Mapa
            </Link>
            <Link href={`/venues/${row.id}/3d`} className={styles.mapLink}>
              3D
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;

  const loading = venuesQuery.isPending;
  const error = venuesQuery.error ?? egressQuery.error;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Venues y mapas"
        description={`${stats.total} recintos · ${stats.withMap} con mapa activo · editor 2D, IA y vista 3D`}
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Nuevo venue
          </Button>
        }
      />

      <Section columns={4} gap="md">
        <KpiCard label="Recintos" value={formatNumber(stats.total)} tone="accent" />
        <KpiCard label="Con mapa activo" value={formatNumber(stats.withMap)} tone="success" />
        <KpiCard
          label="Requieren revisión"
          value={formatNumber(stats.attention)}
          tone={stats.attention > 0 ? 'warning' : 'neutral'}
          invertDelta
        />
        <KpiCard
          label="Aforo declarado"
          value={formatNumber(stats.capacity)}
          hint="Suma de capacidades registradas"
        />
      </Section>

      <div className={styles.toolbar}>
        <FilterBar
          className={styles.filterBar}
          filters={filterDefs}
          value={url.filterSelection}
          onChange={url.setFilterSelection}
          search={{
            value: url.q,
            onChange: url.setSearch,
            placeholder: 'Buscar por nombre, slug o ciudad…',
          }}
        >
          <SegmentedControl
            label="Vista"
            size="sm"
            options={VIEW_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
            value={url.view}
            onValueChange={(value) => url.setView(value as 'table' | 'cards')}
          />
        </FilterBar>
        <p className={styles.filterMeta}>
          {filtered.length === rows.length
            ? `${filtered.length} venues`
            : `${filtered.length} de ${rows.length} venues`}
        </p>
      </div>

      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            void venuesQuery.refetch();
            void egressQuery.refetch();
          }}
        />
      ) : (
        <div className={styles.layout}>
          <div className={styles.mainCol}>
            {loading ? (
              <div className={styles.cardGrid} aria-busy="true" aria-label="Cargando venues">
                {Array.from({ length: 6 }, (_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title={rows.length === 0 ? 'Aún no hay recintos' : 'Sin resultados'}
                description={
                  rows.length === 0
                    ? 'Crea tu primer venue para diseñar mapas, analizar circulación y publicar eventos.'
                    : 'Prueba otro filtro o término de búsqueda.'
                }
                action={
                  rows.length === 0 ? (
                    <Button type="button" onClick={() => setCreateOpen(true)}>
                      Crear venue
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={url.clearFilters}>
                      Limpiar filtros
                    </Button>
                  )
                }
              />
            ) : url.view === 'table' ? (
              <DataTable
                label="Portafolio de venues"
                columns={columns}
                data={filtered}
                rowKey={(row) => row.id}
                onRowClick={(row) => url.setSelectedId(row.id)}
                empty={
                  <EmptyState
                    size="sm"
                    title="Sin resultados"
                    description="Ajusta los filtros para ver venues."
                  />
                }
              />
            ) : (
              <div className={styles.cardGrid}>
                {filtered.map((row) => {
                  const selectedCard = row.id === url.selectedId;
                  return (
                    <article
                      key={row.id}
                      className={selectedCard ? `${styles.venueCard} ${styles.venueCardSelected}` : styles.venueCard}
                    >
                      <button
                        type="button"
                        className={styles.cardButton}
                        onClick={() => url.setSelectedId(selectedCard ? null : row.id)}
                        aria-pressed={selectedCard}
                      >
                        <div className={styles.cardTop}>
                          <div>
                            <h2 className={styles.cardTitle}>{row.name}</h2>
                            <p className={styles.cardMeta}>
                              {row.city} · <code>{row.slug}</code>
                            </p>
                          </div>
                          <Badge tone={healthTone(row.health)} variant="soft" size="sm" dot>
                            {row.health ? HEALTH_LABEL[row.health] : 'Sin análisis'}
                          </Badge>
                        </div>
                        <ul className={styles.cardStats}>
                          <li>
                            <span>Aforo</span>
                            <strong>{formatCapacity(row.capacity)}</strong>
                          </li>
                          <li>
                            <span>Eventos</span>
                            <strong>{formatNumber(row.events)}</strong>
                          </li>
                          <li>
                            <span>Mapas</span>
                            <strong>{formatNumber(row.mapCount)}</strong>
                          </li>
                        </ul>
                      </button>
                      <div className={styles.cardFooter}>
                        <span className={styles.muted}>
                          {row.hasActiveMap
                            ? `Actualizado ${formatRelativeDate(row.layoutUpdatedAt)}`
                            : 'Sin mapa activo'}
                        </span>
                        <div className={styles.actionGroup}>
                          <Link href={`/venues/${row.id}/map`} className={styles.mapLink}>
                            Mapa
                          </Link>
                          <Link href={`/venues/${row.id}/3d`} className={styles.mapLink}>
                            3D
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <VenueInspector row={selected} onClose={() => url.setSelectedId(null)} />
        </div>
      )}

      <CreateVenueModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function VenuesPageFallback() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Cargando venues">
      <SkeletonCard />
    </div>
  );
}

export default function VenuesPage() {
  return (
    <Suspense fallback={<VenuesPageFallback />}>
      <VenuesPageContent />
    </Suspense>
  );
}
