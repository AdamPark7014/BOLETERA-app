import type { AiConfidenceInterval, MetricsDateRange } from '@boletera/shared';
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from '@boletera/ui';
import type { AiImpactMetric } from './labels';

export function formatMxn(value: number): string {
  return formatCurrency(value, 0);
}

export function formatCount(value: number, digits = 0): string {
  return formatNumber(value, digits);
}

export function formatPercentPoints(value: number, digits = 1): string {
  return formatPercent(value / 100, digits);
}

export function formatRatio(value: number, digits = 1): string {
  return formatPercent(value, digits);
}

export function formatGeneratedAt(iso: string | undefined): string {
  if (!iso) return 'Sin generación registrada';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateTime(date);
}

export function formatMetricsRange(range: MetricsDateRange): string {
  return `${formatDateTime(range.from)} → ${formatDateTime(range.to)}`;
}

export function formatInterval(
  interval: AiConfidenceInterval,
  kind: 'count' | 'percent' | 'mxn',
): string {
  const format =
    kind === 'mxn'
      ? formatMxn
      : kind === 'percent'
        ? (v: number) => formatPercentPoints(v)
        : (v: number) => formatCount(v);
  return `${format(interval.point)} (${format(interval.lower)} – ${format(interval.upper)})`;
}

export function formatImpactValue(metric: AiImpactMetric, value: number): string {
  switch (metric) {
    case 'tickets':
      return formatCount(value);
    case 'revenue_mxn':
      return formatMxn(value);
    case 'occupancy_pp':
      return `${formatCount(value, 1)} pp`;
    case 'risk_reduction':
      return formatCount(value, 1);
  }
}
