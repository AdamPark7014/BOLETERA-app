'use client';

import { useId } from 'react';
import { Button, Modal } from '@boletera/ui';
import type { AutomationRule } from '../_lib/types';
import { ruleStatusLabel } from '../_lib/labels';
import styles from '../automations.module.scss';

type ConfirmToggleModalProps = {
  open: boolean;
  rule: AutomationRule | null;
  nextEnabled: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmToggleModal({
  open,
  rule,
  nextEnabled,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmToggleModalProps) {
  const formId = useId();
  if (!rule) return null;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={nextEnabled ? 'Activar automatización' : 'Pausar automatización'}
      description={
        nextEnabled
          ? 'La regla evaluará disparadores reales cuando el backend de ejecuciones esté conectado.'
          : 'La regla dejará de evaluarse. El historial local conserva el cambio de estado.'
      }
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={nextEnabled ? 'primary' : 'danger'}
            size="sm"
            loading={busy}
            type="submit"
            form={formId}
          >
            {nextEnabled ? 'Activar regla' : 'Pausar regla'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.confirmBody}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <p className={styles.confirmTitle}>{rule.name}</p>
        <p className={styles.muted}>{rule.description}</p>
        <p className={styles.muted}>
          Estado actual: {ruleStatusLabel(rule.status)} →{' '}
          {nextEnabled ? 'Activa' : 'Pausada'}
        </p>
        {rule.requiresConnector ? (
          <p className={styles.warn}>
            Requiere conector: {rule.requiresConnector}. Actívala solo si el conector está
            disponible.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
