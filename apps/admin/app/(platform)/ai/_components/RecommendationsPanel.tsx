'use client';

import type { AiRecommendation, AiRecommendationsResponse } from '@boletera/shared';
import { Badge, Button } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatGeneratedAt, formatImpactValue } from '../_lib/format';
import {
  confidenceLabel,
  confidenceTone,
  impactMetricLabel,
  priorityLabel,
  priorityRank,
  priorityTone,
  recommendationKindLabel,
  sufficiencyLabel,
  sufficiencyTone,
} from '../_lib/labels';
import styles from '../ai.module.scss';
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
      emptyHints={['GET /ai/recommendations', 'Prioriza urgente → baja']}
    >
      {(data) => {
        const sorted = [...data.recommendations].sort(
          (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
        );

        return (
          <div className={styles.stackTight}>
            <div className={styles.metaRow}>
              <Badge tone="info" variant="outline">
                {data.method.name}
              </Badge>
              <span className={styles.muted}>
                {sorted.length} insights · {formatGeneratedAt(data.generatedAt)}
              </span>
            </div>

            <ul className={styles.recs}>
              {sorted.map((rec) => (
                <li key={rec.id} className={styles.rec}>
                  <div className={styles.recHead}>
                    <Badge tone={priorityTone(rec.priority)}>{priorityLabel(rec.priority)}</Badge>
                    <Badge tone="neutral" variant="outline">
                      {recommendationKindLabel(rec.kind)}
                    </Badge>
                    <Badge tone={confidenceTone(rec.confidence)} variant="outline">
                      Confianza {confidenceLabel(rec.confidence)}
                    </Badge>
                    <Badge tone={sufficiencyTone(rec.sufficiency)} variant="outline">
                      {sufficiencyLabel(rec.sufficiency)}
                    </Badge>
                  </div>
                  <h3 className={styles.recTitle}>{rec.title}</h3>
                  <p className={styles.recBody}>{rec.rationale}</p>
                  <p className={styles.recAction}>Acción: {rec.action}</p>
                  {rec.estimatedImpact ? (
                    <p className={styles.recImpact}>
                      Impacto estimado:{' '}
                      <strong>
                        {formatImpactValue(
                          rec.estimatedImpact.metric,
                          rec.estimatedImpact.value,
                        )}
                      </strong>{' '}
                      ({impactMetricLabel(rec.estimatedImpact.metric)}
                      {rec.estimatedImpact.unit
                        ? ` · ${rec.estimatedImpact.unit}`
                        : ''}
                      )
                    </p>
                  ) : (
                    <p className={styles.muted}>Impacto no estimable con la muestra actual.</p>
                  )}
                  {rec.entityLabel ? (
                    <p className={styles.muted}>
                      Entidad: {rec.entityLabel}
                      {rec.entityType ? ` (${rec.entityType})` : ''}
                    </p>
                  ) : null}
                  {rec.factors.length > 0 ? (
                    <ul className={styles.factorList}>
                      {rec.factors.slice(0, 4).map((factor) => (
                        <li key={`${rec.id}-${factor.key}`}>
                          <strong>{factor.label}</strong>
                          <span>{factor.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {onPropose ? (
                    <div className={styles.inlineActions}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={proposedIds?.has(rec.id)}
                        onClick={() => onPropose(rec)}
                      >
                        {proposedIds?.has(rec.id)
                          ? 'Ya en cola HITL'
                          : 'Proponer con confirmación'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </PanelState>
  );
}
