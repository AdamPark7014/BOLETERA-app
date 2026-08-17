import type { MetricsGranularity } from '@boletera/shared';
import type { MetricsTimeseriesMetric } from '@/lib/queries/metrics';

export type AnalyticsViewId =
  | 'overview'
  | 'sales'
  | 'inventory'
  | 'orders'
  | 'access'
  | 'funnels'
  | 'risk'
  | 'settlements';

export const ANALYTICS_VIEWS: readonly { id: AnalyticsViewId; label: string }[] = [
  { id: 'overview', label: 'Resumen' },
  { id: 'sales', label: 'Ventas' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'orders', label: 'Órdenes' },
  { id: 'access', label: 'Acceso' },
  { id: 'funnels', label: 'Embudos' },
  { id: 'risk', label: 'Riesgo' },
  { id: 'settlements', label: 'Liquidaciones' },
];

/** Opciones tipadas para `<SegmentedControl<AnalyticsViewId>>`. */
export const ANALYTICS_VIEW_SEGMENTS: readonly {
  value: AnalyticsViewId;
  label: string;
}[] = ANALYTICS_VIEWS.map((item) => ({ value: item.id, label: item.label }));

export const METRIC_OPTIONS: readonly {
  id: MetricsTimeseriesMetric;
  label: string;
}[] = [
  { id: 'revenue', label: 'Ingresos' },
  { id: 'orders', label: 'Órdenes' },
  { id: 'tickets', label: 'Boletos' },
  { id: 'refunds', label: 'Reembolsos' },
  { id: 'checkins', label: 'Check-ins' },
];

export const GRANULARITY_OPTIONS: readonly {
  id: MetricsGranularity;
  label: string;
}[] = [
  { id: 'hour', label: 'Hora' },
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
];

const VIEW_IDS = new Set<string>(ANALYTICS_VIEWS.map((view) => view.id));
const METRIC_IDS = new Set<string>(METRIC_OPTIONS.map((option) => option.id));
const GRANULARITY_IDS = new Set<string>(GRANULARITY_OPTIONS.map((option) => option.id));

export function isAnalyticsViewId(value: string): value is AnalyticsViewId {
  return VIEW_IDS.has(value);
}

export function isMetricsTimeseriesMetric(
  value: string,
): value is MetricsTimeseriesMetric {
  return METRIC_IDS.has(value);
}

export function isMetricsGranularity(value: string): value is MetricsGranularity {
  return GRANULARITY_IDS.has(value);
}

export function parseAnalyticsViewId(value: string | null): AnalyticsViewId | null {
  return value !== null && isAnalyticsViewId(value) ? value : null;
}

export function parseMetricsTimeseriesMetric(
  value: string | null,
): MetricsTimeseriesMetric | null {
  return value !== null && isMetricsTimeseriesMetric(value) ? value : null;
}

export function parseMetricsGranularity(
  value: string | null,
): MetricsGranularity | null {
  return value !== null && isMetricsGranularity(value) ? value : null;
}
