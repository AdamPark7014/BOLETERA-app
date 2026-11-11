'use client';

import type { AiAnomaliesResponse } from '@boletera/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount, formatGeneratedAt } from '../_lib/format';
import {
  anomalyDirectionLabel,
  anomalyMetricLabel,
  anomalySeverityRank,
  sufficiencyLabel,
} from '../_lib/labels';
import { PanelState } from './PanelState';

const SEVERITY: Record<string, string> = {
  watch: 'Vigilar',
  alert: 'Alerta',
  critical: 'Crítica',
};

export function AnomaliesPanel({ query }: { query: UseQueryResult<AiAnomaliesResponse, Error> }) {
  return (
    <PanelState
      data={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={(value) => value.anomalies.length === 0}
      emptyTitle="Sin alertas de anomalía"
      emptyDescription="El detector no reportó picos ni caídas fuera de umbral en el periodo."
    >
      {(data) => {
        const sorted = [...data.anomalies].sort(
          (a, b) =>
            anomalySeverityRank(a.severity) - anomalySeverityRank(b.severity) ||
            Math.abs(b.zScore) - Math.abs(a.zScore)
        );
        return (
          <div className={styles.stack}>
            <p className={styles.tertiary}>
              {sufficiencyLabel(data.sufficiency)} · z ≥ {formatCount(data.zThreshold, 1)} ·{' '}
              {formatCount(data.sampleSize)} observaciones · {formatGeneratedAt(data.generatedAt)}
            </p>
            <ul className={styles.rows}>
              {sorted.map((item) => (
                <li
                  key={`${item.metric}-${item.bucket}-${item.direction}-${item.zScore}`}
                  className={styles.row}
                >
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      {anomalyMetricLabel(item.metric)} · {anomalyDirectionLabel(item.direction)} ·{' '}
                      {SEVERITY[item.severity] ?? item.severity}
                    </p>
                    <p className={styles.quiet}>{item.explanation}</p>
                    <p className={styles.rowMeta}>
                      Observado {formatCount(item.observed, 2)} · base{' '}
                      {formatCount(item.baselineMean, 2)}
                      {item.eventTitle ? ` · ${item.eventTitle}` : ''}
                    </p>
                  </div>
                  <span />
                  <p className={styles.figure}>z {formatCount(item.zScore, 2)}</p>
                </li>
              ))}
            </ul>
            <p className={styles.tertiary}>
              {data.method.name}: {data.method.rationale}
            </p>
          </div>
        );
      }}
    </PanelState>
  );
}
