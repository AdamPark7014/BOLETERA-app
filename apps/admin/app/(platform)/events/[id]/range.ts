import type { MetricsGranularity } from '@boletera/shared';

export type HubMetricsRange = {
  from: string;
  to: string;
  granularity: MetricsGranularity;
};

/** Ventana fija de 30 días hasta ahora, alineada a Ciudad de México. */
export function buildHubMetricsRange(now = new Date()): HubMetricsRange {
  const to = now.toISOString();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { from, to, granularity: 'day' };
}
