import type {
  MetricsBreakdown,
  MetricsDateRange,
  MetricsGranularity,
  MetricsKpi,
  MetricsTimePoint,
  MetricsTimeSeries,
} from '@boletera/shared';

export const METRICS_TIMEZONE = 'America/Mexico_City' as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ParsedRange = {
  from: Date;
  to: Date;
  dateRange: MetricsDateRange;
  comparisonRange: MetricsDateRange;
  comparisonFrom: Date;
  comparisonTo: Date;
  daysInPeriod: number;
  daysElapsed: number;
};

export function parseMetricsRange(from?: string, to?: string, now = new Date()): ParsedRange {
  const toDate = to ? new Date(to) : now;
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * DAY_MS);
  const windowMs = Math.max(toDate.getTime() - fromDate.getTime(), DAY_MS);
  const comparisonTo = fromDate;
  const comparisonFrom = new Date(fromDate.getTime() - windowMs);

  return {
    from: fromDate,
    to: toDate,
    dateRange: { from: fromDate.toISOString(), to: toDate.toISOString() },
    comparisonRange: {
      from: comparisonFrom.toISOString(),
      to: comparisonTo.toISOString(),
    },
    comparisonFrom,
    comparisonTo,
    daysInPeriod: Math.max(1, Math.ceil(windowMs / DAY_MS)),
    daysElapsed: Math.max(1, Math.ceil((now.getTime() - fromDate.getTime()) / DAY_MS)),
  };
}

export function buildKpi(
  key: string,
  label: string,
  value: number,
  previousValue: number,
  unit: MetricsKpi['unit'] = 'count',
): MetricsKpi {
  const delta = value - previousValue;
  const deltaPercent =
    previousValue !== 0 ? Number((((value - previousValue) / previousValue) * 100).toFixed(2)) : null;
  return {
    key,
    label,
    value,
    previousValue,
    delta,
    deltaPercent,
    unit,
    ...(unit === 'mxn' ? { currency: 'MXN' as const } : {}),
  };
}

export function buildBreakdown(
  dimension: string,
  label: string,
  rows: { key: string; label: string; value: number; secondaryValue?: number }[],
): MetricsBreakdown {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    dimension,
    label,
    total,
    rows: rows.map((row) => ({
      ...row,
      percentOfTotal: total > 0 ? Number(((row.value / total) * 100).toFixed(2)) : 0,
    })),
  };
}

function bucketKey(date: Date, granularity: MetricsGranularity): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: METRICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: granularity === 'hour' ? '2-digit' : undefined,
  }).formatToParts(date);

  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  if (granularity === 'hour') {
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    return `${y}-${m}-${d}T${h}:00:00.000Z`;
  }
  if (granularity === 'week') {
    const day = Number(d);
    const weekStart = day - ((new Date(date).getUTCDay() + 6) % 7);
    return `${y}-${m}-${String(Math.max(1, weekStart)).padStart(2, '0')}`;
  }
  if (granularity === 'month') return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

export function aggregateTimeSeries(
  entries: { at: Date; value: number }[],
  granularity: MetricsGranularity,
  key: string,
  label: string,
  unit: MetricsTimeSeries['unit'] = 'count',
): MetricsTimeSeries {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const bucket = bucketKey(entry.at, granularity);
    map.set(bucket, (map.get(bucket) ?? 0) + entry.value);
  }
  const points: MetricsTimePoint[] = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => ({ bucket, value }));
  return { key, label, granularity, unit, points };
}

export function sumOrderRevenue(
  orders: { totalAmount: unknown; items?: { quantity: number }[] }[],
): { revenue: number; tickets: number } {
  let revenue = 0;
  let tickets = 0;
  for (const order of orders) {
    revenue += Number(order.totalAmount);
    tickets += order.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  }
  return { revenue, tickets };
}
