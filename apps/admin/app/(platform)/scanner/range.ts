import type { MetricsGranularity } from '@boletera/shared';
import type { RangeKey } from './types';

export type ScannerRange = {
  key: RangeKey;
  label: string;
  from: string;
  to: string;
  granularity: MetricsGranularity;
};

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Hoy',
  h24: '24 h',
  d7: '7 días',
};

/** Medianoche en America/Mexico_City como instante UTC. */
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
  return new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
}

export function buildScannerRange(key: RangeKey, now = new Date()): ScannerRange {
  const to = now;
  let from: Date;
  if (key === 'today') {
    from = startOfMexicoDay(now);
  } else if (key === 'h24') {
    from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const granularity: MetricsGranularity = key === 'd7' ? 'day' : 'hour';

  return {
    key,
    label: RANGE_LABELS[key],
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
  };
}

export const RANGE_OPTIONS: readonly { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'h24', label: '24 h' },
  { value: 'd7', label: '7 días' },
];
