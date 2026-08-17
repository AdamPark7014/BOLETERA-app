'use client';

import { useMemo } from 'react';
import type {
  ExecutiveSummaryMetrics,
  MetricsGranularity,
  MetricsTimeSeriesResponse,
} from '@boletera/shared';
import { AreaChart } from '@boletera/ui/src/components/AreaChart';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DonutChart } from '@boletera/ui/src/components/DonutChart';
import { LineChart } from '@boletera/ui/src/components/LineChart';
import { ProgressRing } from '@boletera/ui/src/components/ProgressRing';
import { vizColor } from '@boletera/ui/src/styles/tokens';
import type { MetricsTimeseriesMetric } from '@/lib/queries/metrics';
import {
  formatCount,
  formatMoney,
  formatTimestamp,
  unitAxisFormatter,
  unitFormatter,
} from '../_lib/format';
import {
  breakdownToSlices,
  comparisonToChart,
  sparklineValues,
  timeSeriesToChart,
} from '../_lib/series';
import styles from '../analytics.module.scss';
import { KpiStrip } from './KpiStrip';
import { PanelState, PanelSkeleton } from './PanelState';

const METRIC_UNIT: Record<MetricsTimeseriesMetric, 'mxn' | 'count'> = {
  revenue: 'mxn',
  orders: 'count',
  tickets: 'count',
  refunds: 'mxn',
  checkins: 'count',
};

const METRIC_LABEL: Record<MetricsTimeseriesMetric, string> = {
  revenue: 'Ingresos',
  orders: 'Órdenes',
  tickets: 'Boletos',
  refunds: 'Reembolsos',
  checkins: 'Check-ins',
};

export function OverviewSection({
  executive,
  executivePending,
  executiveError,
  onRetryExecutive,
  timeseries,
  timeseriesPending,
  timeseriesError,
  onRetryTimeseries,
  comparisonTimeseries,
  metric,
  granularity,
  comparisonLabel,
  showComparison,
}: {
  executive: ExecutiveSummaryMetrics | undefined;
  executivePending: boolean;
  executiveError: unknown;
  onRetryExecutive: () => void;
  timeseries: MetricsTimeSeriesResponse | undefined;
  timeseriesPending: boolean;
  timeseriesError: unknown;
  onRetryTimeseries: () => void;
  comparisonTimeseries: MetricsTimeSeriesResponse | undefined;
  metric: MetricsTimeseriesMetric;
  granularity: MetricsGranularity;
  comparisonLabel: string;
  showComparison: boolean;
}) {
  const revenueSpark = useMemo(
    () => sparklineValues(executive?.series.find((series) => series.key === 'revenue')),
    [executive],
  );

  const channelSlices = useMemo(
    () => (executive ? breakdownToSlices(executive.revenueByChannel) : []),
    [executive],
  );

  const chartSeries = useMemo(() => {
    const primary = timeseries?.series[0];
    if (!primary) return [];
    const current = timeSeriesToChart(primary, {
      name: METRIC_LABEL[metric],
      color: vizColor(0),
      granularity,
    });
    if (!showComparison || !comparisonTimeseries?.series[0]) return [current];
    return [
      current,
      comparisonToChart(
        primary,
        comparisonTimeseries.series[0],
        comparisonLabel,
        vizColor(1),
      ),
    ];
  }, [
    timeseries,
    comparisonTimeseries,
    metric,
    granularity,
    comparisonLabel,
    showComparison,
  ]);

  const unit = METRIC_UNIT[metric];
  const Chart = metric === 'revenue' || metric === 'tickets' ? AreaChart : LineChart;

  return (
    <>
      <KpiStrip
        loading={executivePending && !executive}
        comparisonLabel={comparisonLabel}
        items={
          executive
            ? [
                {
                  kpi: executive.kpis.grossRevenue,
                  tone: 'accent',
                  trend: revenueSpark,
                },
                { kpi: executive.kpis.netRevenue, tone: 'success' },
                { kpi: executive.kpis.ticketsSold, tone: 'info' },
                { kpi: executive.kpis.averageTicketPrice },
                { kpi: executive.kpis.conversionRate, tone: 'warning' },
                { kpi: executive.kpis.ordersCompleted },
              ]
            : []
        }
      />

      <div className={styles.grid}>
        <Card className={`${styles.panel} ${styles.span8}`} padding="md" variant="outline">
          <CardHeader
            title={`Tendencia de ${METRIC_LABEL[metric].toLowerCase()}`}
            description={`Serie ${granularity === 'hour' ? 'horaria' : granularity === 'day' ? 'diaria' : granularity === 'week' ? 'semanal' : 'mensual'} del periodo seleccionado.`}
            as="h2"
          />
          <PanelState
            data={timeseries}
            isPending={timeseriesPending}
            error={timeseriesError}
            onRetry={onRetryTimeseries}
            isEmpty={(value) =>
              value.series.every((series) => series.points.every((point) => point.value === 0)) ||
              value.series.every((series) => series.points.length === 0)
            }
            emptyTitle="Sin puntos en la serie"
            emptyDescription="No hay actividad registrada para esta métrica en el rango. Prueba otro periodo o métrica."
            skeleton={<PanelSkeleton height={220} lines={0} />}
          >
            {() => (
              <Chart
                label={`Tendencia de ${METRIC_LABEL[metric]}`}
                series={chartSeries}
                height={240}
                formatValue={unitFormatter(unit)}
                formatAxis={unitAxisFormatter(unit)}
                smooth
              />
            )}
          </PanelState>
        </Card>

        <Card className={`${styles.panel} ${styles.span4}`} padding="md" variant="outline">
          <CardHeader
            title="Ingresos por canal"
            description="Composición del ingreso bruto del periodo."
            as="h2"
          />
          <PanelState
            data={executive}
            isPending={executivePending}
            error={executiveError}
            onRetry={onRetryExecutive}
            isEmpty={(value) => value.revenueByChannel.rows.length === 0}
            emptyTitle="Sin ventas por canal"
            emptyDescription="Cuando se completen órdenes aparecerán aquí web, taquilla y demás canales."
            skeleton={<PanelSkeleton height={220} lines={2} />}
          >
            {(value) => (
              <>
                <DonutChart
                  label="Ingresos por canal"
                  slices={channelSlices}
                  center={formatMoney(value.revenueByChannel.total)}
                  centerLabel="Total"
                  formatValue={formatMoney}
                  height={220}
                />
                <p className={styles.panelFootnote}>
                  Actualizado {formatTimestamp(value.generatedAt)} · {value.timezone}
                </p>
              </>
            )}
          </PanelState>
        </Card>

        <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
          <CardHeader
            title="Proyección al cierre"
            description="Extrapolación lineal del ritmo actual hasta el final del periodo."
            as="h2"
          />
          <PanelState
            data={executive}
            isPending={executivePending}
            error={executiveError}
            onRetry={onRetryExecutive}
            isEmpty={() => false}
            emptyTitle="Sin proyección"
            emptyDescription="No hay datos suficientes para proyectar el cierre."
            skeleton={<PanelSkeleton height={96} lines={1} />}
          >
            {(value) => {
              const progress =
                value.projection.daysInPeriod > 0
                  ? (value.projection.daysElapsed / value.projection.daysInPeriod) * 100
                  : 0;
              return (
                <div className={styles.statList}>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Ingreso proyectado</span>
                    <strong className={styles.statValue}>
                      {formatMoney(value.projection.projectedGrossRevenue)}
                    </strong>
                    <span className={styles.statHint}>
                      Actual: {formatMoney(value.kpis.grossRevenue.value)}
                    </span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Boletos proyectados</span>
                    <strong className={styles.statValue}>
                      {formatCount(value.projection.projectedTicketsSold)}
                    </strong>
                    <span className={styles.statHint}>
                      Actual: {formatCount(value.kpis.ticketsSold.value)}
                    </span>
                  </div>
                  <div className={styles.stat} style={{ alignItems: 'center' }}>
                    <ProgressRing
                      label="Avance del periodo"
                      value={progress}
                      max={100}
                      size={72}
                      tone="accent"
                    />
                    <span className={styles.statHint}>
                      {formatCount(value.projection.daysElapsed)} de{' '}
                      {formatCount(value.projection.daysInPeriod)} días
                    </span>
                  </div>
                </div>
              );
            }}
          </PanelState>
        </Card>
      </div>
    </>
  );
}
