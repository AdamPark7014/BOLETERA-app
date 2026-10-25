'use client';

import { Suspense, useEffect, useState } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Switch } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, readString, yesNo } from '../events/_ticket/read';

const SCOPES = [
  { id: 'read:events', label: 'Leer eventos' },
  { id: 'read:inventory', label: 'Leer inventario' },
  { id: 'write:orders', label: 'Escribir órdenes' },
] as const;

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  active: boolean;
};

function scopeLabel(scope: string): string {
  return SCOPES.find((item) => item.id === scope)?.label ?? scope;
}

function readKey(raw: unknown): KeyRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.flatMap((item) => {
        const scope = readString(item);
        return scope ? [scope] : [];
      })
    : [];
  return {
    id,
    name,
    keyPrefix: readString(row.keyPrefix) ?? '—',
    scopes,
    active: row.active !== false,
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

function canEditRole(role: string | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'PROMOTER';
}

export default function PartnersPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <PartnersBody />
      </AdminFrame>
    </Suspense>
  );
}

function PartnersBody() {
  const session = useSession();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [revoke, setRevoke] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read:events', 'read:inventory', 'write:orders']);
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canEdit = canEditRole(session.role);

  useEffect(() => {
    if (!token || !session.orgId || !canEdit) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>(`/partners/${session.orgId}/keys`, token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const key = readKey(item);
          return key ? [key] : [];
        });
        setKeys(next);
        setRevoke({});
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, session.orgId, canEdit, session.status, nonce]);

  const toRevoke = keys.filter((item) => item.active && revoke[item.id]);
  const creating = name.trim().length > 0;
  const dirty = toRevoke.length > 0 || creating;

  async function save() {
    if (!token || !session.orgId || !dirty || saving) return;
    if (creating && scopes.length === 0) {
      setActionError('La clave necesita al menos un scope.');
      return;
    }
    setSaving(true);
    setActionError(null);
    const lines: string[] = [];
    try {
      for (const item of toRevoke) {
        await adminApi(`/partners/${session.orgId}/keys/${item.id}/revoke`, token, {
          method: 'PATCH',
          body: '{}',
        });
        lines.push(`${item.name} revocada`);
      }
      if (creating) {
        const created = asRecord(
          await adminApi(`/partners/${session.orgId}/keys`, token, {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), scopes }),
          }),
        );
        const once = readString(created.secret);
        setSecret(once);
        setName('');
        lines.push('Clave creada');
      }
      setNotice(lines.join(' · '));
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canEdit && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Partners</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir partners" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando claves.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Partners</h1>
        <p className={styles.quiet}>
          Claves de API. El partner de un evento, con cupo y comisión, está en Canales.
        </p>
      </header>
      {keys.length === 0 ? <p className={styles.quiet}>No hay claves.</p> : null}
      <div className={styles.stack}>
        {secret ? (
          <Param name="Clave">
            <ParameterCard
              name="Clave"
              value={secret}
              valueStyle="mono"
              effect="Se muestra una vez. Después queda el prefijo."
            />
          </Param>
        ) : null}
        {keys.map((item) => {
          const open = openId === item.id;
          const willRevoke = Boolean(revoke[item.id]);
          return (
            <div key={item.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span>{item.name}</span>
                <span className={styles.rowMeta}>{item.active ? 'Activa' : 'Revocada'}</span>
              </button>
              {open ? (
                <div className={styles.stack}>
                  <Param name="Nombre de la clave">
                    <ParameterCard
                      name="Nombre de la clave"
                      value={item.name}
                      effect={`Prefijo ${item.keyPrefix}. El secreto no vuelve a mostrarse.`}
                    />
                  </Param>
                  <Param name="Scopes">
                    <ParameterCard
                      name="Scopes"
                      value={item.scopes.map(scopeLabel).join(' · ') || 'Ninguno'}
                      effect="Esta ruta no cambia los scopes de una clave ya hecha."
                    />
                  </Param>
                  <Param name="Revocada">
                    <ParameterCard
                      name="Revocada"
                      value={yesNo(!item.active || willRevoke)}
                      effect={item.active ? 'Apagarla no se deshace.' : 'Ya está apagada.'}
                    >
                      {item.active ? (
                        <Switch
                          label="Revocada"
                          on={willRevoke}
                          onChange={(next) => {
                            setRevoke((current) => ({ ...current, [item.id]: next }));
                            setNotice(null);
                          }}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                </div>
              ) : null}
            </div>
          );
        })}
        <Param name="Nombre de la clave">
          <ParameterCard name="Nombre de la clave" value={name.trim() || '—'} effect="Vacío: Guardar no crea clave.">
            <Field
              label="Nombre de la clave"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
        {SCOPES.map((scope) => {
          const on = scopes.includes(scope.id);
          return (
            <Param key={scope.id} name={scope.label}>
              <ParameterCard name={scope.label} value={on ? 'Sí' : 'No'} effect="Scope de la clave nueva.">
                <Switch
                  label={scope.label}
                  on={on}
                  onChange={(next) => {
                    setScopes((current) =>
                      next ? [...current, scope.id] : current.filter((item) => item !== scope.id),
                    );
                    setNotice(null);
                  }}
                />
              </ParameterCard>
            </Param>
          );
        })}
      </div>
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {dirty ? 'Sin guardar' : (notice ?? '')}
        </p>
        <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
          Guardar sección
        </TicketButton>
      </div>
    </section>
  );
}
