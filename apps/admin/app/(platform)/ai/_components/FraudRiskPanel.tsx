'use client';

import type { AiFraudRiskResponse } from '@boletera/shared';
import { Badge } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatCount, formatGeneratedAt } from '../_lib/format';
import {
  fraudBandLabel,
  fraudBandRank,
  fraudBandTone,
} from '../_lib/labels';
import styles from '../ai.module.scss';
import { PanelState } from './PanelState';

export function FraudRiskPanel({
  query,
}: {
  query: UseQueryResult<AiFraudRiskResponse, Error>;
}) {
  return (
    <PanelState
      data={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={(value) => value.scores.length === 0}
      emptyTitle="Sin puntuaciones de fraude"
      emptyDescription="El motor no devolvió sujetos con riesgo en el periodo. Si el endpoint no responde, este panel permanece vacío a propósito — no se inventan scores."
      emptyHints={['GET /ai/fraud/risk', 'Bandas: low → critical']}
    >
      {(data) => {
        const sorted = [...data.scores].sort(
          (a, b) =>
            fraudBandRank(a.band) - fraudBandRank(b.band) || b.score - a.score,
        );

        return (
          <div className={styles.stackTight}>
            <div className={styles.metaRow}>
              <Badge tone="neutral" variant="outline">
                {formatCount(data.summary.scored)} evaluados
              </Badge>
              <Badge
                tone={data.summary.highOrCritical > 0 ? 'warning' : 'success'}
                variant="outline"
              >
                {formatCount(data.summary.highOrCritical)} altos/críticos
              </Badge>
              <span className={styles.muted}>
                Score medio {formatCount(data.summary.averageScore, 1)} ·{' '}
                {formatGeneratedAt(data.generatedAt)}
              </span>
            </div>

            <ul className={styles.alertList}>
              {sorted.map((item) => (
                <li
                  key={`${item.subjectType}-${item.subjectId}`}
                  className={styles.alertItem}
                >
                  <div className={styles.alertHead}>
                    <Badge tone={fraudBandTone(item.band)} dot>
                      {fraudBandLabel(item.band)}
                    </Badge>
                    <strong>
                      {item.subjectType === 'order' ? 'Orden' : 'Usuario'}{' '}
                      <span className={styles.mono}>{item.subjectId}</span>
                    </strong>
                    <Badge tone="neutral" variant="outline">
                      Score {formatCount(item.score, 1)}
                    </Badge>
                  </div>

                  {item.factors.length > 0 ? (
                    <ul className={styles.factorList}>
                      {item.factors.slice(0, 4).map((factor) => (
                        <li key={`${item.subjectId}-${factor.key}`}>
                          <strong>{factor.label}</strong>
                          <span>{factor.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.muted}>Sin factores explicativos en esta fila.</p>
                  )}

                  {(item.relatedOrderIds?.length || item.relatedEventIds?.length) ? (
                    <p className={styles.muted}>
                      {item.relatedOrderIds?.length
                        ? `${item.relatedOrderIds.length} órdenes relacionadas`
                        : null}
                      {item.relatedOrderIds?.length && item.relatedEventIds?.length
                        ? ' · '
                        : null}
                      {item.relatedEventIds?.length
                        ? `${item.relatedEventIds.length} eventos relacionados`
                        : null}
                    </p>
                  ) : null}
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
