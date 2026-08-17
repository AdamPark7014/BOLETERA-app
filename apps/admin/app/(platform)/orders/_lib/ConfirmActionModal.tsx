'use client';

import { useId, type ReactNode } from 'react';
import { Button, Modal } from '@boletera/ui';

type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
};

/** Safe confirmation gate for destructive / irreversible order actions. */
export function ConfirmActionModal({
  open,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onClose,
  children,
}: ConfirmActionModalProps) {
  const formId = useId();

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            loading={busy}
            form={formId}
            type="submit"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        {children}
      </form>
    </Modal>
  );
}
