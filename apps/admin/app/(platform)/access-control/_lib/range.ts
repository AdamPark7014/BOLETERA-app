import type { MetricsGranularity } from '@boletera/shared';

export type AccessRangeKey = 'today' | '7d' | '30d';

export type AccessRange = {
  key: AccessRangeKey;
  label: string;
  from: string;
  to: string;
  granularity: MetricsGranularity;
};

const META: Record<
  AccessRangeKey,
  { label: string; hours?: number; days?: number; granularity: MetricsGranularity }
> = {
  today: { label: 'Hoy', hours: 24, granularity: 'hour' },
  '7d': { label: '7 días', days: 7, granularity: 'day' },
  '30d': { label: '30 días', days: 30, granularity: 'day' },
};

export const ACCESS_RANGE_OPTIONS: readonly AccessRangeKey[] = ['today', '7d', '30d'];

export function buildAccessRange(key: AccessRangeKey, now = new Date()): AccessRange {
  const meta = META[key];
  const ms =
    meta.hours != null
      ? meta.hours * 60 * 60 * 1000
      : (meta.days ?? 7) * 24 * 60 * 60 * 1000;
  const from = new Date(now.getTime() - ms);
  return {
    key,
    label: meta.label,
    from: from.toISOString(),
    to: now.toISOString(),
    granularity: meta.granularity,
  };
}
