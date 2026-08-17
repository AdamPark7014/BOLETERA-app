'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Modal, initialsOf } from '@boletera/ui';
import { TEAM_ROLES, type TeamRole } from '../_lib/roles';
import { INITIAL_INVITE, type InviteForm } from '../_lib/types';
import styles from '../staff.module.scss';

export type InvitePayload = InviteForm;

type InviteMemberModalProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: InvitePayload) => Promise<void>;
};

export function InviteMemberModal({ open, busy, onClose, onSubmit }: InviteMemberModalProps) {
  const [form, setForm] = useState<InviteForm>(INITIAL_INVITE);
  const [localError, setLocalError] = useState<string | null>(null);

  function reset() {
    setForm(INITIAL_INVITE);
    setLocalError(null);
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);

    if (form.password.length < 8) {
      setLocalError('La contraseña temporal debe tener al menos 8 caracteres.');
      return;
    }

    try {
      await onSubmit(form);
      reset();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo invitar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Invitar miembro"
      description="Crea la cuenta con contraseña temporal. El usuario podrá cambiarla al iniciar sesión."
      size="lg"
      dismissible={!busy}
      footer={
        <div className={styles.modalFooter}>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="submit" form="staff-invite-member" loading={busy} loadingLabel="Invitando…">
            Enviar invitación
          </Button>
        </div>
      }
    >
      <form
        id="staff-invite-member"
        className={styles.formGrid}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <Input
          label="Email"
          type="email"
          requiredMark
          required
          value={form.email}
          onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          placeholder="nombre@empresa.com"
          autoComplete="email"
          autoFocus
        />
        <div className={styles.fieldRow}>
          <Input
            label="Nombre"
            requiredMark
            required
            value={form.firstName}
            onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
            autoComplete="given-name"
          />
          <Input
            label="Apellido"
            requiredMark
            required
            value={form.lastName}
            onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
            autoComplete="family-name"
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.selectField}>
            <span>Rol</span>
            <select
              className={styles.roleSelect}
              value={form.role}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, role: e.target.value as TeamRole }))
              }
            >
              {TEAM_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label} — {role.summary}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Contraseña temporal"
            type="password"
            requiredMark
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            autoComplete="new-password"
            hint="Mínimo 8 caracteres"
          />
        </div>
        <p className={styles.muted}>
          Iniciales previstas: {initialsOf(`${form.firstName} ${form.lastName}`) || '—'}
        </p>
        {localError ? (
          <p className={styles.formError} role="alert">
            {localError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
