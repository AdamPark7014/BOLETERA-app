import type { MetricsGranularity } from '@boletera/shared';

export type SuiteRangeKey = '7d' | '30d' | '90d';

export type SuiteRange = {
  key: SuiteRangeKey;
  label: string;
  from: string;
  to: string;
  granularity: MetricsGranularity;
  comparisonLabel: string;
};

const META: Record<
  SuiteRangeKey,
  { label: string; days: number; granularity: MetricsGranularity; comparisonLabel: string }
> = {
  '7d': {
    label: '7 días',
    days: 7,
    granularity: 'day',
    comparisonLabel: 'vs. 7 días previos',
  },
  '30d': {
    label: '30 días',
    days: 30,
    granularity: 'day',
    comparisonLabel: 'vs. 30 días previos',
  },
  '90d': {
    label: '90 días',
    days: 90,
    granularity: 'week',
    comparisonLabel: 'vs. 90 días previos',
  },
};

export const SUITE_RANGE_OPTIONS: readonly SuiteRangeKey[] = ['7d', '30d', '90d'];

export function buildSuiteRange(key: SuiteRangeKey, now = new Date()): SuiteRange {
  const meta = META[key];
  const from = new Date(now.getTime() - meta.days * 24 * 60 * 60 * 1000);
  return {
    key,
    label: meta.label,
    from: from.toISOString(),
    to: now.toISOString(),
    granularity: meta.granularity,
    comparisonLabel: meta.comparisonLabel,
  };
}
