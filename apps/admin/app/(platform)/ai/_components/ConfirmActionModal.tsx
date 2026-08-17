'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button, Modal } from '@boletera/ui';
import type { AiProposedAction } from '../_lib/actions';
import { priorityLabel } from '../_lib/labels';
import styles from '../ai.module.scss';

type ConfirmActionModalProps = {
  open: boolean;
  action: AiProposedAction | null;
  busy?: boolean;
  onConfirm: (note: string) => void;
  onDismiss: (note: string) => void;
  onClose: () => void;
};

/**
 * Gate HITL: el copiloto propone; la mutación solo avanza tras confirmación humana.
 * Aquí no se inventan resultados ni cifras post-acción.
 */
export function ConfirmActionModal({
  open,
  action,
  busy = false,
  onConfirm,
  onDismiss,
  onClose,
}: ConfirmActionModalProps) {
  const formId = useId();
  const [note, setNote] = useState('');

  if (!action) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm(note.trim());
    setNote('');
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Confirmar acción del copiloto"
      description="La recomendación no ejecuta cambios sola. Confirma solo si aceptas el impacto operativo."
      size="md"
      dismissible={!busy}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              onDismiss(note.trim());
              setNote('');
            }}
          >
            Descartar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            type="submit"
            form={formId}
          >
            Confirmar acción
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.confirmForm} onSubmit={handleSubmit}>
        <p className={styles.confirmTitle}>{action.title}</p>
        <p className={styles.recBody}>{action.rationale}</p>
        <p className={styles.recAction}>Acción: {action.action}</p>
        <ul className={styles.confirmMeta}>
          <li>Prioridad: {priorityLabel(action.priority)}</li>
          {action.entityLabel ? <li>Entidad: {action.entityLabel}</li> : null}
          {action.estimatedImpactLabel ? (
            <li>Impacto estimado (motor): {action.estimatedImpactLabel}</li>
          ) : (
            <li>Impacto no estimable con la muestra actual</li>
          )}
        </ul>
        <label className={styles.field} htmlFor={`${formId}-note`}>
          Nota de auditoría (opcional)
          <textarea
            id={`${formId}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Motivo de la confirmación o descarte"
            disabled={busy}
          />
        </label>
        <p className={styles.muted}>
          Confirmar registra la intención humana. No inventa métricas de resultado ni aplica
          mutaciones fuera de los flujos con permiso explícito.
        </p>
      </form>
    </Modal>
  );
}
