'use client';

import { useState, type FormEvent } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { Param, Switch } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { GRANTABLE_SCOPES, SCOPE_CATALOG, type GrantableScope } from '../_lib/scopes';

export type CreateKeyPayload = {
  name: string;
  scopes: GrantableScope[];
  rateLimit: number;
  expiresInDays?: number;
};

type CreateKeyFormProps = {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: CreateKeyPayload) => Promise<void>;
  /** Traduce el error del API a una línea legible. */
  describeError: (cause: unknown) => string;
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

/** Alta de llave en la misma hoja. El secreto lo muestra la página una sola vez. */
export function CreateKeyForm({ busy, onCancel, onSubmit, describeError }: CreateKeyFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [localError, setLocalError] = useState<string | null>(null);

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
      setLocalError('Elige al menos un permiso.');
      return;
    }
    const rateLimit = Number(form.rateLimit);
    if (!Number.isFinite(rateLimit) || rateLimit < 1 || rateLimit > 100_000) {
      setLocalError('El límite por minuto va de 1 a 100 000.');
      return;
    }
    const expiresRaw = form.expiresInDays.trim();
    let expiresInDays: number | undefined;
    if (expiresRaw) {
      expiresInDays = Number(expiresRaw);
      if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
        setLocalError('La caducidad va de 1 a 3650 días.');
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
      setForm(INITIAL);
    } catch (cause) {
      setLocalError(describeError(cause));
    }
  }

  return (
    <form
      className={styles.stack}
      onSubmit={(event) => void handleSubmit(event)}
      aria-label="Nueva llave"
    >
      <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
        <p className={styles.rowTitle}>Nueva llave</p>
        <p className={styles.tertiary}>
          Nombre, permisos y límites. El secreto se muestra una sola vez.
        </p>
      </header>
      <Field
        label="Nombre de la integración"
        required
        value={form.name}
        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
        placeholder="POS Arena Norte"
        autoFocus
      />
      <p className={styles.tertiary}>
        Solo se ofrecen los permisos que el API acepta hoy ({GRANTABLE_SCOPES.length} disponibles).
      </p>
      {SCOPE_CATALOG.map((scope) => {
        const on = form.scopes.includes(scope.id);
        return (
          <Param key={scope.id} name={scope.label}>
            <ParameterCard name={scope.label} value={on ? 'Concedido' : 'No'} effect={scope.hint}>
              <Switch on={on} label={scope.label} onChange={() => toggleScope(scope.id)} />
            </ParameterCard>
          </Param>
        );
      })}
      <Field
        label="Límite por minuto"
        type="number"
        min={1}
        max={100000}
        value={form.rateLimit}
        onChange={(event) => setForm((prev) => ({ ...prev, rateLimit: event.target.value }))}
      />
      <Field
        label="Expira en (días)"
        type="number"
        min={1}
        max={3650}
        hint="Vacío: sin caducidad."
        value={form.expiresInDays}
        onChange={(event) => setForm((prev) => ({ ...prev, expiresInDays: event.target.value }))}
      />
      {localError ? (
        <p className={styles.danger} role="alert">
          {localError}
        </p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <TicketButton type="submit" variant="primary" disabled={busy}>
          {busy ? 'Generando' : 'Generar llave'}
        </TicketButton>
        <TicketButton
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setForm(INITIAL);
            setLocalError(null);
            onCancel();
          }}
        >
          Cancelar
        </TicketButton>
      </div>
    </form>
  );
}
