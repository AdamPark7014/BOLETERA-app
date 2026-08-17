'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@boletera/ui';
import {
  GRANTABLE_SCOPES,
  SCOPE_CATALOG,
  type GrantableScope,
} from '../_lib/scopes';
import styles from '../partners.module.scss';

export type CreateKeyPayload = {
  name: string;
  scopes: GrantableScope[];
  rateLimit: number;
  expiresInDays?: number;
};

type CreateKeyModalProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateKeyPayload) => Promise<void>;
};

const DEFAULT_SCOPES: GrantableScope[] = ['read:events', 'read:inventory'];

type FormState = {
  name: string;
  scopes: GrantableScope[];
  rateLimit: string;
  expiresInDays: string;
};

const INITIAL: FormState = {
  name: '',
  scopes: [...DEFAULT_SCOPES],
  rateLimit: '1000',
  expiresInDays: '',
};

export function CreateKeyModal({ open, busy, onClose, onSubmit }: CreateKeyModalProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [localError, setLocalError] = useState<string | null>(null);

  function reset() {
    setForm(INITIAL);
    setLocalError(null);
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  function toggleScope(scope: GrantableScope) {
    setForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((item) => item !== scope)
        : [...prev.scopes, scope],
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);

    const name = form.name.trim();
    if (!name) {
      setLocalError('El nombre es obligatorio.');
      return;
    }
    if (form.scopes.length === 0) {
      setLocalError('Selecciona al menos un scope.');
      return;
    }

    const rateLimit = Number(form.rateLimit);
    if (!Number.isFinite(rateLimit) || rateLimit < 1 || rateLimit > 100_000) {
      setLocalError('El límite por minuto debe estar entre 1 y 100 000.');
      return;
    }

    const expiresRaw = form.expiresInDays.trim();
    let expiresInDays: number | undefined;
    if (expiresRaw) {
      expiresInDays = Number(expiresRaw);
      if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
        setLocalError('La caducidad debe estar entre 1 y 3650 días.');
        return;
      }
    }

    try {
      await onSubmit({
        name,
        scopes: form.scopes,
        rateLimit: Math.round(rateLimit),
        expiresInDays,
      });
      reset();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo crear la clave.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nueva API key"
      description="Define nombre, scopes y límites. El secreto se muestra una sola vez."
      size="lg"
      dismissible={!busy}
      footer={
        <div className={styles.modalFooter}>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-api-key"
            loading={busy}
            loadingLabel="Generando…"
          >
            Generar
          </Button>
        </div>
      }
    >
      <form id="create-api-key" className={styles.formGrid} onSubmit={(e) => void handleSubmit(e)}>
        <Input
          label="Nombre de la integración"
          requiredMark
          required
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="POS Arena Norte"
          autoFocus
        />

        <fieldset className={styles.scopeFieldset}>
          <legend>Scopes concedibles</legend>
          <p className={styles.muted}>
            Solo se ofrecen los scopes que el backend acepta hoy (
            {GRANTABLE_SCOPES.length} disponibles).
          </p>
          <div className={styles.scopeGrid}>
            {SCOPE_CATALOG.map((scope) => (
              <label key={scope.id} className={styles.scopeOption}>
                <input
                  type="checkbox"
                  checked={form.scopes.includes(scope.id)}
                  onChange={() => toggleScope(scope.id)}
                />
                <span>
                  <strong>{scope.label}</strong>
                  <br />
                  <span className={styles.muted}>{scope.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.fieldRow}>
          <Input
            label="Límite por minuto"
            type="number"
            min={1}
            max={100000}
            value={form.rateLimit}
            onChange={(e) => setForm((prev) => ({ ...prev, rateLimit: e.target.value }))}
          />
          <Input
            label="Expira en (días)"
            type="number"
            min={1}
            max={3650}
            hint="Vacío = sin caducidad"
            value={form.expiresInDays}
            onChange={(e) => setForm((prev) => ({ ...prev, expiresInDays: e.target.value }))}
          />
        </div>

        {localError ? (
          <p className={styles.formError} role="alert">
            {localError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
