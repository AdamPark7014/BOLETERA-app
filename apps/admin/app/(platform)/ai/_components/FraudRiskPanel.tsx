'use client';

import type { AiFraudRiskResponse } from '@boletera/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount, formatGeneratedAt } from '../_lib/format';
import { fraudBandLabel, fraudBandRank } from '../_lib/labels';
import { PanelState } from './PanelState';

export function FraudRiskPanel({ query }: { query: UseQueryResult<AiFraudRiskResponse, Error> }) {
  return (
    <PanelState
      data={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={(value) => value.scores.length === 0}
      emptyTitle="Sin puntajes de fraude"
      emptyDescription="El motor no devolvió sujetos con riesgo en el periodo. No se inventan puntajes."
    >
      {(data) => {
        const sorted = [...data.scores].sort(
          (a, b) => fraudBandRank(a.band) - fraudBandRank(b.band) || b.score - a.score
        );
        return (
          <div className={styles.stack}>
            <p className={styles.tertiary}>
              {formatCount(data.summary.scored)} evaluados ·{' '}
              {formatCount(data.summary.highOrCritical)} altos o críticos · puntaje medio{' '}
              {formatCount(data.summary.averageScore, 1)} · {formatGeneratedAt(data.generatedAt)}
            </p>
            <ul className={styles.rows}>
              {sorted.map((item) => {
                const related = [
                  item.relatedOrderIds?.length
                    ? `${item.relatedOrderIds.length} órdenes relacionadas`
                    : null,
                  item.relatedEventIds?.length
                    ? `${item.relatedEventIds.length} eventos relacionados`
                    : null,
                ].filter((part): part is string => part != null);
                return (
                  <li key={`${item.subjectType}-${item.subjectId}`} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>
                        {item.subjectType === 'order' ? 'Orden' : 'Usuario'} ·{' '}
                        {fraudBandLabel(item.band)}
                      </p>
                      <p className={styles.mono}>{item.subjectId}</p>
                      {item.factors.length > 0 ? (
                        item.factors.slice(0, 4).map((factor) => (
                          <p key={`${item.subjectId}-${factor.key}`} className={styles.rowMeta}>
                            {factor.label}: {factor.explanation}
                          </p>
                        ))
                      ) : (
                        <p className={styles.rowMeta}>Sin factores explicativos en esta fila.</p>
                      )}
                      {related.length > 0 ? (
                        <p className={styles.rowMeta}>{related.join(' · ')}</p>
                      ) : null}
                    </div>
                    <span />
                    <p className={styles.figure}>{formatCount(item.score, 1)}</p>
                  </li>
                );
              })}
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
