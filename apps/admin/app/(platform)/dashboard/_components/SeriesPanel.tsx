'use client';

import Link from 'next/link';
import { Badge, SegmentedControl, TrendPill, type ChartDatum } from '@boletera/ui';
import { RevenueChart } from '../RevenueChart';
import { formatCountCompact, formatMxnCompact, toDeltaRatio } from '../format';
import {
  METRIC_META,
  METRIC_SEGMENTS,
  metricFormatter,
  type DashboardMetric,
  type SeriesStats,
} from '../_lib/derive';
import type { DashboardRange } from '../range';
import { Panel, PanelError } from './Panel';
import styles from '../dashboard.module.scss';

type SeriesPanelProps = {
  range: DashboardRange;
  metric: DashboardMetric;
  onMetricChange: (metric: DashboardMetric) => void;
  current: readonly ChartDatum[];
  previous: readonly ChartDatum[];
  stats: SeriesStats;
  comparisonStats: SeriesStats;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

export function SeriesPanel({
  range,
  metric,
  onMetricChange,
  current,
  previous,
  stats,
  comparisonStats,
  loading,
  error,
  onRetry,
}: SeriesPanelProps) {
  const meta = METRIC_META[metric];
  const formatValue = metricFormatter(metric);
  const formatAxis = meta.unit === 'mxn' ? formatMxnCompact : formatCountCompact;
  const periodDelta =
    comparisonStats.total > 0
      ? (stats.total - comparisonStats.total) / comparisonStats.total
      : toDeltaRatio(null);

  return (
    <Panel
      headingId="series-heading"
      title={`${meta.label} en el tiempo`}
      description={`${range.label} · granularidad ${range.granularityLabel}`}
      actions={
        <div className={styles.seriesActions}>
          <SegmentedControl
            label="Métrica de la serie"
            size="sm"
            options={METRIC_SEGMENTS}
            value={metric}
            onValueChange={onMetricChange}
          />
          {!loading && current.length > 1 ? (
            <Badge tone="accent" variant="soft" size="sm">
              {formatValue(stats.total)} acumulado
            </Badge>
          ) : null}
        </div>
      }
      footer={
        !loading && current.length > 1 ? (
          <dl className={styles.seriesStats}>
            <div>
              <dt>Promedio</dt>
              <dd>{formatValue(stats.average)}</dd>
            </div>
            <div>
              <dt>Pico</dt>
              <dd>
                {formatValue(stats.peak)}
                {stats.peakLabel ? <span> · {stats.peakLabel}</span> : null}
              </dd>
            </div>
            <div>
              <dt>{range.comparisonShortLabel}</dt>
              <dd className={styles.seriesDelta}>
                {formatValue(comparisonStats.total)}
                {periodDelta !== undefined ? (
                  <TrendPill value={periodDelta} comparison={range.comparisonLabel} size="sm" />
                ) : null}
              </dd>
            </div>
          </dl>
        ) : null
      }
    >
      {error && current.length === 0 ? (
        <PanelError
          error={error}
          title="No se pudo cargar la serie temporal"
          onRetry={onRetry}
        />
      ) : (
        <RevenueChart
          current={current}
          previous={previous.length > 1 ? previous : undefined}
          seriesName={meta.label}
          previousLabel={range.comparisonShortLabel}
          formatValue={formatValue}
          formatAxis={formatAxis}
          loading={loading && current.length === 0}
          emptyLabel={`Aún no hay ${meta.noun} en este rango`}
          emptyDescription="Cuando haya ventas, aquí verás la evolución del periodo frente a la ventana anterior."
          emptyAction={
            <Link href="/events/new" className={styles.primaryLink}>
              Crear evento
            </Link>
          }
        />
      )}
    </Panel>
  );
}
