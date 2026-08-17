'use client';

import type { AiAnomaliesResponse } from '@boletera/shared';
import { Badge } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatCount, formatGeneratedAt } from '../_lib/format';
import {
  anomalyDirectionLabel,
  anomalyMetricLabel,
  anomalySeverityRank,
  anomalySeverityTone,
  sufficiencyLabel,
  sufficiencyTone,
} from '../_lib/labels';
import styles from '../ai.module.scss';
import { PanelState } from './PanelState';

export function AnomaliesPanel({
  query,
}: {
  query: UseQueryResult<AiAnomaliesResponse, Error>;
}) {
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
      emptyDescription="El detector no reportó picos ni caídas fuera de umbral en el periodo. Si el motor aún no responde, este panel permanece vacío a propósito."
      emptyHints={['GET /ai/anomalies', 'Umbral z por defecto 2.5']}
    >
      {(data) => {
        const sorted = [...data.anomalies].sort(
          (a, b) =>
            anomalySeverityRank(a.severity) - anomalySeverityRank(b.severity) ||
            Math.abs(b.zScore) - Math.abs(a.zScore),
        );

        return (
          <div className={styles.stackTight}>
            <div className={styles.metaRow}>
              <Badge tone={sufficiencyTone(data.sufficiency)} variant="outline">
                {sufficiencyLabel(data.sufficiency)}
              </Badge>
              <Badge tone="neutral" variant="outline">
                z ≥ {formatCount(data.zThreshold, 1)}
              </Badge>
              <span className={styles.muted}>
                {formatCount(data.sampleSize)} obs. · {formatGeneratedAt(data.generatedAt)}
              </span>
            </div>

            <ul className={styles.alertList}>
              {sorted.map((item) => (
                <li
                  key={`${item.metric}-${item.bucket}-${item.direction}-${item.zScore}`}
                  className={styles.alertItem}
                >
                  <div className={styles.alertHead}>
                    <Badge tone={anomalySeverityTone(item.severity)} dot>
                      {item.severity}
                    </Badge>
                    <strong>{anomalyMetricLabel(item.metric)}</strong>
                    <Badge tone="neutral" variant="outline">
                      {anomalyDirectionLabel(item.direction)}
                    </Badge>
                  </div>
                  <p className={styles.alertBody}>{item.explanation}</p>
                  <dl className={styles.miniDl}>
                    <div>
                      <dt>Observado</dt>
                      <dd>{formatCount(item.observed, 2)}</dd>
                    </div>
                    <div>
                      <dt>Baseline</dt>
                      <dd>{formatCount(item.baselineMean, 2)}</dd>
                    </div>
                    <div>
                      <dt>z-score</dt>
                      <dd>{formatCount(item.zScore, 2)}</dd>
                    </div>
                    {item.eventTitle ? (
                      <div>
                        <dt>Evento</dt>
                        <dd>{item.eventTitle}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>

            <p className={styles.methodNote}>
              {data.method.name}: {data.method.rationale}
            </p>
          </div>
        );
      }}
    </PanelState>
  );
}
