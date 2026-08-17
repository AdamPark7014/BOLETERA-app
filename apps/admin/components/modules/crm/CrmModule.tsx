'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  ActivityFeed,
  AreaChart,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  formatCompact,
  formatCurrency,
  formatNumber,
  type ActivityItem,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import {
  useExecutiveMetrics,
  useMetricsTimeseries,
  useOrders,
  useOrdersMetrics,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import { buildCustomerRows, buildSegmentCards, crmKpis } from './derive';
import {
  daysAgoIso,
  formatMoney,
  formatRelativeDay,
  formatShare,
  kpiDeltaRatio,
  rangeLabel,
} from './format';
import {
  SEGMENT_LABEL,
  SEGMENT_TONE,
  type CrmCustomerRow,
  type RangeKey,
} from './types';
import styles from './crm.module.scss';

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

export function CrmModule() {
  const { can, organizationId } = useSession();
  const canRead = can('order:read');
  const [range, setRange] = useState<RangeKey>('90');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterSelection>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const params = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      from: daysAgoIso(Number(range)),
      to: new Date().toISOString(),
    }),
    [organizationId, range],
  );

  const ordersQuery = useOrders();
  const ordersMetrics = useOrdersMetrics(params);
  const executive = useExecutiveMetrics(params);
  const timeseries = useMetricsTimeseries({
    ...params,
    granularity: 'day',
    metric: 'orders',
  });

  const customers = useMemo(
    () => buildCustomerRows(ordersQuery.data ?? []),
    [ordersQuery.data],
  );
  const segments = useMemo(() => buildSegmentCards(customers), [customers]);
  const kpis = useMemo(() => crmKpis(customers), [customers]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'segment',
        label: 'Segmento',
        options: segments.map((segment) => ({
          value: segment.id,
          label: segment.label,
          count: segment.count,
        })),
      },
      {
        id: 'channel',
        label: 'Canal',
        options: [...new Set(customers.flatMap((row) => row.channels.split(', ').filter(Boolean)))]
          .filter((value) => value !== '—')
          .sort((a, b) => a.localeCompare(b, 'es-MX'))
          .map((value) => ({
            value,
            label: value,
            count: customers.filter((row) => row.channels.includes(value)).length,
          })),
      },
    ],
    [customers, segments],
  );

  const segmentFilter = filters.segment ?? [];
  const channelFilter = filters.channel ?? [];

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return customers.filter((row) => {
      if (segmentFilter.length && !segmentFilter.includes(row.segment)) return false;
      if (
        channelFilter.length &&
        !channelFilter.some((channel) => row.channels.includes(channel))
      ) {
        return false;
      }
      if (!needle) return true;
      return `${row.name} ${row.email} ${row.topEvent} ${SEGMENT_LABEL[row.segment]}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [channelFilter, customers, deferredQuery, segmentFilter]);

  const selected = useMemo(
    () => (selectedId ? (customers.find((row) => row.id === selectedId) ?? null) : null),
    [customers, selectedId],
  );

  const seriesData = useMemo(() => {
    const points = timeseries.data?.series[0]?.points ?? [];
    return points.map((point) => ({
      label: point.label ?? point.bucket.slice(5, 10),
      value: point.value,
    }));
  }, [timeseries.data]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    return (ordersQuery.data ?? [])
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8)
      .map((order) => ({
        id: order.id,
        actor: order.buyerName || order.buyerEmail || 'Cliente',
        action: `registró pedido ${order.status.toLowerCase()}`,
        target: order.event?.title || order.publicId,
        timestamp: order.createdAt,
        detail: formatMoney(Number(order.totalAmount) || 0, order.currency),
      }));
  }, [ordersQuery.data]);

  const columns = useMemo<DataTableColumn<CrmCustomerRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Cliente',
        width: 220,
        sortValue: (row) => row.name,
        render: (row) => (
          <div className={styles.nameCell}>
            <strong>{row.name}</strong>
            <span>{row.email}</span>
          </div>
        ),
      },
      {
        key: 'segment',
        header: 'Segmento',
        width: 130,
        sortValue: (row) => row.segment,
        render: (row) => (
          <Badge tone={SEGMENT_TONE[row.segment]} variant="soft" size="sm" dot>
            {SEGMENT_LABEL[row.segment]}
          </Badge>
        ),
      },
      {
        key: 'ordersCount',
        header: 'Pedidos',
        width: 100,
        align: 'right',
        sortValue: (row) => row.ordersCount,
        render: (row) => formatNumber(row.ordersCount),
      },
      {
        key: 'totalSpend',
        header: 'LTV',
        width: 130,
        align: 'right',
        sortValue: (row) => row.totalSpend,
        render: (row) => formatMoney(row.totalSpend, row.currency),
      },
      {
        key: 'lastOrderAt',
        header: 'Última compra',
        width: 140,
        sortValue: (row) => row.lastOrderAt ?? '',
        render: (row) => formatRelativeDay(row.lastOrderAt),
      },
      {
        key: 'topEvent',
        header: 'Evento top',
        width: 180,
        sortValue: (row) => row.topEvent,
      },
      {
        key: 'channels',
        header: 'Canales',
        width: 140,
        sortValue: (row) => row.channels,
      },
    ],
    [],
  );

  const loading = ordersQuery.isPending;
  const metricsLoading = ordersMetrics.isPending || executive.isPending;

  if (!canRead) {
    return (
      <main className={styles.page}>
        <EmptyState
          title="Sin permiso para CRM"
          description="Necesitas order:read para consultar clientes derivados de pedidos."
          illustration="inbox"
          tone="neutral"
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Relación con clientes"
        title="CRM operativo"
        description="Cartera de compradores, segmentos y valor de vida derivados de pedidos reales. Sin inventar perfiles."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'CRM' },
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
              disabled={ordersQuery.isFetching}
              onClick={() => {
                void ordersQuery.refetch();
                void ordersMetrics.refetch();
                void executive.refetch();
                void timeseries.refetch();
              }}
            >
              Actualizar
            </Button>
          </div>
        }
      />

      <Section columns={4} gap="sm" aria-label="Indicadores CRM">
        <KpiCard
          label="Clientes"
          value={loading ? '—' : formatNumber(kpis.customers)}
          hint={`${formatNumber(kpis.active)} activos · ${rangeLabel(range)}`}
          loading={loading}
          tone="accent"
        />
        <KpiCard
          label="LTV promedio"
          value={loading ? '—' : formatCurrency(kpis.avgLtv)}
          unit="MXN"
          hint={`Gasto total ${formatCompact(kpis.spend)} MXN`}
          loading={loading}
          tone="success"
        />
        <KpiCard
          label="Pedidos completados"
          value={
            metricsLoading
              ? '—'
              : formatNumber(ordersMetrics.data?.kpis.completedOrders.value ?? 0)
          }
          delta={kpiDeltaRatio(ordersMetrics.data?.kpis.completedOrders.deltaPercent)}
          deltaLabel="vs. periodo previo"
          hint={rangeLabel(range)}
          loading={metricsLoading}
          tone="info"
        />
        <KpiCard
          label="Recurrencia"
          value={loading ? '—' : formatShare(kpis.retention)}
          hint="Clientes con 2+ pedidos pagados"
          loading={loading}
          tone="warning"
        />
      </Section>

      {ordersQuery.error ? (
        <QueryError error={ordersQuery.error} onRetry={() => void ordersQuery.refetch()} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.mainCol}>
            <Card padding="md">
              <CardHeader
                title="Segmentos de cartera"
                description="Clasificación operativa a partir del historial de compra"
              />
              {customers.length === 0 && !loading ? (
                <EmptyState
                  size="sm"
                  illustration="inbox"
                  title="Sin clientes todavía"
                  description="Cuando existan pedidos aparecerán segmentos VIP, recurrentes y en riesgo."
                />
              ) : (
                <div className={styles.segmentGrid} role="list" aria-label="Segmentos">
                  {segments.map((segment) => {
                    const active = (filters.segment ?? []).includes(segment.id);
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        role="listitem"
                        className={
                          active
                            ? `${styles.segmentCard} ${styles.segmentCardActive}`
                            : styles.segmentCard
                        }
                        aria-pressed={active}
                        onClick={() => {
                          const current = filters.segment ?? [];
                          const next = active
                            ? current.filter((value) => value !== segment.id)
                            : [...current, segment.id];
                          const rest: FilterSelection = Object.fromEntries(
                            Object.entries(filters).filter(([key]) => key !== 'segment'),
                          );
                          setFilters(next.length ? { ...rest, segment: next } : rest);
                        }}
                      >
                        <Badge tone={segment.tone} variant="soft" size="sm" dot>
                          {segment.label}
                        </Badge>
                        <p className={styles.segmentCount}>{formatNumber(segment.count)}</p>
                        <p className={styles.segmentMeta}>
                          {formatMoney(segment.spend)} · {segment.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            <div className={styles.toolbar}>
              <FilterBar
                filters={filterDefs}
                value={filters}
                onChange={setFilters}
                search={{
                  value: query,
                  onChange: setQuery,
                  placeholder: 'Buscar cliente, correo o evento…',
                }}
              />
              <div className={styles.filterMeta} role="status">
                <span>
                  {formatNumber(filtered.length)} de {formatNumber(customers.length)} clientes
                </span>
                {query || Object.values(filters).some((values) => (values?.length ?? 0) > 0) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setFilters({});
                    }}
                  >
                    Limpiar
                  </Button>
                ) : null}
              </div>
            </div>

            {loading ? (
              <DataTable
                label="Clientes CRM"
                columns={columns}
                data={[]}
                rowKey={(row) => row.id}
                loading
                loadingRows={8}
                maxHeight={480}
              />
            ) : filtered.length === 0 ? (
              customers.length === 0 ? (
                <EmptyState
                  illustration="inbox"
                  title="Aún no hay cartera de clientes"
                  description="Los compradores se construyen a partir de GET /admin/orders. Crea o importa pedidos para activar el CRM."
                />
              ) : (
                <EmptyState
                  illustration="search"
                  title="Sin coincidencias"
                  description="Ajusta la búsqueda o los filtros de segmento y canal."
                  action={
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setQuery('');
                        setFilters({});
                      }}
                    >
                      Limpiar filtros
                    </Button>
                  }
                />
              )
            ) : (
              <DataTable
                label="Clientes CRM"
                columns={columns}
                data={filtered}
                rowKey={(row) => row.id}
                maxHeight={480}
                density="compact"
                defaultSort={{ key: 'totalSpend', direction: 'desc' }}
                onRowClick={(row) =>
                  setSelectedId(row.id === selectedId ? null : row.id)
                }
              />
            )}
          </div>

          <div className={styles.sideCol}>
            <Card>
              <CardHeader
                title="Ritmo de pedidos"
                description={`Serie diaria · ${rangeLabel(range)}`}
              />
              {timeseries.isPending ? (
                <EmptyState size="sm" title="Cargando serie…" description="Consultando /metrics/timeseries" />
              ) : seriesData.length === 0 ? (
                <EmptyState
                  size="sm"
                  illustration="chart"
                  title="Sin actividad en el periodo"
                  description="La curva se activa cuando hay pedidos en el rango seleccionado."
                />
              ) : (
                <AreaChart
                  label="Pedidos por día"
                  caption="Fuente: métricas de pedidos"
                  height={220}
                  series={[{ id: 'orders', name: 'Pedidos', data: seriesData }]}
                  formatValue={(value) => formatNumber(value)}
                />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Señales de conversión"
                description="Indicadores del motor de pedidos"
              />
              <Section columns={1} gap="sm">
                <KpiCard
                  label="Tasa de aprobación"
                  value={
                    metricsLoading
                      ? '—'
                      : `${formatNumber(ordersMetrics.data?.kpis.approvalRate.value ?? 0, 1)} %`
                  }
                  delta={kpiDeltaRatio(ordersMetrics.data?.kpis.approvalRate.deltaPercent)}
                  loading={metricsLoading}
                  tone="success"
                  hint="Pagos aprobados / intentos"
                />
                <KpiCard
                  label="Ingreso bruto"
                  value={
                    metricsLoading
                      ? '—'
                      : formatCurrency(executive.data?.kpis.grossRevenue.value ?? 0)
                  }
                  delta={kpiDeltaRatio(executive.data?.kpis.grossRevenue.deltaPercent)}
                  loading={metricsLoading}
                  tone="accent"
                  hint="Periodo seleccionado · MXN"
                />
              </Section>
            </Card>

            <Card>
              <CardHeader title="Actividad reciente" description="Últimos pedidos de la organización" />
              <ActivityFeed
                items={activityItems}
                loading={loading}
                empty={
                  <EmptyState
                    size="sm"
                    illustration="inbox"
                    title="Sin actividad"
                    description="Los movimientos de compra aparecerán aquí."
                  />
                }
              />
            </Card>
          </div>
        </div>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.name}
        description={selected?.email}
        size="md"
        footer={
          <Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>
            Cerrar
          </Button>
        }
      >
        {selected ? <CustomerDrawerBody customer={selected} /> : null}
      </Drawer>
    </main>
  );
}

function CustomerDrawerBody({ customer }: { customer: CrmCustomerRow }) {
  return (
    <div className={styles.drawerBody}>
      <Badge tone={SEGMENT_TONE[customer.segment]} variant="soft" size="sm" dot>
        {SEGMENT_LABEL[customer.segment]}
      </Badge>
      <dl className={styles.metaGrid}>
        <div>
          <dt>LTV</dt>
          <dd>{formatMoney(customer.totalSpend, customer.currency)}</dd>
        </div>
        <div>
          <dt>Pedidos</dt>
          <dd>
            {formatNumber(customer.completedOrders)} / {formatNumber(customer.ordersCount)}
          </dd>
        </div>
        <div>
          <dt>Primera compra</dt>
          <dd>{formatRelativeDay(customer.firstOrderAt)}</dd>
        </div>
        <div>
          <dt>Última compra</dt>
          <dd>{formatRelativeDay(customer.lastOrderAt)}</dd>
        </div>
        <div>
          <dt>Canales</dt>
          <dd>{customer.channels}</dd>
        </div>
        <div>
          <dt>Evento top</dt>
          <dd>{customer.topEvent}</dd>
        </div>
      </dl>
      <p className={styles.muted}>
        Perfil derivado de pedidos. El timeline CRM dedicado se activará cuando exista
        GET /crm/customers/:id/timeline.
      </p>
    </div>
  );
}
