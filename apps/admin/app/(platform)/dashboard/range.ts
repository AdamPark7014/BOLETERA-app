import type { MetricsGranularity } from '@boletera/shared';

export type DashboardRangeKey = 'today' | '7d' | '30d' | '90d';

export type DashboardRange = {
  key: DashboardRangeKey;
  /** Nombre largo del rango: "Últimos 7 días". */
  label: string;
  /** Etiqueta compacta para el selector segmentado. */
  shortLabel: string;
  from: string;
  to: string;
  /** Ventana equivalente inmediatamente anterior, para comparaciones. */
  previousFrom: string;
  previousTo: string;
  granularity: MetricsGranularity;
  granularityLabel: string;
  /** Texto que acompaña a los deltas: "vs. 7 días previos". */
  comparisonLabel: string;
  /** Versión corta para leyendas de gráfico: "Periodo previo". */
  comparisonShortLabel: string;
};

type RangeMeta = {
  label: string;
  shortLabel: string;
  days: number;
  granularity: MetricsGranularity;
  comparisonLabel: string;
};

const RANGE_META: Record<DashboardRangeKey, RangeMeta> = {
  today: {
    label: 'Hoy',
    shortLabel: 'Hoy',
    days: 0,
    granularity: 'hour',
    comparisonLabel: 'vs. ayer',
  },
  '7d': {
    label: 'Últimos 7 días',
    shortLabel: '7 d',
    days: 7,
    granularity: 'day',
    comparisonLabel: 'vs. 7 días previos',
  },
  '30d': {
    label: 'Últimos 30 días',
    shortLabel: '30 d',
    days: 30,
    granularity: 'day',
    comparisonLabel: 'vs. 30 días previos',
  },
  '90d': {
    label: 'Últimos 90 días',
    shortLabel: '90 d',
    days: 90,
    granularity: 'week',
    comparisonLabel: 'vs. 90 días previos',
  },
};

const GRANULARITY_LABEL: Record<MetricsGranularity, string> = {
  hour: 'horaria',
  day: 'diaria',
  week: 'semanal',
  month: 'mensual',
};

export const RANGE_OPTIONS: readonly DashboardRangeKey[] = ['today', '7d', '30d', '90d'];

/** Opciones listas para `<SegmentedControl>`. */
export const RANGE_SEGMENTS: readonly { value: DashboardRangeKey; label: string }[] =
  RANGE_OPTIONS.map((key) => ({ value: key, label: RANGE_META[key].shortLabel }));

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inicio del día natural en America/Mexico_City, devuelto como instante UTC. */
function startOfMexicoDay(ref: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ref);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  // Ciudad de México es UTC-6 (CST) la mayor parte del año: medianoche ≈ 06:00 UTC.
  return new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
}

/**
 * Trunca al minuto para que la clave de caché de TanStack Query sea estable
 * entre renders y remontajes dentro del mismo minuto.
 */
function truncateToMinute(ref: Date): Date {
  return new Date(Math.floor(ref.getTime() / 60_000) * 60_000);
}

export function buildDashboardRange(key: DashboardRangeKey, now = new Date()): DashboardRange {
  const meta = RANGE_META[key];
  const to = truncateToMinute(now);
  const from = key === 'today' ? startOfMexicoDay(to) : new Date(to.getTime() - meta.days * DAY_MS);
  const window = to.getTime() - from.getTime();
  const previousTo = from;
  const previousFrom = new Date(from.getTime() - window);

  return {
    key,
    label: meta.label,
    shortLabel: meta.shortLabel,
    from: from.toISOString(),
    to: to.toISOString(),
    previousFrom: previousFrom.toISOString(),
    previousTo: previousTo.toISOString(),
    granularity: meta.granularity,
    granularityLabel: GRANULARITY_LABEL[meta.granularity],
    comparisonLabel: meta.comparisonLabel,
    comparisonShortLabel: key === 'today' ? 'Ayer' : 'Periodo previo',
  };
}
