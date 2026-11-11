'use client';

import type { AiRecommendation, AiRecommendationsResponse } from '@boletera/shared';
import { TicketButton } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import styles from '../../events/_ticket/frame.module.scss';
import { formatGeneratedAt, formatImpactValue } from '../_lib/format';
import {
  confidenceLabel,
  impactMetricLabel,
  priorityLabel,
  priorityRank,
  recommendationKindLabel,
  sufficiencyLabel,
} from '../_lib/labels';
import { PanelState } from './PanelState';

export function RecommendationsPanel({
  query,
  onPropose,
  proposedIds,
}: {
  query: UseQueryResult<AiRecommendationsResponse, Error>;
  onPropose?: (recommendation: AiRecommendation) => void;
  proposedIds?: ReadonlySet<string>;
}) {
  return (
    <PanelState
      data={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={(value) => value.recommendations.length === 0}
      emptyTitle="Sin recomendaciones accionables"
      emptyDescription="El copiloto no propone acciones hasta tener señales con soporte estadístico. Aquí no se muestran plantillas disfrazadas de insights."
    >
      {(data) => {
        const sorted = [...data.recommendations].sort(
          (a, b) => priorityRank(a.priority) - priorityRank(b.priority)
        );
        return (
          <div className={styles.stack}>
            <p className={styles.tertiary}>
              {data.method.name} · {sorted.length} recomendaciones ·{' '}
              {formatGeneratedAt(data.generatedAt)}
            </p>
            <ul className={styles.rows}>
              {sorted.map((rec) => {
                const queued = proposedIds?.has(rec.id) ?? false;
                return (
                  <li
                    key={rec.id}
                    className={styles.row}
                    style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
                  >
                    <div className={styles.stack} style={{ gap: 8 }}>
                      <p className={styles.rowMeta}>
                        {priorityLabel(rec.priority)} · {recommendationKindLabel(rec.kind)} ·
                        confianza {confidenceLabel(rec.confidence)} ·{' '}
                        {sufficiencyLabel(rec.sufficiency)}
                      </p>
                      <p className={styles.rowTitle}>{rec.title}</p>
                      <p className={styles.quiet}>{rec.rationale}</p>
                      <p className={styles.quiet}>Acción: {rec.action}</p>
                      {rec.estimatedImpact ? (
                        <p className={styles.quiet}>
                          Impacto estimado:{' '}
                          <span
                            style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatImpactValue(
                              rec.estimatedImpact.metric,
                              rec.estimatedImpact.value
                            )}
                          </span>{' '}
                          ({impactMetricLabel(rec.estimatedImpact.metric)}
                          {rec.estimatedImpact.unit ? ` · ${rec.estimatedImpact.unit}` : ''})
                        </p>
                      ) : (
                        <p className={styles.tertiary}>
                          Impacto no estimable con la muestra actual.
                        </p>
                      )}
                      {rec.entityLabel ? (
                        <p className={styles.tertiary}>
                          Entidad: {rec.entityLabel}
                          {rec.entityType ? ` (${rec.entityType})` : ''}
                        </p>
                      ) : null}
                      {rec.factors.slice(0, 4).map((factor) => (
                        <p key={`${rec.id}-${factor.key}`} className={styles.tertiary}>
                          {factor.label}: {factor.explanation}
                        </p>
                      ))}
                      {onPropose ? (
                        <div>
                          <TicketButton
                            variant="secondary"
                            disabled={queued}
                            onClick={() => onPropose(rec)}
                          >
                            {queued ? 'Ya en la cola' : 'Proponer con confirmación'}
                          </TicketButton>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }}
    </PanelState>
  );
}
