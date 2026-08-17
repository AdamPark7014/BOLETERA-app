export type AiRangeKey = '7d' | '30d' | '90d';

export type AiRange = {
  key: AiRangeKey;
  label: string;
  from: string;
  to: string;
  comparisonLabel: string;
};

const META: Record<
  AiRangeKey,
  { label: string; days: number; comparisonLabel: string }
> = {
  '7d': {
    label: '7 días',
    days: 7,
    comparisonLabel: 'vs. 7 días previos',
  },
  '30d': {
    label: '30 días',
    days: 30,
    comparisonLabel: 'vs. 30 días previos',
  },
  '90d': {
    label: '90 días',
    days: 90,
    comparisonLabel: 'vs. 90 días previos',
  },
};

export const AI_RANGE_OPTIONS: readonly AiRangeKey[] = ['7d', '30d', '90d'];

export function buildAiRange(key: AiRangeKey, now = new Date()): AiRange {
  const meta = META[key];
  const from = new Date(now.getTime() - meta.days * 24 * 60 * 60 * 1000);
  return {
    key,
    label: meta.label,
    from: from.toISOString(),
    to: now.toISOString(),
    comparisonLabel: meta.comparisonLabel,
  };
}
