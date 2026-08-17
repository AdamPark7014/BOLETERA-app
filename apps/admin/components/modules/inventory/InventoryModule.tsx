'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  Badge,
  BarChart,
  Button,
  Card,
  CardHeader,
  DataTable,
  DonutChart,
  Drawer,
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
  type FilterSelection,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import {
  useEventSalesPace,
  useEvents,
  useInventoryMetrics,
  useMetricsAlerts,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import {
  buildEventOptions,
  buildZoneRows,
  pressureRank,
  zoneBarSeries,
} from './derive';
import {
  daysAgoIso,
  formatAvailability,
  formatCount,
  formatDaysToSellOut,
  formatOccupancyRatio,
  formatVelocity,
  rangeLabel,
} from './format';
import {
  PRESSURE_LABEL,
  PRESSURE_TONE,
  type InventoryZoneTableRow,
  type PressureLevel,
  type RangeKey,
} from './types';
import styles from './inventory.module.scss';

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

const PRESSURE_VALUES: readonly PressureLevel[] = ['low', 'medium', 'high', 'critical'];

export function InventoryModule() {
  const { can, organizationId } = useSession();
  const canRead = can('event:read');
  const [range, setRange] = useState<RangeKey>('90');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterSelection>({});
  const [eventId, setEventId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const params = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      from: daysAgoIso(Number(range)),
      to: new Date().toISOString(),
      eventId: eventId ?? undefined,
    }),
    [eventId, organizationId, range],
  );

  const inventory = useInventoryMetrics(params);
  const pace = useEventSalesPace(params);
  const alerts = useMetricsAlerts(params);
  const events = useEvents();

  const zoneRows = useMemo(() => buildZoneRows(inventory.data), [inventory.data]);
  const eventOptions = useMemo(() => buildEventOptions(zoneRows), [zoneRows]);

  const pressureFilter = filters.pressure ?? [];
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return zoneRows.filter((row) => {
      if (eventId && row.eventId !== eventId) return false;
      if (pressureFilter.length && !pressureFilter.includes(row.pressure)) return false;
      if (!needle) return true;
      return `${row.zone} ${row.tierName} ${row.eventTitle}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [deferredQuery, eventId, pressureFilter, zoneRows]);

  const selected = useMemo(
    () => (selectedId ? (zoneRows.find((row) => row.id === selectedId) ?? null) : null),
    [selectedId, zoneRows],
  );

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

  const inventoryAlerts = useMemo(
    () =>
      (alerts.data?.alerts ?? []).filter(
        (alert) => alert.domain === 'inventory' || alert.domain === 'events',
      ),
    [alerts.data],
  );

  const atRiskEvents = pace.data?.atRisk ?? [];

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
        header: 'Zona',
        width: 200,
        sortValue: (row) => row.zone,
        render: (row) => (
          <div className={styles.zoneCell}>
            <strong>{row.zone}</strong>
            <span>
              {row.tierName} · {row.eventTitle}
            </span>
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
          description="Necesitas event:read para consultar disponibilidad y holds."
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
        description="Disponibilidad, holds, sell-through y presión de demanda por zona y evento. Datos en vivo desde /metrics/inventory."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Inventario' },
        ]}
        actions={
          <div className={styles.actions}>
            <SegmentedControl<RangeKey>
              label="Rango de análisis"
              size="sm"
              value={range}
              onValueChange={setRange}
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
              hint={`${formatCount(summary?.totalCapacity ?? 0)} aforo total · ${rangeLabel(range)}`}
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
                  value={filters}
                  onChange={setFilters}
                  search={{
                    value: query,
                    onChange: setQuery,
                    placeholder: 'Buscar zona, tier o evento…',
                  }}
                >
                  {eventId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEventId(null)}
                    >
                      Quitar evento
                    </Button>
                  ) : null}
                </FilterBar>
                <div className={styles.filterMeta} role="status">
                  <span>
                    {formatNumber(filtered.length)} de {formatNumber(zoneRows.length)} zonas
                  </span>
                </div>
              </div>

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
                  />
                ) : (
                  <EmptyState
                    illustration="search"
                    title="Sin zonas que coincidan"
                    description="Ajusta la búsqueda, la presión o el evento seleccionado."
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setQuery('');
                          setFilters({});
                          setEventId(null);
                        }}
                      >
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
                    setSelectedId(row.id === selectedId ? null : row.id)
                  }
                />
              )}

              <Card>
                <CardHeader
                  title="Composición por zona"
                  description="Disponibles, holds y vendidos (top 8 del filtro actual)"
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
                      const active = eventId === event.id;
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
                            onClick={() => setEventId(active ? null : event.id)}
                          >
                            <strong>{event.title}</strong>
                            <span className={styles.muted}>
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

      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.zone}
        description={selected?.eventTitle}
        footer={
          <Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>
            Cerrar
          </Button>
        }
      >
        {selected ? <ZoneDrawerBody row={selected} /> : null}
      </Drawer>
    </main>
  );
}

function ZoneDrawerBody({ row }: { row: InventoryZoneTableRow }) {
  return (
    <div className={styles.drawerBody}>
      <Badge tone={PRESSURE_TONE[row.pressure]} variant="soft" size="sm" dot>
        Presión {PRESSURE_LABEL[row.pressure]}
      </Badge>
      <dl className={styles.metaGrid}>
        <div>
          <dt>Tier</dt>
          <dd>{row.tierName}</dd>
        </div>
        <div>
          <dt>Aforo zona</dt>
          <dd>{formatCount(row.totalQuantity)}</dd>
        </div>
        <div>
          <dt>Disponibles</dt>
          <dd>{formatCount(row.remainingQuantity)}</dd>
        </div>
        <div>
          <dt>Holds</dt>
          <dd>{formatCount(row.holdQuantity)}</dd>
        </div>
        <div>
          <dt>Vendidos</dt>
          <dd>{formatCount(row.soldQuantity)}</dd>
        </div>
        <div>
          <dt>Disponibilidad</dt>
          <dd>{formatAvailability(row.availabilityPercent)}</dd>
        </div>
        <div>
          <dt>Velocidad</dt>
          <dd>{formatVelocity(row.sellThroughVelocity)}</dd>
        </div>
        <div>
          <dt>Agotamiento est.</dt>
          <dd>{formatDaysToSellOut(row.daysToSellOut)}</dd>
        </div>
      </dl>
      <p className={styles.muted}>
        Offer {row.offerId}. Las liberaciones programadas requieren POST /inventory/releases.
      </p>
    </div>
  );
}
