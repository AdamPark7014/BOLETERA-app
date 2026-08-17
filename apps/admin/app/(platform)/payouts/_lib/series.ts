import type { MetricsTimeSeriesResponse } from '@boletera/shared';
import type { ChartSeries } from '@boletera/ui';
import { formatBucketLabel } from './period';

/**
 * `/metrics/timeseries` devuelve importes en unidades MXN; los charts se
 * alimentan con esas unidades y el formateo a centavos ocurre al pintar.
 */
export function toChartSeries(
  response: MetricsTimeSeriesResponse | undefined,
  options: { id: string; name: string; color?: string },
): ChartSeries | null {
  const series = response?.series[0];
  if (!series || series.points.length === 0) return null;
  return {
    id: options.id,
    name: options.name,
    ...(options.color ? { color: options.color } : {}),
    data: series.points.map((point) => ({
      label: formatBucketLabel(point.bucket, series.granularity),
      value: point.value,
    })),
  };
}

/** Alinea varias series por etiqueta para que compartan el eje X del chart. */
export function alignSeries(series: readonly (ChartSeries | null)[]): ChartSeries[] {
  const present = series.filter((entry): entry is ChartSeries => entry !== null);
  if (present.length < 2) return present;

  const labels: string[] = [];
  for (const entry of present) {
    for (const datum of entry.data) {
      if (!labels.includes(datum.label)) labels.push(datum.label);
    }
  }

  return present.map((entry) => {
    const byLabel = new Map(entry.data.map((datum) => [datum.label, datum.value]));
    return {
      ...entry,
      data: labels.map((label) => ({ label, value: byLabel.get(label) ?? 0 })),
    };
  });
}
