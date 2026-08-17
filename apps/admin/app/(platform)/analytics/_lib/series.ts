import type {
  MetricsBreakdown,
  MetricsDimensionRow,
  MetricsFunnel,
  MetricsGranularity,
  MetricsTimeSeries,
} from '@boletera/shared';
import type { ChartSeries } from '@boletera/ui/src/lib/chart';
import type { DonutSlice } from '@boletera/ui/src/components/DonutChart';
import type { FunnelStage } from '@boletera/ui/src/components/FunnelChart';
import { vizColor } from '@boletera/ui/src/styles/tokens';
import { formatBucket } from './format';

/**
 * Convierte claves técnicas del backend (`BOX_OFFICE`, `credit_card`) en texto
 * legible sin inventar un diccionario que pueda desincronizarse del enum.
 */
export function humanizeKey(key: string): string {
  const clean = key.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!clean) return '—';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function rowLabel(row: { key: string; label: string }): string {
  return row.label && row.label !== row.key ? row.label : humanizeKey(row.key);
}

/** Serie temporal del contrato → serie cartesiana del design system. */
export function timeSeriesToChart(
  series: MetricsTimeSeries,
  options: { name?: string; color?: string; granularity?: MetricsGranularity } = {},
): ChartSeries {
  const granularity = options.granularity ?? series.granularity;
  return {
    id: series.key,
    name: options.name ?? series.label,
    color: options.color,
    data: series.points.map((point) => ({
      label: point.label ?? formatBucket(point.bucket, granularity),
      value: point.value,
    })),
  };
}

/**
 * Superpone el periodo comparado sobre el actual. Los buckets se alinean por
 * posición —no por fecha— porque los dos rangos caen en días distintos; las
 * etiquetas del eje siempre son las del periodo actual.
 */
export function comparisonToChart(
  current: MetricsTimeSeries,
  previous: MetricsTimeSeries,
  name: string,
  color: string,
): ChartSeries {
  const granularity = current.granularity;
  return {
    id: `${previous.key}-comparison`,
    name,
    color,
    data: current.points.map((point, index) => ({
      label: point.label ?? formatBucket(point.bucket, granularity),
      value: previous.points[index]?.value ?? 0,
    })),
  };
}

/** Valores crudos para la sparkline embebida en un KPI. */
export function sparklineValues(series: MetricsTimeSeries | undefined): number[] {
  return series ? series.points.map((point) => point.value) : [];
}

interface BreakdownOptions {
  /** Filas visibles antes de agrupar el resto en "Otros". Por defecto 6. */
  limit?: number;
}

function collapseRows(
  rows: readonly MetricsDimensionRow[],
  limit: number,
): Array<{ key: string; label: string; value: number }> {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) {
    return sorted.map((row) => ({ key: row.key, label: rowLabel(row), value: row.value }));
  }
  const head = sorted.slice(0, limit - 1);
  const tail = sorted.slice(limit - 1);
  return [
    ...head.map((row) => ({ key: row.key, label: rowLabel(row), value: row.value })),
    {
      key: '__others__',
      label: `Otros (${tail.length})`,
      value: tail.reduce((total, row) => total + row.value, 0),
    },
  ];
}

/** Composición de una dimensión → porciones de dona. */
export function breakdownToSlices(
  breakdown: MetricsBreakdown,
  { limit = 6 }: BreakdownOptions = {},
): DonutSlice[] {
  return collapseRows(breakdown.rows, limit).map((row, index) => ({
    id: row.key,
    label: row.label,
    value: row.value,
    color: vizColor(index),
  }));
}

/** Comparación de magnitudes de una dimensión → serie de barras. */
export function breakdownToSeries(
  breakdown: MetricsBreakdown,
  name: string,
  { limit = 8 }: BreakdownOptions = {},
): ChartSeries[] {
  const rows = collapseRows(breakdown.rows, limit);
  if (rows.length === 0) return [];
  return [
    {
      id: breakdown.dimension,
      name,
      data: rows.map((row) => ({ label: row.label, value: row.value })),
    },
  ];
}

/** Filas de dimensión sueltas (sin envoltorio `MetricsBreakdown`). */
export function rowsToSeries(
  rows: readonly MetricsDimensionRow[],
  id: string,
  name: string,
  { limit = 8 }: BreakdownOptions = {},
): ChartSeries[] {
  const collapsed = collapseRows(rows, limit);
  if (collapsed.length === 0) return [];
  return [
    {
      id,
      name,
      data: collapsed.map((row) => ({ label: row.label, value: row.value })),
    },
  ];
}

/** Embudo del contrato → etapas del `FunnelChart`. */
export function funnelToStages(funnel: MetricsFunnel): FunnelStage[] {
  return funnel.stages.map((stage, index) => ({
    id: stage.key,
    label: stage.label,
    value: stage.count,
    color: vizColor(index),
  }));
}

/** Caída de conversión entre dos etapas contiguas, en puntos porcentuales. */
export interface FunnelDrop {
  label: string;
  previousLabel: string;
  /** Porcentaje de la etapa previa que llega a esta etapa (0–100). */
  retainedPercent: number;
}

/** Etapa con la mayor caída de conversión: la lectura accionable del embudo. */
export function largestFunnelDrop(funnel: MetricsFunnel): FunnelDrop | null {
  let worst: FunnelDrop | null = null;
  for (let index = 1; index < funnel.stages.length; index += 1) {
    const stage = funnel.stages[index];
    const previous = funnel.stages[index - 1];
    if (!stage || !previous || stage.conversionFromPrevious === null) continue;
    if (worst === null || stage.conversionFromPrevious < worst.retainedPercent) {
      worst = {
        label: stage.label,
        previousLabel: previous.label,
        retainedPercent: stage.conversionFromPrevious,
      };
    }
  }
  return worst;
}

/** Suma total de una lista de filas de dimensión. */
export function sumRows(rows: readonly MetricsDimensionRow[]): number {
  return rows.reduce((total, row) => total + row.value, 0);
}
