'use client';

import Link from 'next/link';
import { Suspense, useDeferredValue, useMemo } from 'react';
import {
  AreaChart,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  FilterBar,
  formatCompact,
  formatCurrency,
  formatNumber,
  KpiCard,
  PageHeader,
  SegmentedControl,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useCrmWorkspace } from '@/lib/queries/crm';
import { useSession } from '@/lib/use-session';
import { CrmSkeleton } from './_components/CrmSkeleton';
import { CustomerDrawerBody } from './_components/CustomerDrawer';
import {
  ActivityCard,
  buildCrmActivity,
  DemandSignalsCard,
  FrequentAndChurnLists,
  LimitsNote,
  RecommendationsCard,
} from './_components/InsightsPanels';
import { SegmentCards } from './_components/SegmentCards';
import {
  buildCustomerRows,
  buildSegmentCards,
  churnRiskCustomers,
  crmKpis,
  frequentBuyers,
  indexAiByEmail,
} from './_lib/derive';
import {
  daysAgoIso,
  formatChurnPct,
  formatMoney,
  formatRelativeDay,
  formatRfm,
  formatShare,
  kpiDeltaRatio,
  rangeLabel,
} from './_lib/format';
import {
  CHURN_LABEL,
  CHURN_TONE,
  SEGMENT_LABEL,
  SEGMENT_TONE,
} from './_lib/labels';
import { buildCrmRecommendations } from './_lib/recommendations';
import type { CrmCustomerRow, CrmRangeKey } from './_lib/types';
import { useCrmUrlState } from './_lib/use-crm-url-state';
import styles from './crm.module.scss';

const RANGE_OPTIONS: ReadonlyArray<{ value: CrmRangeKey; label: string }> = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

function CrmCockpit() {
  const { can, organizationId } = useSession();
  const canRead = can('order:read');
  const url = useCrmUrlState();
  const deferredQuery = useDeferredValue(url.q);

  const rangeBounds = useMemo(
    () => ({
      from: daysAgoIso(Number(url.range)),
      to: new Date().toISOString(),
    }),
    [url.range],
  );

  const workspace = useCrmWorkspace({
    organizationId,
    from: rangeBounds.from,
    to: rangeBounds.to,
    enabled: canRead,
  });

  const aiByEmail = useMemo(
    () => indexAiByEmail(workspace.aiSegmentation.data?.customers),
    [workspace.aiSegmentation.data?.customers],
  );

  const customers = useMemo(
    () => buildCustomerRows(workspace.orders.data ?? [], aiByEmail),
    [aiByEmail, workspace.orders.data],
  );
  const segments = useMemo(() => buildSegmentCards(customers), [customers]);
  const kpis = useMemo(() => crmKpis(customers), [customers]);
  const frequent = useMemo(() => frequentBuyers(customers), [customers]);
  const churnList = useMemo(() => churnRiskCustomers(customers), [customers]);

  const recommendations = useMemo(
    () =>
      buildCrmRecommendations({
        customers,
        kpis,
        waitlist: workspace.waitlist.data ?? [],
        apiKeys: workspace.apiKeys.data ?? [],
        ai: workspace.aiRecommendations.data?.recommendations,
      }),
    [
      customers,
      kpis,
      workspace.apiKeys.data,
      workspace.aiRecommendations.data?.recommendations,
      workspace.waitlist.data,
    ],
  );

  const activityItems = useMemo(
    () =>
      buildCrmActivity({
        orders: workspace.orders.data ?? [],
        audit: workspace.audit.data ?? [],
      }),
    [workspace.audit.data, workspace.orders.data],
  );

  const seriesData = useMemo(() => {
    const points = workspace.timeseries.data?.series[0]?.points ?? [];
    return points.map((point) => ({
      label: point.label ?? point.bucket.slice(5, 10),
      value: point.value,
    }));
  }, [workspace.timeseries.data]);

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const channelOptions = [
      ...new Set(customers.flatMap((row) => [...row.channelList])),
    ]
      .sort((a, b) => a.localeCompare(b, 'es-MX'))
      .map((value) => ({
        value,
        label: value,
        count: customers.filter((row) => row.channelList.includes(value)).length,
      }));

    return [
      {
        id: 'segment',
        label: 'Segmento',
        multiple: true,
        options: segments.map((segment) => ({
          value: segment.id,
          label: segment.label,
          count: segment.count,
        })),
      },
      {
        id: 'channel',
        label: 'Canal',
        multiple: true,
        options: channelOptions,
      },
    ];
  }, [customers, segments]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    const segmentFilter = url.segments;
    const channelFilter = url.channels;
    return customers.filter((row) => {
      if (segmentFilter.length && !segmentFilter.includes(row.segment)) return false;
      if (
        channelFilter.length &&
        !channelFilter.some((channel) => row.channelList.includes(channel))
      ) {
        return false;
      }
      if (!needle) return true;
      return `${row.name} ${row.email} ${row.topEvent} ${SEGMENT_LABEL[row.segment]} ${formatRfm(row.rfm)}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [customers, deferredQuery, url.channels, url.segments]);

  const selected = useMemo(
    () =>
      url.selectedId
        ? (customers.find((row) => row.id === url.selectedId) ?? null)
        : null,
    [customers, url.selectedId],
  );

  const columns = useMemo<DataTableColumn<CrmCustomerRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Cliente',
        width: 210,
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
        width: 120,
        sortValue: (row) => row.segment,
        render: (row) => (
          <Badge tone={SEGMENT_TONE[row.segment]} variant="soft" size="sm" dot>
            {SEGMENT_LABEL[row.segment]}
          </Badge>
        ),
      },
      {
        key: 'rfmScore',
        header: 'RFM',
        width: 110,
        sortValue: (row) => row.rfmScore,
        render: (row) => (
          <span className={styles.rfmCell} title={`Score ${formatNumber(row.rfmScore, 1)}`}>
            {formatRfm(row.rfm)}
          </span>
        ),
      },
      {
        key: 'completedOrders',
        header: 'Pedidos',
        width: 90,
        align: 'right',
        sortValue: (row) => row.completedOrders,
        render: (row) => formatNumber(row.completedOrders),
      },
      {
        key: 'totalSpend',
        header: 'LTV',
        width: 120,
        align: 'right',
        sortValue: (row) => row.totalSpend,
        render: (row) => formatMoney(row.totalSpend, row.currency),
      },
      {
        key: 'churnRisk',
        header: 'Churn',
        width: 110,
        sortValue: (row) => row.churnRisk,
        render: (row) => (
          <Badge tone={CHURN_TONE[row.churnBand]} variant="soft" size="sm">
            {CHURN_LABEL[row.churnBand]} · {formatChurnPct(row.churnRisk)}
          </Badge>
        ),
      },
      {
        key: 'lastOrderAt',
        header: 'Última compra',
        width: 130,
        sortValue: (row) => row.lastOrderAt ?? '',
        render: (row) => formatRelativeDay(row.lastOrderAt),
      },
      {
        key: 'topEvent',
        header: 'Evento top',
        width: 160,
        sortValue: (row) => row.topEvent,
      },
    ],
    [],
  );

  const loading = workspace.orders.isPending;
  const metricsLoading =
    workspace.ordersMetrics.isPending || workspace.executive.isPending;
  const hasActiveFilters =
    Boolean(url.q) || url.segments.length > 0 || url.channels.length > 0;

  const waitlistMetricTotal =
    workspace.waitlistMetrics.data?.summary.pending ?? null;

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
        title="CRM enterprise"
        description="Cartera, segmentos RFM/LTV, frecuentes, churn y recomendaciones a partir de pedidos reales y señales auxiliares. Sin inventar métricas."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'CRM' },
        ]}
        actions={
          <div className={styles.actions}>
            <SegmentedControl<CrmRangeKey>
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
              disabled={workspace.orders.isFetching}
              onClick={() => workspace.refetchAll()}
            >
              Actualizar
            </Button>
          </div>
        }
      />

      <div className={styles.kpiGrid} role="region" aria-label="Indicadores CRM">
        <KpiCard
          label="Clientes"
          value={loading ? '—' : formatNumber(kpis.customers)}
          hint={`${formatNumber(kpis.active)} activos · ${rangeLabel(url.range)}`}
          loading={loading}
          tone="accent"
        />
        <KpiCard
          label="LTV promedio"
          value={loading ? '—' : formatCurrency(kpis.avgLtv)}
          unit="MXN"
          hint={`Gasto muestra ${formatCompact(kpis.spend)} MXN`}
          loading={loading}
          tone="success"
        />
        <KpiCard
          label="Recurrencia"
          value={loading ? '—' : formatShare(kpis.retention)}
          hint="Clientes con 2+ pedidos pagados"
          loading={loading}
          tone="info"
        />
        <KpiCard
          label="Frecuentes"
          value={loading ? '—' : formatNumber(kpis.frequent)}
          hint="3+ pedidos completados"
          loading={loading}
          tone="accent"
        />
        <KpiCard
          label="Churn alto"
          value={loading ? '—' : formatNumber(kpis.churnHigh)}
          hint="Heurística por recencia"
          loading={loading}
          tone="warning"
        />
        <KpiCard
          label="Pedidos completados"
          value={
            metricsLoading
              ? '—'
              : formatNumber(
                  workspace.ordersMetrics.data?.kpis.completedOrders.value ?? 0,
                )
          }
          delta={kpiDeltaRatio(
            workspace.ordersMetrics.data?.kpis.completedOrders.deltaPercent,
          )}
          deltaLabel="vs. periodo previo"
          hint={rangeLabel(url.range)}
          loading={metricsLoading}
          tone="info"
        />
      </div>

      {workspace.orders.error ? (
        <QueryError
          error={workspace.orders.error}
          onRetry={() => void workspace.orders.refetch()}
        />
      ) : loading && customers.length === 0 ? (
        <CrmSkeleton />
      ) : (
        <>
          <FrequentAndChurnLists
            frequent={frequent}
            churn={churnList}
            onSelect={(id) =>
              url.setSelectedId(id === url.selectedId ? null : id)
            }
          />

          <div className={styles.layout}>
            <div className={styles.mainCol}>
              <Card padding="md">
                <CardHeader
                  title="Segmentos de cartera"
                  description="Clasificación operativa a partir del historial de compra"
                />
                {customers.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="inbox"
                    title="Sin clientes todavía"
                    description="Cuando existan pedidos aparecerán segmentos VIP, recurrentes y en riesgo."
                    action={
                      <Link href="/orders">
                        <Button type="button" size="sm">
                          Ver órdenes
                        </Button>
                      </Link>
                    }
                    secondaryAction={
                      <Link href="/events/new">
                        <Button type="button" variant="ghost" size="sm">
                          Crear evento
                        </Button>
                      </Link>
                    }
                  />
                ) : (
                  <SegmentCards
                    segments={segments}
                    active={url.segments}
                    onToggle={url.toggleSegment}
                    loading={loading}
                  />
                )}
              </Card>

              <div className={styles.toolbar}>
                <FilterBar
                  filters={filterDefs}
                  value={url.filterSelection}
                  onChange={url.setFilterSelection}
                  search={{
                    value: url.q,
                    onChange: url.setSearch,
                    placeholder: 'Buscar cliente, correo, RFM o evento…',
                  }}
                />
                <div className={styles.filterMeta} role="status">
                  <span>
                    {formatNumber(filtered.length)} de{' '}
                    {formatNumber(customers.length)} clientes
                  </span>
                  {hasActiveFilters ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={url.clearFilters}
                    >
                      Limpiar
                    </Button>
                  ) : null}
                </div>
              </div>

              {filtered.length === 0 ? (
                customers.length === 0 ? (
                  <EmptyState
                    illustration="inbox"
                    title="Aún no hay cartera de clientes"
                    description="Los compradores se construyen a partir de GET /admin/orders. Crea o importa pedidos para activar el CRM."
                    action={
                      <Link href="/orders">
                        <Button type="button">Ir a órdenes</Button>
                      </Link>
                    }
                    secondaryAction={
                      <Link href="/events/new">
                        <Button type="button" variant="secondary">
                          Publicar evento
                        </Button>
                      </Link>
                    }
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
                        onClick={url.clearFilters}
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
                    url.setSelectedId(
                      row.id === url.selectedId ? null : row.id,
                    )
                  }
                />
              )}
            </div>

            <div className={styles.sideCol}>
              <Card padding="md">
                <CardHeader
                  title="Ritmo de pedidos"
                  description={`Serie diaria · ${rangeLabel(url.range)}`}
                />
                {workspace.timeseries.isPending ? (
                  <EmptyState
                    size="sm"
                    title="Cargando serie…"
                    description="Consultando /metrics/timeseries"
                  />
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
                    height={200}
                    series={[{ id: 'orders', name: 'Pedidos', data: seriesData }]}
                    formatValue={(value) => formatNumber(value)}
                  />
                )}
              </Card>

              <RecommendationsCard
                items={recommendations}
                aiAvailable={Boolean(
                  workspace.aiRecommendations.data?.recommendations.length,
                )}
              />

              <DemandSignalsCard
                waitlist={workspace.waitlist.data ?? []}
                waitlistTotal={
                  typeof waitlistMetricTotal === 'number'
                    ? waitlistMetricTotal
                    : null
                }
                apiKeys={workspace.apiKeys.data ?? []}
                analyticsRevenue={
                  workspace.analytics.data?.metrics?.totalRevenue ?? null
                }
              />

              <ActivityCard
                items={activityItems}
                loading={loading || workspace.audit.isPending}
              />

              <LimitsNote />
            </div>
          </div>
        </>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => url.setSelectedId(null)}
        title={selected?.name}
        description={selected?.email}
        size="md"
        footer={
          <Button
            type="button"
            variant="secondary"
            onClick={() => url.setSelectedId(null)}
          >
            Cerrar
          </Button>
        }
      >
        {selected ? (
          <CustomerDrawerBody
            customer={selected}
            onClose={() => url.setSelectedId(null)}
          />
        ) : null}
      </Drawer>
    </main>
  );
}

export default function CrmPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <CrmSkeleton />
        </main>
      }
    >
      <CrmCockpit />
    </Suspense>
  );
}
