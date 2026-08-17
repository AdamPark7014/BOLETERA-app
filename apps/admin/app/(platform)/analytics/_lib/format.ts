import type { MetricsGranularity, MetricsKpi } from '@boletera/shared';
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '@boletera/ui/src/lib/format';

/** Unidades declaradas por los contratos de métricas. */
export type MetricUnit = MetricsKpi['unit'];

/** Importe en pesos, sin centavos: la lectura ejecutiva no los necesita. */
export function formatMoney(value: number): string {
  return formatCurrency(value, 0);
}

/** Importe compacto para ejes y celdas estrechas: "1.3 M". */
export function formatMoneyCompact(value: number): string {
  return `$${formatCompact(value)}`;
}

export function formatCount(value: number): string {
  return formatNumber(value);
}

/** Los contratos entregan porcentajes en puntos (0–100), no en proporción. */
export function formatPercentPoints(value: number, fractionDigits = 1): string {
  return formatPercent(value / 100, fractionDigits);
}

/** Proporción 0–1, como `actualPace` o `expectedPace`. */
export function formatRatio(value: number, fractionDigits = 1): string {
  return formatPercent(value, fractionDigits);
}

/** Formatea un valor según la unidad declarada por el contrato. */
export function formatUnitValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'mxn':
      return formatMoney(value);
    case 'percent':
      return formatPercentPoints(value);
    case 'ratio':
      return formatRatio(value);
    default:
      return formatCount(value);
  }
}

/** Formateador de valores para pasar a los charts del design system. */
export function unitFormatter(unit: MetricUnit): (value: number) => string {
  return (value) => formatUnitValue(value, unit);
}

/** Formateador de eje: compacto para que las etiquetas no se encimen. */
export function unitAxisFormatter(unit: MetricUnit): (value: number) => string {
  if (unit === 'mxn') return formatMoneyCompact;
  if (unit === 'percent') return (value) => `${formatNumber(value)} %`;
  if (unit === 'ratio') return (value) => formatPercent(value, 0);
  return formatCompact;
}

const bucketFormatters: Record<MetricsGranularity, Intl.DateTimeFormat> = {
  hour: new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
  day: new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }),
  week: new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }),
  month: new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit' }),
};

/** Etiqueta del eje temporal acorde a la granularidad del bucket. */
export function formatBucket(iso: string, granularity: MetricsGranularity): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const label = bucketFormatters[granularity].format(date);
  return granularity === 'week' ? `sem. ${label}` : label;
}

const dateTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Momento de generación del agregado, para dar confianza en la frescura. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

/**
 * Variación relativa lista para `TrendPill` / `KpiCard`, que esperan una
 * proporción (0.082 = +8.2 %). `deltaPercent` es `null` cuando no hay base
 * comparable, en cuyo caso no debe pintarse ninguna tendencia.
 */
export function kpiTrend(kpi: MetricsKpi): number | undefined {
  return kpi.deltaPercent === null ? undefined : kpi.deltaPercent / 100;
}

/** Valor principal del KPI ya formateado según su unidad. */
export function formatKpi(kpi: MetricsKpi): string {
  return formatUnitValue(kpi.value, kpi.unit);
}

/** Texto de apoyo con el valor del periodo comparado. */
export function kpiHint(kpi: MetricsKpi, comparisonLabel: string): string {
  return `${comparisonLabel}: ${formatUnitValue(kpi.previousValue, kpi.unit)}`;
}
