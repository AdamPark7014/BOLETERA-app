'use client';

import { useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import styles from '../../events/_ticket/frame.module.scss';
import type { AiProposedAction } from '../_lib/actions';
import { formatGeneratedAt } from '../_lib/format';
import { priorityLabel, recommendationKindLabel } from '../_lib/labels';

type ActionsPanelProps = {
  actions: readonly AiProposedAction[];
  reviewingId: string | null;
  onReview: (action: AiProposedAction | null) => void;
  onResolve: (actionId: string, status: 'confirmed' | 'dismissed', note: string) => void;
};

function statusLabel(status: AiProposedAction['status']): string {
  if (status === 'confirmed') return 'Confirmada';
  if (status === 'dismissed') return 'Descartada';
  return 'Espera confirmación';
}

/**
 * Cola de confirmación humana. El copiloto propone; nada avanza sin confirmación.
 * La revisión se abre en la misma fila (antes era un modal) y no inventa resultados.
 */
export function ActionsPanel({ actions, reviewingId, onReview, onResolve }: ActionsPanelProps) {
  const [note, setNote] = useState('');
  const pending = actions.filter((row) => row.status === 'pending_confirmation');
  const resolved = actions.filter((row) => row.status !== 'pending_confirmation');

  if (actions.length === 0) {
    return (
      <div className={styles.stack}>
        <p className={styles.rowTitle}>Sin acciones en cola</p>
        <p className={styles.quiet}>
          Desde Recomendaciones puedes proponer una. Queda pendiente hasta que alguien la confirme.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <p className={styles.tertiary}>
        {pending.length} pendientes · {resolved.length} resueltas
      </p>
      {actions.map((action) => {
        const open = reviewingId === action.id;
        return (
          <div key={action.id} className={styles.stack}>
            <button
              type="button"
              className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
              aria-expanded={open}
              onClick={() => {
                setNote('');
                onReview(open ? null : action);
              }}
            >
              <span>
                {action.title} · {priorityLabel(action.priority)}
              </span>
              <span className={styles.tertiary}>{statusLabel(action.status)}</span>
            </button>
            {open ? (
              <div className={styles.stack}>
                <p className={styles.rowMeta}>{recommendationKindLabel(action.kind)}</p>
                <p className={styles.quiet}>{action.rationale}</p>
                <p className={styles.quiet}>Acción: {action.action}</p>
                {action.entityLabel ? (
                  <p className={styles.tertiary}>Entidad: {action.entityLabel}</p>
                ) : null}
                <p className={styles.tertiary}>
                  {action.estimatedImpactLabel
                    ? `Impacto estimado (motor): ${action.estimatedImpactLabel}`
                    : 'Impacto no estimable con la muestra actual. No se inventa cifra.'}
                </p>
                <p className={styles.tertiary}>
                  Propuesta {formatGeneratedAt(action.proposedAt)}
                  {action.resolvedAt ? ` · resuelta ${formatGeneratedAt(action.resolvedAt)}` : ''}
                </p>
                {action.note ? <p className={styles.tertiary}>Nota: {action.note}</p> : null}
                {action.status === 'pending_confirmation' ? (
                  <>
                    <Field
                      label="Nota de auditoría (opcional)"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Motivo de la confirmación o descarte"
                    />
                    <p className={styles.tertiary}>
                      Confirmar registra la intención humana. No inventa métricas de resultado ni
                      aplica cambios fuera de los flujos con permiso explícito.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      <TicketButton
                        variant="secondary"
                        onClick={() => {
                          onResolve(action.id, 'confirmed', note.trim());
                          setNote('');
                        }}
                      >
                        Confirmar acción
                      </TicketButton>
                      <TicketButton
                        variant="ghost"
                        onClick={() => {
                          onResolve(action.id, 'dismissed', note.trim());
                          setNote('');
                        }}
                      >
                        Descartar
                      </TicketButton>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
