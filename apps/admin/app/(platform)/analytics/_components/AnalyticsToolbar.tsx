'use client';

import { useMemo } from 'react';
import { SegmentedControl } from '@boletera/ui/src/components/SegmentedControl';
import type { MetricsGranularity } from '@boletera/shared';
import type { MetricsTimeseriesMetric } from '@/lib/queries/metrics';
import {
  ANALYTICS_VIEW_SEGMENTS,
  GRANULARITY_OPTIONS,
  METRIC_OPTIONS,
  isMetricsGranularity,
  isMetricsTimeseriesMetric,
  type AnalyticsViewId,
} from '../_lib/filters';
import {
  COMPARISON_MODES,
  RANGE_PRESETS,
  coerceGranularity,
  fromDateInputValues,
  isComparisonMode,
  isGranularityUsable,
  toDateInputValue,
  type ComparisonMode,
  type IsoRange,
  type RangePresetId,
} from '../_lib/range';
import styles from '../analytics.module.scss';

export type { AnalyticsViewId } from '../_lib/filters';
export {
  ANALYTICS_VIEWS,
  GRANULARITY_OPTIONS,
  METRIC_OPTIONS,
} from '../_lib/filters';

export interface AnalyticsToolbarProps {
  view: AnalyticsViewId;
  onViewChange: (view: AnalyticsViewId) => void;
  preset: RangePresetId;
  onPresetChange: (preset: RangePresetId) => void;
  range: IsoRange;
  onCustomRangeChange: (range: IsoRange) => void;
  comparison: ComparisonMode;
  onComparisonChange: (mode: ComparisonMode) => void;
  metric: MetricsTimeseriesMetric;
  onMetricChange: (metric: MetricsTimeseriesMetric) => void;
  granularity: MetricsGranularity;
  onGranularityChange: (granularity: MetricsGranularity) => void;
  eventId: string;
  onEventChange: (eventId: string) => void;
  events: readonly { id: string; title: string }[];
  eventsLoading: boolean;
}

export function AnalyticsToolbar({
  view,
  onViewChange,
  preset,
  onPresetChange,
  range,
  onCustomRangeChange,
  comparison,
  onComparisonChange,
  metric,
  onMetricChange,
  granularity,
  onGranularityChange,
  eventId,
  onEventChange,
  events,
  eventsLoading,
}: AnalyticsToolbarProps) {
  const usableGranularities = useMemo(
    () =>
      GRANULARITY_OPTIONS.map((option) => ({
        ...option,
        disabled: !isGranularityUsable(option.id, range),
      })),
    [range],
  );

  const effectiveGranularity = coerceGranularity(granularity, range);

  const rangeSegments: readonly { value: RangePresetId; label: string }[] =
    RANGE_PRESETS.map((item) => ({
      value: item.id,
      label: item.shortLabel,
    }));

  return (
    <div className={styles.controls} role="group" aria-label="Controles de análisis">
      <div className={styles.control}>
        <span className={styles.controlLabel} id="analytics-view-label">
          Vista
        </span>
        <SegmentedControl
          label="Vista del panel"
          size="sm"
          value={view}
          onValueChange={onViewChange}
          options={ANALYTICS_VIEW_SEGMENTS}
        />
      </div>

      <div className={styles.control}>
        <span className={styles.controlLabel} id="analytics-range-label">
          Periodo
        </span>
        <SegmentedControl
          label="Periodo de análisis"
          size="sm"
          value={preset}
          onValueChange={onPresetChange}
          options={rangeSegments}
        />
      </div>

      <div className={styles.control}>
        <label className={styles.controlLabel} htmlFor="analytics-from">
          Rango
        </label>
        <div className={styles.dateFields}>
          <input
            id="analytics-from"
            className={styles.dateInput}
            type="date"
            value={toDateInputValue(range.from)}
            max={toDateInputValue(new Date(Date.parse(range.to) - 86_400_000).toISOString())}
            onChange={(event) => {
              const next = fromDateInputValues(
                event.target.value,
                toDateInputValue(new Date(Date.parse(range.to) - 86_400_000).toISOString()),
              );
              if (next) onCustomRangeChange(next);
            }}
          />
          <span className={styles.dateSeparator} aria-hidden="true">
            –
          </span>
          <input
            id="analytics-to"
            className={styles.dateInput}
            type="date"
            aria-label="Fecha final"
            value={toDateInputValue(new Date(Date.parse(range.to) - 86_400_000).toISOString())}
            min={toDateInputValue(range.from)}
            onChange={(event) => {
              const next = fromDateInputValues(toDateInputValue(range.from), event.target.value);
              if (next) onCustomRangeChange(next);
            }}
          />
        </div>
      </div>

      <div className={styles.control}>
        <label className={styles.controlLabel} htmlFor="analytics-comparison">
          Comparar con
        </label>
        <select
          id="analytics-comparison"
          className={styles.select}
          value={comparison}
          onChange={(event) => {
            if (isComparisonMode(event.target.value)) {
              onComparisonChange(event.target.value);
            }
          }}
        >
          {COMPARISON_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.control}>
        <label className={styles.controlLabel} htmlFor="analytics-metric">
          Métrica
        </label>
        <select
          id="analytics-metric"
          className={styles.select}
          value={metric}
          onChange={(event) => {
            if (isMetricsTimeseriesMetric(event.target.value)) {
              onMetricChange(event.target.value);
            }
          }}
        >
          {METRIC_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.control}>
        <label className={styles.controlLabel} htmlFor="analytics-granularity">
          Granularidad
        </label>
        <select
          id="analytics-granularity"
          className={styles.select}
          value={effectiveGranularity}
          onChange={(event) => {
            if (isMetricsGranularity(event.target.value)) {
              onGranularityChange(event.target.value);
            }
          }}
        >
          {usableGranularities.map((option) => (
            <option key={option.id} value={option.id} disabled={option.disabled}>
              {option.label}
              {option.disabled ? ' (no aplica)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.controlSpacer} />

      <div className={styles.control}>
        <label className={styles.controlLabel} htmlFor="analytics-event">
          Evento
        </label>
        <select
          id="analytics-event"
          className={styles.select}
          value={eventId}
          disabled={eventsLoading}
          onChange={(event) => onEventChange(event.target.value)}
        >
          <option value="">Todos los eventos</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
