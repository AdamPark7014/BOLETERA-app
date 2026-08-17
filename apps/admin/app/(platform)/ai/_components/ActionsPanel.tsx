'use client';

import { Badge, Button, EmptyState } from '@boletera/ui';
import type { AiProposedAction } from '../_lib/actions';
import { formatGeneratedAt } from '../_lib/format';
import { priorityLabel, priorityTone, recommendationKindLabel } from '../_lib/labels';
import styles from '../ai.module.scss';

type ActionsPanelProps = {
  actions: readonly AiProposedAction[];
  onReview: (action: AiProposedAction) => void;
};

export function ActionsPanel({ actions, onReview }: ActionsPanelProps) {
  const pending = actions.filter((row) => row.status === 'pending_confirmation');
  const resolved = actions.filter((row) => row.status !== 'pending_confirmation');

  if (actions.length === 0) {
    return (
      <EmptyState
        size="sm"
        tone="neutral"
        illustration="inbox"
        title="Sin acciones en cola"
        description="Desde Insights puedes proponer una recomendación. Quedará pendiente hasta confirmación humana."
        hints={['Insight ≠ mutación', 'Confirmación obligatoria']}
      />
    );
  }

  return (
    <div className={styles.stackTight}>
      <div className={styles.metaRow}>
        <Badge tone={pending.length > 0 ? 'warning' : 'success'} variant="outline">
          {pending.length} pendientes
        </Badge>
        <Badge tone="neutral" variant="outline">
          {resolved.length} resueltas
        </Badge>
      </div>

      <ul className={styles.recs}>
        {actions.map((action) => (
          <li key={action.id} className={styles.rec}>
            <div className={styles.recHead}>
              <Badge tone={priorityTone(action.priority)}>
                {priorityLabel(action.priority)}
              </Badge>
              <Badge tone="neutral" variant="outline">
                {recommendationKindLabel(action.kind)}
              </Badge>
              <Badge
                tone={
                  action.status === 'confirmed'
                    ? 'success'
                    : action.status === 'dismissed'
                      ? 'neutral'
                      : 'warning'
                }
                variant="outline"
              >
                {action.status === 'confirmed'
                  ? 'Confirmada'
                  : action.status === 'dismissed'
                    ? 'Descartada'
                    : 'Espera confirmación'}
              </Badge>
            </div>
            <h3 className={styles.recTitle}>{action.title}</h3>
            <p className={styles.recAction}>Acción: {action.action}</p>
            {action.estimatedImpactLabel ? (
              <p className={styles.recImpact}>
                Impacto estimado (motor): <strong>{action.estimatedImpactLabel}</strong>
              </p>
            ) : (
              <p className={styles.muted}>Impacto no estimable — no se inventa cifra.</p>
            )}
            <p className={styles.muted}>
              Propuesta {formatGeneratedAt(action.proposedAt)}
              {action.resolvedAt ? ` · resuelta ${formatGeneratedAt(action.resolvedAt)}` : ''}
            </p>
            {action.note ? <p className={styles.muted}>Nota: {action.note}</p> : null}
            {action.status === 'pending_confirmation' ? (
              <div className={styles.inlineActions}>
                <Button size="sm" onClick={() => onReview(action)}>
                  Revisar y confirmar
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
