'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  KpiCard,
  PageHeader,
  Section,
  Tabs,
  formatNumber,
  type BadgeTone,
} from '@boletera/ui';
import {
  getAdminReconciliation,
  getPlatformHealthChecks,
  type ReconciliationCheck,
  type ReconciliationReport,
} from '@/lib/platform-api';
import { useSession } from '@/lib/use-session';
import styles from './health.module.scss';

type StatusFilter = 'all' | ReconciliationCheck['status'];

const STATUS_LABEL: Record<ReconciliationCheck['status'], string> = {
  ok: 'OK',
  warn: 'Alerta',
  error: 'Error',
};

const STATUS_TONE: Record<ReconciliationCheck['status'], BadgeTone> = {
  ok: 'success',
  warn: 'warning',
  error: 'danger',
};

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
      <div className={styles.page}>
        <PageHeader
          eyebrow="Operaciones"
          title="Salud operativa"
          description="Diagnóstico de consistencia entre órdenes, pagos, boletos, inventario y reembolsos."
        />
        <Section title="Acceso restringido">
          <p className={styles.muted}>
            Los diagnósticos operativos requieren rol ADMIN o SUPER_ADMIN.{' '}
            <Link href="/dashboard">Volver al inicio</Link>
          </p>
        </Section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Salud operativa"
        description="Diagnóstico de consistencia entre órdenes, pagos, boletos, inventario y reembolsos. Solo lectura — no corrige datos."
        actions={
          <Button
            type="button"
            variant="outline"
            loading={loading}
            loadingLabel="Actualizando…"
            onClick={() => void load()}
          >
            Actualizar
          </Button>
        }
      />

      <div className={styles.toolbar}>
        {canPlatformWide ? (
          <label className={styles.muted}>
            <input
              type="checkbox"
              checked={platformWide}
              onChange={(e) => setPlatformWide(e.target.checked)}
              className={styles.checkbox}
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

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {summary ? (
        <Section columns={4} gap="md" aria-label="Resumen">
          <KpiCard label="Checks OK" value={formatNumber(summary.ok)} tone="success" />
          <KpiCard
            label="Alertas"
            value={formatNumber(summary.warn)}
            tone={summary.warn > 0 ? 'warning' : 'neutral'}
          />
          <KpiCard
            label="Errores"
            value={formatNumber(summary.error)}
            tone={summary.error > 0 ? 'danger' : 'neutral'}
          />
          <KpiCard label="Total checks" value={formatNumber(data?.checks.length ?? 0)} />
        </Section>
      ) : null}

      <Tabs
        label="Filtrar por estado"
        variant="pill"
        value={filter}
        onValueChange={(id) => setFilter(id as StatusFilter)}
        items={[
          {
            id: 'all',
            label: 'Todos',
            badge: data ? String(data.checks.length) : undefined,
          },
          {
            id: 'error',
            label: STATUS_LABEL.error,
            badge: summary ? String(summary.error) : undefined,
          },
          {
            id: 'warn',
            label: STATUS_LABEL.warn,
            badge: summary ? String(summary.warn) : undefined,
          },
          {
            id: 'ok',
            label: STATUS_LABEL.ok,
            badge: summary ? String(summary.ok) : undefined,
          },
        ]}
      />

      <Section title="Checks de reconciliación">
        {loading && !data ? (
          <p className={styles.muted}>Cargando diagnósticos…</p>
        ) : checks.length === 0 ? (
          <p className={styles.muted}>Sin resultados para el filtro seleccionado.</p>
        ) : (
          <div className={styles.checkList}>
            {checks.map((check) => (
              <Card key={check.id} variant="outline" padding="md" className={styles.checkCard}>
                <div className={styles.checkHead}>
                  <div>
                    <h3>{check.label}</h3>
                    <p>{check.description}</p>
                  </div>
                  <div className={styles.checkMeta}>
                    <Badge tone={STATUS_TONE[check.status]} variant="soft" size="sm">
                      {STATUS_LABEL[check.status]}
                    </Badge>
                    <span className={styles.count}>
                      {check.count.toLocaleString('es-MX')} incidencias
                    </span>
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
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
