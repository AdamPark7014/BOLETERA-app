'use client';

/**
 * Alertas de fraude.
 *
 * Cambios de fondo: los filtros de severidad y estado los aplica el servidor
 * (`GET /fraud/flags?severity&status&limit&offset`), la resolución pide una nota
 * real en vez de escribir siempre "Revisado y aprobado por admin", y una lista
 * vacía ya no se confunde con un 403.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  formatNumber,
  type DataTableColumn,
} from '@boletera/ui';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import { resolveFraudFlag } from '@/lib/platform-api';
import { useToast } from '@/components/Toast/ToastProvider';
import { Notice, ResourceView } from '../orders/_ui/States';
import { useResource } from '../orders/_ui/useResource';
import { formatDateTime } from '../orders/_ui/format';
import {
  fraudStatusLabel,
  fraudTypeLabel,
  severityLabel,
  severityRank,
  severityTone,
  statusTone,
} from './_lib/labels';
import styles from './suite.module.scss';

type FraudFlag = {
  id: string;
  type: string;
  severity: string;
  score: number;
  reason: string;
  status: string;
  createdAt?: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  order?: { publicId: string } | null;
  orderId?: string | null;
  user?: { email: string } | null;
};

const SEVERITY_FILTERS = [
  { value: 'ALL', label: 'Toda severidad' },
  { value: 'CRITICAL', label: 'Crítica' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'LOW', label: 'Baja' },
] as const;

const STATUS_FILTERS = [
  { value: 'ALL', label: 'Todo estado' },
  { value: 'PENDING', label: 'Sin revisar' },
  { value: 'RESOLVED', label: 'Resuelta' },
] as const;


function isOpen(flag: FraudFlag): boolean {
  return flag.status !== 'RESOLVED' && flag.status !== 'FALSE_POSITIVE';
}

export default function FraudPage() {
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const resource = useResource<FraudFlag[]>(
    useCallback(
      async ({ token, signal }) => {
        const params = new URLSearchParams({ limit: '50' });
        if (severity !== 'ALL') params.set('severity', severity);
        if (status !== 'ALL') params.set('status', status);
        const res = await adminApi<{ data?: FraudFlag[] } | FraudFlag[]>(
          `/fraud/flags?${params.toString()}`,
          token,
          { signal },
        );
        return Array.isArray(res) ? res : (res.data ?? []);
      },
      [severity, status],
    ),
    { requiresOrg: false, deps: [severity, status] },
  );

  async function resolve(flag: FraudFlag) {
    const token = getStoredToken();
    if (!token) return;
    const resolution = window.prompt(
      `Resolución de la alerta ${fraudTypeLabel(flag.type)}. Queda registrada en la bitácora:`,
      '',
    );
    if (resolution === null) return;
    if (!resolution.trim()) {
      toast.error('Escribe la resolución: una alerta cerrada sin motivo no sirve para auditar.');
      return;
    }
    setBusy(flag.id);
    try {
      await resolveFraudFlag(token, flag.id, resolution.trim());
      toast.success('Alerta resuelta');
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.userMessage : 'No se pudo resolver la alerta');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Compliance"
        title="Fraude y cumplimiento"
        description="Alertas del motor de reglas, revisión manual y resolución con bitácora"
        actions={
          <Button
            type="button"
            variant="outline"
            loading={resource.refreshing}
            loadingLabel="Actualizando…"
            onClick={() => resource.reload()}
          >
            Actualizar
          </Button>
        }
      />

      <Notice tone="info" title="Alcance de esta lista">
        <p>
          El API todavía no filtra las alertas por organización, así que un usuario con permiso
          puede ver alertas de otros promotores. Verifica el folio antes de actuar.
        </p>
      </Notice>

      <div className={styles.toolbar}>
        <SegmentedControl
          label="Severidad"
          size="sm"
          options={SEVERITY_FILTERS}
          value={severity}
          onValueChange={setSeverity}
        />
        <SegmentedControl
          label="Estado"
          size="sm"
          options={STATUS_FILTERS}
          value={status}
          onValueChange={setStatus}
        />
      </div>

      <ResourceView resource={resource} context="las alertas de fraude" loadingRows={6}>
        {(flags) => (
          <FraudTable
            flags={flags}
            severity={severity}
            status={status}
            busy={busy}
            onResolve={resolve}
          />
        )}
      </ResourceView>
    </div>
  );
}

function FraudTable({
  flags,
  severity,
  status,
  busy,
  onResolve,
}: {
  flags: FraudFlag[];
  severity: string;
  status: string;
  busy: string | null;
  onResolve: (flag: FraudFlag) => void;
}) {
  const open = useMemo(() => flags.filter((f) => isOpen(f)), [flags]);
  const urgent = useMemo(
    () => flags.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH'),
    [flags],
  );
  const maxScore = useMemo(
    () => (flags.length > 0 ? Math.max(...flags.map((f) => f.score)) : 0),
    [flags],
  );

  const anyFilter = severity !== 'ALL' || status !== 'ALL';

  const columns = useMemo<readonly DataTableColumn<FraudFlag>[]>(
    () => [
      {
        key: 'type',
        header: 'Tipo',
        width: 200,
        sortValue: (row) => row.type,
        render: (row) => (
          <div className={styles.typeCell}>
            <span className={styles.typeLabel}>{fraudTypeLabel(row.type)}</span>
            {row.createdAt ? (
              <span className={styles.when}>{formatDateTime(row.createdAt)}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'severity',
        header: 'Severidad',
        width: 120,
        sortValue: (row) => severityRank(row.severity),
        render: (row) => (
          <Badge tone={severityTone(row.severity)} variant="soft" size="sm">
            {severityLabel(row.severity)}
          </Badge>
        ),
      },
      {
        key: 'score',
        header: 'Puntaje',
        width: 90,
        align: 'right',
        sortValue: (row) => row.score,
        render: (row) => (
          <span
            className={`${styles.score} ${row.severity === 'CRITICAL' ? styles.scoreCritical : ''}`}
          >
            {row.score}
          </span>
        ),
      },
      {
        key: 'order',
        header: 'Orden',
        width: 160,
        sortValue: (row) => row.order?.publicId ?? row.user?.email ?? '',
        render: (row) =>
          row.orderId ? (
            <Link href={`/orders/${row.orderId}`}>
              <code className={styles.folio}>{row.order?.publicId ?? 'Ver orden'}</code>
            </Link>
          ) : (
            <span className={styles.muted}>{row.user?.email ?? '—'}</span>
          ),
      },
      {
        key: 'reason',
        header: 'Motivo',
        width: 280,
        sortValue: (row) => row.reason,
        render: (row) => (
          <div className={styles.reason}>
            <span>{row.reason}</span>
            {row.resolution ? (
              <span className={styles.resolution}>Resolución: {row.resolution}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 140,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={statusTone(row.status)} variant="soft" size="sm">
            {fraudStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        key: 'action',
        header: 'Acción',
        width: 120,
        render: (row) =>
          isOpen(row) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              loading={busy === row.id}
              loadingLabel="Guardando…"
              onClick={() => onResolve(row)}
            >
              Resolver
            </Button>
          ) : (
            <span className={styles.muted}>—</span>
          ),
      },
    ],
    [busy, onResolve],
  );

  return (
    <>
      <Section columns={4} gap="md">
        <KpiCard label="Alertas cargadas" value={formatNumber(flags.length)} tone="accent" />
        <KpiCard
          label="Sin revisar"
          value={formatNumber(open.length)}
          tone={open.length > 0 ? 'warning' : 'neutral'}
          invertDelta
        />
        <KpiCard
          label="Críticas o altas"
          value={formatNumber(urgent.length)}
          tone={urgent.length > 0 ? 'danger' : 'neutral'}
          invertDelta
        />
        <KpiCard
          label="Puntaje máximo"
          value={flags.length > 0 ? formatNumber(maxScore) : '—'}
          hint="En la ventana cargada"
        />
      </Section>

      {open.length > 0 && (
        <Notice tone="danger" title={`${open.length} alerta(s) requieren revisión`}>
          <p>
            Prioriza severidad crítica o alta y verifica el folio de la orden antes de resolver.
            Cada cierre queda en la bitácora con la nota que escribas.
          </p>
        </Notice>
      )}

      <div className={styles.filterMeta}>
        <span>
          {flags.length} alerta(s) en esta ventana
          {anyFilter ? ' con los filtros activos' : ''}.
        </span>
      </div>

      <DataTable
        label="Alertas de fraude con tipo, severidad, puntaje, estado y motivo"
        columns={columns}
        data={flags}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
        empty={
          <EmptyState
            title={
              severity === 'ALL' && status === 'ALL'
                ? 'Sin alertas de fraude registradas'
                : 'Ninguna alerta con esos filtros'
            }
            description={
              severity === 'ALL' && status === 'ALL'
                ? 'El motor de reglas no ha marcado ninguna orden.'
                : 'Quita algún filtro para ver el resto.'
            }
          />
        }
      />
    </>
  );
}
