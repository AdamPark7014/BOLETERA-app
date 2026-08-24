'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@boletera/ui';
import {
  getAdminReconciliation,
  getPlatformHealthChecks,
  type ReconciliationCheck,
  type ReconciliationReport,
} from '@/lib/platform-api';
import { useSession } from '@/lib/use-session';
import platform from '../../_styles/platform.module.scss';
import styles from './health.module.scss';

type StatusFilter = 'all' | ReconciliationCheck['status'];

const STATUS_LABEL: Record<ReconciliationCheck['status'], string> = {
  ok: 'OK',
  warn: 'Alerta',
  error: 'Error',
};

function statusBadgeClass(status: ReconciliationCheck['status']) {
  if (status === 'ok') return styles.badgeOk;
  if (status === 'warn') return styles.badgeWarn;
  return styles.badgeError;
}

function formatSample(sample: Record<string, string | number | null>) {
  return Object.entries(sample)
    .map(([k, v]) => `${k}=${v ?? '—'}`)
    .join(' · ');
}

export default function PlatformHealthPage() {
  const { token, role } = useSession();
  const [data, setData] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [platformWide, setPlatformWide] = useState(false);

  const canPlatformWide = role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    if (!token) {
      setError('Inicia sesión para ver los diagnósticos');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const report =
        canPlatformWide && platformWide
          ? await getPlatformHealthChecks(token)
          : await getAdminReconciliation(token);
      setData(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el reporte');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, canPlatformWide, platformWide]);

  useEffect(() => {
    void load();
  }, [load]);

  const checks = useMemo(() => {
    const list = data?.checks ?? [];
    if (filter === 'all') return list;
    return list.filter((c) => c.status === filter);
  }, [data, filter]);

  const summary = data?.summary;

  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    return (
      <div className={platform.panel}>
        <h2>Acceso restringido</h2>
        <p>Los diagnósticos operativos requieren rol ADMIN o SUPER_ADMIN.</p>
        <Link href="/dashboard">Volver al inicio</Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <PageHeader
        title="Salud operativa"
        description="Diagnóstico de consistencia entre órdenes, pagos, boletos, inventario y reembolsos. Solo lectura — no corrige datos."
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={platform.ghostBtn}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
        {canPlatformWide ? (
          <label className={styles.muted}>
            <input
              type="checkbox"
              checked={platformWide}
              onChange={(e) => setPlatformWide(e.target.checked)}
              style={{ marginRight: '0.4rem' }}
            />
            Vista plataforma (cross-tenant)
          </label>
        ) : null}
        {data ? (
          <span className={styles.muted}>
            Generado {new Date(data.generatedAt).toLocaleString('es-MX')}
            {data.scope === 'platform' ? ' · alcance global' : ' · tu organización'}
          </span>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {summary ? (
        <section className={styles.kpis} aria-label="Resumen">
          <article>
            <span>Checks OK</span>
            <strong>{summary.ok}</strong>
          </article>
          <article className={styles.kpiWarn}>
            <span>Alertas</span>
            <strong>{summary.warn}</strong>
          </article>
          <article className={styles.kpiError}>
            <span>Errores</span>
            <strong>{summary.error}</strong>
          </article>
          <article>
            <span>Total checks</span>
            <strong>{data?.checks.length ?? 0}</strong>
          </article>
        </section>
      ) : null}

      <div className={styles.filters} role="tablist" aria-label="Filtrar por estado">
        {(['all', 'error', 'warn', 'ok'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? styles.tabOn : styles.tab}
            onClick={() => setFilter(key)}
          >
            {key === 'all' ? 'Todos' : STATUS_LABEL[key]}
          </button>
        ))}
      </div>

      <section className={platform.panel}>
        <h2 className={platform.panelTitle}>Checks de reconciliación</h2>
        {loading && !data ? (
          <p className={styles.muted}>Cargando diagnósticos…</p>
        ) : checks.length === 0 ? (
          <p className={styles.muted}>Sin resultados para el filtro seleccionado.</p>
        ) : (
          <div className={styles.checkList}>
            {checks.map((check) => (
              <article key={check.id} className={styles.checkCard}>
                <div className={styles.checkHead}>
                  <div>
                    <h3>{check.label}</h3>
                    <p>{check.description}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                    <span className={statusBadgeClass(check.status)}>{STATUS_LABEL[check.status]}</span>
                    <span className={styles.count}>{check.count.toLocaleString('es-MX')} incidencias</span>
                  </div>
                </div>
                {check.samples.length > 0 ? (
                  <ul className={styles.samples} aria-label={`Muestras ${check.id}`}>
                    {check.samples.map((sample, i) => (
                      <li key={i} className={styles.sample}>
                        {formatSample(sample)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
