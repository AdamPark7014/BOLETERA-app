'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ParameterCard, TicketButton } from '@boletera/ui';
import {
  getAdminReconciliation,
  getPlatformHealthChecks,
  type ReconciliationCheck,
  type ReconciliationReport,
} from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Param, Segment, Switch } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount, formatWhen } from '../../events/_ticket/read';

type StatusFilter = 'all' | ReconciliationCheck['status'];

const STATUS_LABEL: Record<ReconciliationCheck['status'], string> = {
  ok: 'En orden',
  warn: 'Aviso',
  error: 'Error',
};

function formatSample(sample: Record<string, string | number | null>): string {
  return Object.entries(sample)
    .map(([key, value]) => `${key}=${value ?? '—'}`)
    .join(' · ');
}

export default function PlatformHealthPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <SaludBody />
      </AdminFrame>
    </Suspense>
  );
}

function SaludBody() {
  const session = useSession();
  const token = session.token;
  const role = session.role;
  const canSee = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const canPlatformWide = role === 'SUPER_ADMIN';
  const [data, setData] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [platformWide, setPlatformWide] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const report =
        canPlatformWide && platformWide
          ? await getPlatformHealthChecks(token)
          : await getAdminReconciliation(token);
      setData(report);
    } catch (cause) {
      setError(cause);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, canSee, canPlatformWide, platformWide, session.status]);

  useEffect(() => {
    void load();
  }, [load]);

  const checks = useMemo(() => {
    const list = data?.checks ?? [];
    if (filter === 'all') return list;
    return list.filter((check) => check.status === filter);
  }, [data, filter]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Salud</h1>
          <p className={styles.quiet}>
            Los diagnósticos los abre administrador o superadministrador.
          </p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir salud" onRetry={() => void load()} />;
  }
  if ((loading && !data) || !token) return <p className={styles.quiet}>Cargando salud.</p>;

  const summary = data?.summary;
  const total = data?.checks.length ?? 0;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Salud</h1>
        <p className={styles.quiet}>
          Consistencia entre órdenes, pagos, boletos, inventario y reembolsos. Solo lectura: no
          corrige datos.
        </p>
        {data ? (
          <p className={styles.tertiary}>
            Generado {formatWhen(data.generatedAt)} ·{' '}
            {data.scope === 'platform' ? 'toda la plataforma' : 'tu organización'}
          </p>
        ) : null}
      </header>
      <div className={styles.stack}>
        {canPlatformWide ? (
          <Param name="Alcance">
            <ParameterCard
              name="Alcance"
              value={platformWide ? 'Toda la plataforma' : 'Tu organización'}
              effect="Encendido lee los diagnósticos de todas las organizaciones."
            >
              <Switch on={platformWide} label="Toda la plataforma" onChange={setPlatformWide} />
            </ParameterCard>
          </Param>
        ) : null}
        {summary ? (
          <div className={styles.rows}>
            <div className={styles.row}>
              <p className={styles.rowTitle}>En orden</p>
              <span />
              <p className={styles.figure}>{formatCount(summary.ok)}</p>
            </div>
            <div className={styles.row}>
              <p className={styles.rowTitle}>Avisos</p>
              <span />
              <p className={styles.figure}>{formatCount(summary.warn)}</p>
            </div>
            <div className={styles.row}>
              <p className={styles.rowTitle}>Errores</p>
              <span />
              <p className={styles.figure}>{formatCount(summary.error)}</p>
            </div>
            <div className={styles.row}>
              <p className={styles.rowTitle}>Diagnósticos</p>
              <span />
              <p className={styles.figure}>{formatCount(total)}</p>
            </div>
          </div>
        ) : null}
        <Segment<StatusFilter>
          label="Filtrar por estado"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Todos · ${formatCount(total)}` },
            { value: 'error', label: `Error · ${formatCount(summary?.error ?? 0)}` },
            { value: 'warn', label: `Aviso · ${formatCount(summary?.warn ?? 0)}` },
            { value: 'ok', label: `En orden · ${formatCount(summary?.ok ?? 0)}` },
          ]}
        />
        <div>
          <TicketButton variant="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Actualizando' : 'Actualizar'}
          </TicketButton>
        </div>
      </div>
      <header className={styles.sectionHead} style={{ marginTop: 24 }}>
        <p className={styles.rowTitle}>Diagnósticos</p>
      </header>
      {checks.length === 0 ? <p className={styles.quiet}>Nada con ese criterio.</p> : null}
      <div className={styles.stack}>
        {checks.map((check) => {
          const open = openId === check.id;
          return (
            <div key={check.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : check.id)}
              >
                <span>
                  {check.label} · {STATUS_LABEL[check.status]}
                </span>
                <span className={styles.figure}>{formatCount(check.count)}</span>
              </button>
              {open ? (
                <>
                  <p className={styles.quiet}>{check.description}</p>
                  <p className={styles.tertiary}>
                    {formatCount(check.count)} incidencias ·{' '}
                    <span className={styles.mono}>{check.id}</span>
                  </p>
                  {check.samples.length > 0 ? (
                    <ul className={styles.rows} aria-label={`Muestras ${check.id}`}>
                      {check.samples.map((sample, index) => (
                        <li key={index} className={styles.row}>
                          <p className={styles.mono} style={{ overflowWrap: 'anywhere' }}>
                            {formatSample(sample)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.tertiary}>Sin muestras.</p>
                  )}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
