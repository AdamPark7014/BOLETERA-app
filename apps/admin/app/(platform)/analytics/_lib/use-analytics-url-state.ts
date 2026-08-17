'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MetricsGranularity } from '@boletera/shared';
import type { MetricsTimeseriesMetric } from '@/lib/queries/metrics';
import {
  parseAnalyticsViewId,
  parseMetricsGranularity,
  parseMetricsTimeseriesMetric,
  type AnalyticsViewId,
} from './filters';
import {
  coerceGranularity,
  parseComparisonMode,
  parseIsoRange,
  parsePresetId,
  recommendedGranularity,
  resolvePreset,
  type ComparisonMode,
  type IsoRange,
  type RangePresetId,
} from './range';

export type AnalyticsUrlState = {
  view: AnalyticsViewId;
  preset: RangePresetId;
  range: IsoRange;
  comparison: ComparisonMode;
  metric: MetricsTimeseriesMetric;
  granularity: MetricsGranularity;
  eventId: string;
};

const DEFAULT_VIEW: AnalyticsViewId = 'overview';
const DEFAULT_PRESET: RangePresetId = '28d';
const DEFAULT_COMPARISON: ComparisonMode = 'previous';
const DEFAULT_METRIC: MetricsTimeseriesMetric = 'revenue';

/**
 * La URL es la única fuente de verdad de vista, rango, métrica y filtros del
 * workspace de analítica: un enlace compartido reproduce exactamente el panel.
 */
export function useAnalyticsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<AnalyticsUrlState>(() => {
    const view = parseAnalyticsViewId(searchParams.get('view')) ?? DEFAULT_VIEW;
    const presetRaw = parsePresetId(searchParams.get('range')) ?? DEFAULT_PRESET;
    const customRange = parseIsoRange(searchParams.get('from'), searchParams.get('to'));
    const preset: RangePresetId =
      presetRaw === 'custom' && !customRange ? DEFAULT_PRESET : presetRaw;
    const range: IsoRange =
      preset === 'custom' && customRange ? customRange : resolvePreset(preset);
    const comparison =
      parseComparisonMode(searchParams.get('compare')) ?? DEFAULT_COMPARISON;
    const metric =
      parseMetricsTimeseriesMetric(searchParams.get('metric')) ?? DEFAULT_METRIC;
    const requestedGranularity =
      parseMetricsGranularity(searchParams.get('granularity')) ??
      recommendedGranularity(range);
    const granularity = coerceGranularity(requestedGranularity, range);
    const eventId = searchParams.get('event') ?? '';

    return {
      view,
      preset,
      range,
      comparison,
      metric,
      granularity,
      eventId,
    };
  }, [searchParams]);

  const replaceParams = useCallback(
    (patch: Readonly<Record<string, string | null>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setView = useCallback(
    (view: AnalyticsViewId) =>
      replaceParams({ view: view === DEFAULT_VIEW ? null : view }),
    [replaceParams],
  );

  const setPreset = useCallback(
    (preset: RangePresetId) => {
      if (preset === 'custom') {
        const fallback = resolvePreset(DEFAULT_PRESET);
        replaceParams({
          range: 'custom',
          from: fallback.from,
          to: fallback.to,
          granularity: recommendedGranularity(fallback),
        });
        return;
      }
      const range = resolvePreset(preset);
      replaceParams({
        range: preset === DEFAULT_PRESET ? null : preset,
        from: null,
        to: null,
        granularity: recommendedGranularity(range),
      });
    },
    [replaceParams],
  );

  const setCustomRange = useCallback(
    (range: IsoRange) => {
      replaceParams({
        range: 'custom',
        from: range.from,
        to: range.to,
        granularity: recommendedGranularity(range),
      });
    },
    [replaceParams],
  );

  const setComparison = useCallback(
    (comparison: ComparisonMode) =>
      replaceParams({
        compare: comparison === DEFAULT_COMPARISON ? null : comparison,
      }),
    [replaceParams],
  );

  const setMetric = useCallback(
    (metric: MetricsTimeseriesMetric) =>
      replaceParams({ metric: metric === DEFAULT_METRIC ? null : metric }),
    [replaceParams],
  );

  const setGranularity = useCallback(
    (granularity: MetricsGranularity) => {
      const next = coerceGranularity(granularity, state.range);
      const recommended = recommendedGranularity(state.range);
      replaceParams({
        granularity: next === recommended ? null : next,
      });
    },
    [replaceParams, state.range],
  );

  const setEventId = useCallback(
    (eventId: string) => replaceParams({ event: eventId || null }),
    [replaceParams],
  );

  return {
    ...state,
    setView,
    setPreset,
    setCustomRange,
    setComparison,
    setMetric,
    setGranularity,
    setEventId,
  };
}
