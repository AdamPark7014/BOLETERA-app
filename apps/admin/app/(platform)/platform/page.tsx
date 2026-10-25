'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString } from '../events/_ticket/read';

const CHECK: Record<string, string> = {
  ok: 'En orden',
  warn: 'Aviso',
  error: 'Error',
};

type Check = {
  id: string;
  label: string;
  status: string;
  count: number;
  description: string;
};

function readCheck(raw: unknown): Check | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const label = readString(row.label);
  if (!id || !label) return null;
  return {
    id,
    label,
    status: readString(row.status) ?? 'ok',
    count: readNumber(row.count) ?? 0,
    description: readString(row.description) ?? '',
  };
}

export default function PlatformPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <PlataformaBody />
      </AdminFrame>
    </Suspense>
  );
}

function PlataformaBody() {
  const session = useSession();
  const [checks, setChecks] = useState<Check[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const isSuper = session.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!token || !isSuper) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setHealthError(null);
    adminApi<unknown>('/platform/super/health-checks', token)
      .then((payload) => {
        if (!alive) return;
        const row = asRecord(payload);
        const list = Array.isArray(row.checks) ? row.checks : [];
        setChecks(
          list.flatMap((item) => {
            const check = readCheck(item);
            return check ? [check] : [];
          }),
        );
        setGeneratedAt(readString(row.generatedAt));
      })
      .catch(() => {
        if (!alive) return;
        setHealthError('No se leyó la salud.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, isSuper, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!isSuper && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Plataforma</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando plataforma.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Plataforma</h1>
        <p className={styles.quiet}>
          Límite, ráfaga y SSO los fija el entorno. El API no los lee ni los escribe. No hay nada que
          guardar.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Límite">
          <ParameterCard
            name="Límite"
            value="120 / min"
            valueStyle="tabular"
            effect="THROTTLE_LIMIT. Lo fija el entorno. Aquí se lee."
          />
        </Param>
        <Param name="Ráfaga">
          <ParameterCard
            name="Ráfaga"
            value="10 / s"
            valueStyle="tabular"
            effect="THROTTLE_BURST_LIMIT. Lo fija el entorno. Aquí se lee."
          />
        </Param>
        <Param name="SSO de admin">
          <ParameterCard
            name="SSO de admin"
            value="Según entorno"
            effect="Google y Microsoft. El secreto no se muestra."
          />
        </Param>
      </div>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Salud</h2>
        <p className={styles.quiet}>
          {generatedAt ? `Reconciliación · ${formatWhen(generatedAt)}` : 'Reconciliación.'}
        </p>
        {healthError ? (
          <p className={styles.danger} role="alert">
            {healthError}{' '}
            <button type="button" className={styles.link} onClick={() => setNonce((current) => current + 1)}>
              Reintentar
            </button>
          </p>
        ) : null}
      </header>
      {checks.length === 0 && !healthError ? <p className={styles.quiet}>Nada que reconciliar.</p> : null}
      <div className={styles.stack}>
        {checks.map((check) => (
          <Param key={check.id} name={check.label}>
            <ParameterCard
              name={check.label}
              value={`${CHECK[check.status] ?? check.status} · ${formatCount(check.count)}`}
              valueStyle="tabular"
              effect={check.description || 'Conteo de la reconciliación.'}
            />
          </Param>
        ))}
      </div>
    </section>
  );
}
