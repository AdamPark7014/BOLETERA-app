'use client';

import Link from 'next/link';
import { Suspense, useDeferredValue, useMemo } from 'react';
import {
  Badge,
  BarChart,
  Button,
  Card,
  CardHeader,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  ProgressRing,
  Section,
  SegmentedControl,
  formatNumber,
  type DataTableColumn,
  type DonutSlice,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import {
  useInventoryAlerts,
  useInventoryAvailability,
  useInventoryEvents,
  useInventoryMetrics,
  useInventorySalesPace,
  useInventoryVenues,
} from '@/lib/queries/inventory';
import { useSession } from '@/lib/use-session';
import { ZoneDetailDrawer } from './_components/ZoneDetailDrawer';
import {
  buildEventOptions,
  buildSelloutRisks,
  buildZoneRows,
  pressureRank,
  zoneBarSeries,
} from './_lib/derive';
import {
  daysAgoIso,
  formatAvailability,
  formatCount,
  formatDaysToSellOut,
  formatOccupancyRatio,
  formatVelocity,
  rangeLabel,
} from './_lib/format';
import {
  PRESSURE_LABEL,
  PRESSURE_TONE,
  PRESSURE_VALUES,
  RANGE_OPTIONS,
  type InventoryZoneTableRow,
  type RangeKey,
} from './_lib/types';
import { useInventoryUrlState } from './_lib/use-inventory-url-state';
import styles from './inventory.module.scss';

function InventoryCockpit() {
  const { can, organizationId } = useSession();
  const canRead = can('event:read');
  const url = useInventoryUrlState();
  const deferredQuery = useDeferredValue(url.q);

  const params = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      from: daysAgoIso(Number(url.range)),
      to: new Date().toISOString(),
      eventId: url.eventId ?? undefined,
    }),
    [organizationId, url.eventId, url.range],
  );

  const inventory = useInventoryMetrics(params);
  const pace = useInventorySalesPace(params);
  const alerts = useInventoryAlerts(params);
  const events = useInventoryEvents();
  const venues = useInventoryVenues();

  const zoneRows = useMemo(() => buildZoneRows(inventory.data), [inventory.data]);
  const eventOptions = useMemo(
    () => buildEventOptions(zoneRows, events.data, venues.data),
    [events.data, venues.data, zoneRows],
  );

  const venueEventIds = useMemo(() => {
    if (!url.venueId) return null;
    const ids = new Set(
      (events.data ?? [])
        .filter((event) => event.venueId === url.venueId)
        .map((event) => event.id),
    );
    return ids;
  }, [events.data, url.venueId]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return zoneRows.filter((row) => {
      if (url.eventId && row.eventId !== url.eventId) return false;
      if (venueEventIds && !venueEventIds.has(row.eventId)) return false;
      if (url.pressures.length && !url.pressures.includes(row.pressure)) return false;
      if (!needle) return true;
      return `${row.zone} ${row.tierName} ${row.eventTitle}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [deferredQuery, url.eventId, url.pressures, venueEventIds, zoneRows]);

  const selected = useMemo(
    () => (url.selectedId ? (zoneRows.find((row) => row.id === url.selectedId) ?? null) : null),
    [url.selectedId, zoneRows],
  );

  const availability = useInventoryAvailability(selected?.eventId ?? url.eventId);

  const summary = inventory.data?.summary;
  const occupancy =
    summary && summary.totalCapacity > 0 ? summary.sold / summary.totalCapacity : 0;

  const donutSlices = useMemo<DonutSlice[]>(() => {
    const breakdown = inventory.data?.statusBreakdown;
    if (breakdown?.rows?.length) {
      return breakdown.rows.map((row) => ({
        id: row.key,
        label: row.label,
        value: row.value,
      }));
    }
    if (!summary) return [];
    return [
      { id: 'available', label: 'Disponibles', value: summary.available },
      { id: 'held', label: 'En hold', value: summary.held },
      { id: 'sold', label: 'Vendidos', value: summary.sold },
      { id: 'blocked', label: 'Bloqueados', value: summary.blocked },
    ].filter((slice) => slice.value > 0);
  }, [inventory.data?.statusBreakdown, summary]);

  const bars = useMemo(() => zoneBarSeries(filtered), [filtered]);
  const sellouts = useMemo(() => buildSelloutRisks(filtered), [filtered]);

  const inventoryAlerts = useMemo(
    () =>
      (alerts.data?.alerts ?? []).filter(
        (alert) => alert.domain === 'inventory' || alert.domain === 'events',
      ),
    [alerts.data],
  );

  const atRiskEvents = pace.data?.atRisk ?? [];

  const venueOptions = useMemo(() => {
    const used = new Set(eventOptions.map((event) => event.venueName).filter(Boolean));
    return (venues.data ?? []).filter((venue) => used.has(venue.name) || used.size === 0);
  }, [eventOptions, venues.data]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'pressure',
        label: 'Presión',
        options: PRESSURE_VALUES.map((value) => ({
          value,
          label: PRESSURE_LABEL[value],
          count: zoneRows.filter((row) => row.pressure === value).length,
        })),
      },
    ],
    [zoneRows],
  );

  const columns = useMemo<DataTableColumn<InventoryZoneTableRow>[]>(
    () => [
      {
        key: 'zone',
        header: 'Zona / tier',
        width: 220,
        sortValue: (row) => row.zone,
        render: (row) => (
          <div className={styles.zoneCell}>
            <strong>
              {row.zone} · {row.tierName}
            </strong>
            <span>{row.eventTitle}</span>
          </div>
        ),
      },
      {
        key: 'remainingQuantity',
        header: 'Disponibles',
        width: 110,
        align: 'right',
        sortValue: (row) => row.remainingQuantity,
        render: (row) => formatCount(row.remainingQuantity),
      },
      {
        key: 'holdQuantity',
        header: 'Holds',
        width: 90,
        align: 'right',
        sortValue: (row) => row.holdQuantity,
        render: (row) => formatCount(row.holdQuantity),
      },
      {
        key: 'soldQuantity',
        header: 'Vendidos',
        width: 100,
        align: 'right',
        sortValue: (row) => row.soldQuantity,
        render: (row) => formatCount(row.soldQuantity),
      },
      {
        key: 'availabilityPercent',
        header: 'Disponibilidad',
        width: 120,
        align: 'right',
        sortValue: (row) => row.availabilityPercent,
        render: (row) => formatAvailability(row.availabilityPercent),
      },
      {
        key: 'sellThroughVelocity',
        header: 'Velocidad',
        width: 120,
        align: 'right',
        sortValue: (row) => row.sellThroughVelocity,
        render: (row) => formatVelocity(row.sellThroughVelocity),
      },
      {
        key: 'daysToSellOut',
        header: 'Agotamiento',
        width: 120,
        align: 'right',
        sortValue: (row) => row.daysToSellOut ?? Number.POSITIVE_INFINITY,
        render: (row) => formatDaysToSellOut(row.daysToSellOut),
      },
      {
        key: 'pressure',
        header: 'Presión',
        width: 120,
        sortValue: (row) => pressureRank(row.pressure),
        render: (row) => (
          <Badge tone={PRESSURE_TONE[row.pressure]} variant="soft" size="sm" dot>
            {PRESSURE_LABEL[row.pressure]}
          </Badge>
        ),
      },
    ],
    [],
  );

  const loading = inventory.isPending;

  if (!canRead) {
    return (
      <main className={styles.page}>
        <EmptyState
          title="Sin permiso para inventario"
          description="Necesitas event:read para consultar disponibilidad, holds y bloqueos."
          illustration="inbox"
          tone="neutral"
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Operaciones · Inventario"
        title="Inventario de boletos"
        description="Disponibilidad por zona y tier, holds activos, bloqueos operativos, proyección de agotamiento y alertas en vivo."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Inventario' },
        ]}
        actions={
          <div className={styles.actions}>
            <SegmentedControl<RangeKey>
              label="Rango de análisis"
              size="sm"
              value={url.range}
              onValueChange={url.setRange}
              options={RANGE_OPTIONS}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={inventory.isFetching}
              onClick={() => {
                void inventory.refetch();
                void pace.refetch();
                void alerts.refetch();
                void events.refetch();
                void venues.refetch();
                void availability.refetch();
              }}
            >
              Actualizar
            </Button>
          </div>
        }
      />

      {inventory.error ? (
        <QueryError error={inventory.error} onRetry={() => void inventory.refetch()} />
      ) : (
        <>
          <Section columns={4} gap="sm" aria-label="Indicadores de inventario">
            <KpiCard
              label="Disponibles"
              value={loading ? '—' : formatCount(summary?.available ?? 0)}
              hint={`${formatCount(summary?.totalCapacity ?? 0)} aforo · ${rangeLabel(url.range)}`}
              loading={loading}
              tone="success"
            />
            <KpiCard
              label="En hold"
              value={loading ? '—' : formatCount(summary?.held ?? 0)}
              hint={`${formatCount(summary?.activeHolds ?? 0)} holds activos`}
              loading={loading}
              tone="warning"
            />
            <KpiCard
              label="Vendidos"
              value={loading ? '—' : formatCount(summary?.sold ?? 0)}
              hint={formatOccupancyRatio(summary?.sold ?? 0, summary?.totalCapacity ?? 0)}
              loading={loading}
              tone="accent"
            />
            <KpiCard
              label="Bloqueados"
              value={loading ? '—' : formatCount(summary?.blocked ?? 0)}
              hint="VIP, prensa, producción y cortesías"
              loading={loading}
              tone="info"
            />
          </Section>

          <div className={styles.layout}>
            <div className={styles.mainCol}>
              <div className={styles.toolbar}>
                <FilterBar
                  filters={filterDefs}
                  value={url.filterSelection}
                  onChange={url.setFilterSelection}
                  search={{
                    value: url.q,
                    onChange: url.setSearch,
                    placeholder: 'Buscar zona, tier o evento…',
                  }}
                >
                  {url.eventId || url.venueId ? (
                    <Button type="button" variant="ghost" size="sm" onClick={url.clearFilters}>
                      Quitar filtros de evento
                    </Button>
                  ) : null}
                </FilterBar>
                <div className={styles.filterMeta} role="status">
                  <span>
                    {formatNumber(filtered.length)} de {formatNumber(zoneRows.length)} zonas
                  </span>
                </div>
              </div>

              {venueOptions.length > 0 ? (
                <div className={styles.venueRow} role="group" aria-label="Filtrar por venue">
                  <button
                    type="button"
                    className={
                      !url.venueId
                        ? `${styles.venueChip} ${styles.venueChipActive}`
                        : styles.venueChip
                    }
                    onClick={() => url.setVenueId(null)}
                  >
                    Todos los venues
                  </button>
                  {venueOptions.slice(0, 8).map((venue) => {
                    const active = url.venueId === venue.id;
                    return (
                      <button
                        key={venue.id}
                        type="button"
                        className={
                          active
                            ? `${styles.venueChip} ${styles.venueChipActive}`
                            : styles.venueChip
                        }
                        aria-pressed={active}
                        onClick={() => url.setVenueId(active ? null : venue.id)}
                      >
                        {venue.name}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {loading ? (
                <DataTable
                  label="Inventario por zona"
                  columns={columns}
                  data={[]}
                  rowKey={(row) => row.id}
                  loading
                  loadingRows={8}
                  maxHeight={480}
                />
              ) : filtered.length === 0 ? (
                zoneRows.length === 0 ? (
                  <EmptyState
                    illustration="seats"
                    title="Sin inventario publicado"
                    description={
                      events.data?.length
                        ? 'Hay eventos, pero /metrics/inventory aún no reporta zonas. Publica ofertas o espera la agregación.'
                        : 'Crea y publica un evento con ofertas para ver cupos, holds y presión de demanda.'
                    }
                    action={
                      events.data?.length ? (
                        <Link href="/events">
                          <Button type="button">Abrir eventos</Button>
                        </Link>
                      ) : (
                        <Link href="/events/new">
                          <Button type="button">Crear evento</Button>
                        </Link>
                      )
                    }
                    secondaryAction={
                      <Link href="/venues">
                        <Button type="button" variant="secondary">
                          Gestionar venues
                        </Button>
                      </Link>
                    }
                  />
                ) : (
                  <EmptyState
                    illustration="search"
                    title="Sin zonas que coincidan"
                    description="Ajusta la búsqueda, la presión, el venue o el evento seleccionado."
                    action={
                      <Button type="button" variant="secondary" onClick={url.clearFilters}>
                        Limpiar filtros
                      </Button>
                    }
                  />
                )
              ) : (
                <DataTable
                  label="Inventario por zona"
                  columns={columns}
                  data={filtered}
                  rowKey={(row) => row.id}
                  maxHeight={480}
                  density="compact"
                  defaultSort={{ key: 'pressure', direction: 'desc' }}
                  onRowClick={(row) =>
                    url.setSelectedId(row.id === url.selectedId ? null : row.id)
                  }
                />
              )}

              <Card>
                <CardHeader
                  title="Composición por zona"
                  description="Disponibles, holds, vendidos y bloqueos estimados (top 8 del filtro)"
                />
                {filtered.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="chart"
                    title="Sin series para graficar"
                    description="Selecciona zonas con inventario para ver la comparación."
                  />
                ) : (
                  <BarChart
                    label="Inventario por zona"
                    layout="stacked"
                    height={260}
                    series={[
                      { id: 'available', name: 'Disponibles', data: bars.available },
                      { id: 'held', name: 'Holds', data: bars.held },
                      { id: 'sold', name: 'Vendidos', data: bars.sold },
                      { id: 'blocked', name: 'Bloqueos est.', data: bars.blocked },
                    ]}
                    formatValue={(value) => formatCount(value)}
                  />
                )}
              </Card>
            </div>

            <div className={styles.sideCol}>
              <Card>
                <CardHeader title="Mix de estados" description="Aforo agregado del periodo" />
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
                  <ProgressRing
                    label="Ocupación vendida"
                    value={occupancy * 100}
                    max={100}
                    tone={occupancy >= 0.8 ? 'warning' : 'accent'}
                    size={96}
                  >
                    {formatOccupancyRatio(summary?.sold ?? 0, summary?.totalCapacity ?? 0)}
                  </ProgressRing>
                </div>
                {donutSlices.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="chart"
                    title="Sin desglose"
                    description="El mix aparece cuando hay cupos en el inventario."
                  />
                ) : (
                  <DonutChart
                    label="Estados de inventario"
                    slices={donutSlices}
                    height={220}
                    centerLabel="Boletos"
                    formatValue={(value) => formatCount(value)}
                  />
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Eventos con inventario"
                  description="Filtra la tabla al hacer clic"
                />
                {eventOptions.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="inbox"
                    title="Sin eventos en métricas"
                    description="Los eventos con zonas publicadas aparecerán aquí."
                  />
                ) : (
                  <ul className={styles.eventList} aria-label="Eventos">
                    {eventOptions.slice(0, 8).map((event) => {
                      const active = url.eventId === event.id;
                      return (
                        <li key={event.id}>
                          <button
                            type="button"
                            className={
                              active
                                ? `${styles.eventItem} ${styles.eventItemActive}`
                                : styles.eventItem
                            }
                            aria-pressed={active}
                            onClick={() => url.setEventId(active ? null : event.id)}
                          >
                            <strong>{event.title}</strong>
                            <span className={styles.muted}>
                              {event.venueName ? `${event.venueName} · ` : ''}
                              {formatCount(event.zones)} zonas · {formatCount(event.available)}{' '}
                              libres · {formatCount(event.held)} en hold
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Riesgo de agotamiento"
                  description="Zonas con ≤14 días al sell-out al ritmo actual"
                />
                {sellouts.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="success"
                    title="Sin agotamientos próximos"
                    description="Ninguna zona filtrada proyecta sell-out en dos semanas."
                    tone="success"
                  />
                ) : (
                  <ul className={styles.eventList}>
                    {sellouts.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={styles.eventItem}
                          onClick={() => url.setSelectedId(row.id)}
                        >
                          <strong>
                            {row.zone} · {row.tierName}
                          </strong>
                          <span className={styles.muted}>
                            {row.eventTitle} · {formatDaysToSellOut(row.daysToSellOut)} ·{' '}
                            {formatCount(row.remainingQuantity)} libres
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Riesgo de ritmo"
                  description="Eventos atrasados vs. pace esperado"
                />
                {pace.isPending ? (
                  <p className={styles.muted}>Cargando sales pace…</p>
                ) : atRiskEvents.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="success"
                    title="Sin eventos en riesgo"
                    description="Ningún evento supera el umbral de atraso de venta."
                    tone="success"
                  />
                ) : (
                  <ul className={styles.eventList}>
                    {atRiskEvents.slice(0, 5).map((event) => (
                      <li key={event.eventId} className={styles.eventItem}>
                        <strong>{event.title}</strong>
                        <span className={styles.muted}>
                          {formatNumber(event.occupancyPercent, 1)} % ocupación · riesgo{' '}
                          {event.riskLevel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="Alertas de inventario" description="Señales accionables" />
                {inventoryAlerts.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="inbox"
                    title="Sin alertas"
                    description="No hay recomendaciones de inventario en este periodo."
                  />
                ) : (
                  <ul className={styles.eventList}>
                    {inventoryAlerts.slice(0, 5).map((alert) => (
                      <li key={alert.id} className={styles.eventItem}>
                        <Badge
                          tone={
                            alert.severity === 'critical'
                              ? 'danger'
                              : alert.severity === 'warning'
                                ? 'warning'
                                : 'info'
                          }
                          variant="soft"
                          size="sm"
                          dot
                        >
                          {alert.severity}
                        </Badge>
                        <strong>{alert.title}</strong>
                        <span className={styles.muted}>{alert.explanation}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      <ZoneDetailDrawer
        row={selected}
        availability={availability.data}
        availabilityPending={availability.isPending && Boolean(selected?.eventId)}
        onClose={() => url.setSelectedId(null)}
      />
    </main>
  );
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <EmptyState title="Cargando inventario…" illustration="seats" />
        </main>
      }
    >
      <InventoryCockpit />
    </Suspense>
  );
}
