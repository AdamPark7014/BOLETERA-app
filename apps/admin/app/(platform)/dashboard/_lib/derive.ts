import type { ChartDatum } from '@boletera/ui';
import type {
  EventSalesPaceRow,
  ExecutiveSummaryMetrics,
  MetricsAlert,
  MetricsAlertSeverity,
  MetricsBreakdown,
  MetricsGranularity,
  MetricsTimePoint,
} from '@boletera/shared';
import type { PlatformOverview } from '@/lib/platform-api';
import { channelLabel, formatBucket, formatCount, formatMxn } from '../format';

/** Métricas que el panel de serie temporal sabe graficar. */
export type DashboardMetric = 'revenue' | 'orders' | 'tickets';

export type MetricMeta = {
  label: string;
  shortLabel: string;
  unit: 'mxn' | 'count';
  /** Nombre del recurso contado, para descripciones y estados vacíos. */
  noun: string;
};

export const METRIC_META: Record<DashboardMetric, MetricMeta> = {
  revenue: { label: 'Ingresos', shortLabel: 'Ingresos', unit: 'mxn', noun: 'ingresos' },
  orders: { label: 'Órdenes', shortLabel: 'Órdenes', unit: 'count', noun: 'órdenes' },
  tickets: { label: 'Boletos', shortLabel: 'Boletos', unit: 'count', noun: 'boletos' },
};

export const METRIC_SEGMENTS: readonly { value: DashboardMetric; label: string }[] = (
  ['revenue', 'orders', 'tickets'] as const
).map((value) => ({ value, label: METRIC_META[value].shortLabel }));

export function metricFormatter(metric: DashboardMetric): (value: number) => string {
  return METRIC_META[metric].unit === 'mxn' ? formatMxn : formatCount;
}

// ---------------------------------------------------------------------------
// Series temporales
// ---------------------------------------------------------------------------

/** Convierte los puntos de la API en datos de chart con etiquetas legibles. */
export function toChartData(
  points: readonly MetricsTimePoint[],
  granularity: MetricsGranularity,
): ChartDatum[] {
  return points.map((point) => ({
    label: point.label ?? formatBucket(point.bucket, granularity),
    value: point.value,
  }));
}

/**
 * Alinea la serie comparativa con la actual por índice de bucket: el eje X
 * pertenece al periodo actual, así que la serie previa reusa sus etiquetas y
 * se rellena con ceros cuando tiene menos puntos.
 */
export function alignComparison(
  current: readonly ChartDatum[],
  previous: readonly MetricsTimePoint[],
): ChartDatum[] {
  if (current.length === 0) return [];
  // La ventana previa puede traer un bucket de más o de menos por el borde.
  const offset = Math.max(0, previous.length - current.length);
  return current.map((datum, index) => ({
    label: datum.label,
    value: previous[index + offset]?.value ?? 0,
  }));
}

export type SeriesStats = {
  total: number;
  average: number;
  peak: number;
  peakLabel: string | null;
};

export function seriesStats(data: readonly ChartDatum[]): SeriesStats {
  if (data.length === 0) return { total: 0, average: 0, peak: 0, peakLabel: null };
  let total = 0;
  let peak = Number.NEGATIVE_INFINITY;
  let peakLabel: string | null = null;
  for (const datum of data) {
    total += datum.value;
    if (datum.value > peak) {
      peak = datum.value;
      peakLabel = datum.label;
    }
  }
  return { total, average: total / data.length, peak, peakLabel };
}

/** Serie plana para las sparklines de los KPI. */
export function sparklineValues(points: readonly MetricsTimePoint[]): number[] {
  return points.map((point) => point.value);
}

/**
 * Precio medio por boleto en cada bucket. No existe como endpoint, pero se
 * deriva sin coste extra de las dos series ya descargadas.
 */
export function derivedAverageTicket(
  revenue: readonly MetricsTimePoint[],
  tickets: readonly MetricsTimePoint[],
): number[] {
  return revenue.map((point, index) => {
    const sold = tickets[index]?.value ?? 0;
    return sold > 0 ? point.value / sold : 0;
  });
}

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

export type ChannelRow = {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  /** Participación en puntos porcentuales (0–100). */
  percent: number;
};

export function channelRows(breakdown: MetricsBreakdown | undefined): ChannelRow[] {
  const rows = breakdown?.rows ?? [];
  const total = breakdown?.total ?? 0;
  return rows
    .map((row) => ({
      key: row.key,
      label: row.label && row.label !== row.key ? row.label : channelLabel(row.key),
      revenue: row.value,
      orders: typeof row.secondaryValue === 'number' ? row.secondaryValue : 0,
      percent:
        row.percentOfTotal ?? (total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Ritmo de venta
// ---------------------------------------------------------------------------

export type PaceSummary = {
  rows: EventSalesPaceRow[];
  atRisk: number;
  onTrack: number;
  total: number;
};

const RISK_WEIGHT: Record<EventSalesPaceRow['riskLevel'], number> = {
  critical: 0,
  at_risk: 1,
  watch: 2,
  on_track: 3,
};

/** Ordena por riesgo y, dentro del mismo nivel, por cercanía del evento. */
export function paceSummary(
  metrics: { events: EventSalesPaceRow[] } | undefined,
  limit: number,
): PaceSummary {
  const events = metrics?.events ?? [];
  const rows = [...events]
    .sort(
      (a, b) =>
        RISK_WEIGHT[a.riskLevel] - RISK_WEIGHT[b.riskLevel] ||
        a.daysUntilEvent - b.daysUntilEvent,
    )
    .slice(0, limit);

  let atRisk = 0;
  let onTrack = 0;
  for (const event of events) {
    if (event.riskLevel === 'critical' || event.riskLevel === 'at_risk') atRisk += 1;
    else if (event.riskLevel === 'on_track') onTrack += 1;
  }

  return { rows, atRisk, onTrack, total: events.length };
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export type AlertFilter = 'all' | MetricsAlertSeverity;

const SEVERITY_WEIGHT: Record<MetricsAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function filterAlerts(
  alerts: readonly MetricsAlert[] | undefined,
  filter: AlertFilter,
  limit: number,
): MetricsAlert[] {
  const list = alerts ?? [];
  return list
    .filter((alert) => filter === 'all' || alert.severity === filter)
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] ||
        Date.parse(b.detectedAt) - Date.parse(a.detectedAt),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Actividad reciente
// ---------------------------------------------------------------------------

export type RecentOrder = NonNullable<PlatformOverview['recentOrders']>[number];

export function recentOrders(
  overview: PlatformOverview | undefined,
  limit: number,
): RecentOrder[] {
  return (overview?.recentOrders ?? []).slice(0, limit);
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export type KpiKey = keyof ExecutiveSummaryMetrics['kpis'];

/** Orden de lectura del tablero: dinero primero, eficiencia después. */
export const KPI_ORDER: readonly KpiKey[] = [
  'grossRevenue',
  'netRevenue',
  'ordersCompleted',
  'ticketsSold',
  'averageTicketPrice',
  'conversionRate',
];
