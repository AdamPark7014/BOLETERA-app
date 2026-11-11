'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import {
  downloadEgressOverviewCsv,
  getEgressOverview,
  type EgressOverviewResponse,
  type EgressOverviewVenue,
} from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Segment } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount, formatWhen } from '../../events/_ticket/read';
import own from './egress.module.scss';

type StatusFilter = 'all' | EgressOverviewVenue['status'];

const STATUS_LABEL: Record<EgressOverviewVenue['status'], string> = {
  ok: 'OK',
  warn: 'Alerta',
  critical: 'Crítico',
  'no-network': 'Sin red',
  empty: 'Vacío',
};

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'critical', label: 'Críticos' },
  { value: 'warn', label: 'Alertas' },
  { value: 'ok', label: 'OK' },
  { value: 'no-network', label: 'Sin red' },
  { value: 'empty', label: 'Vacíos' },
];

function decimal(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-MX', { maximumFractionDigits: digits });
}

function venueMeta(venue: EgressOverviewVenue): string {
  const bottleneck =
    venue.topBottleneckUtilization != null
      ? `Cuello ${Math.round(venue.topBottleneckUtilization * 100)}%${venue.topBottleneckKind ? ` · ${venue.topBottleneckKind}` : ''}`
      : null;
  return [
    `${formatCount(venue.sections)} secciones`,
    `${formatCount(venue.unreachable)} sin acceso`,
    `Vaciado ${decimal(venue.clearanceMinutes)} min`,
    `Ruta máx. ${decimal(venue.maxPathLength, 0)}`,
    bottleneck,
  ]
    .filter((part): part is string => part != null)
    .join(' · ');
}

function failMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error && cause.message.trim()) return `${fallback} ${cause.message}`;
  return fallback;
}

export default function EgressOverviewPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EgressBody />
      </AdminFrame>
    </Suspense>
  );
}

function EgressBody() {
  const session = useSession();
  const [data, setData] = useState<EgressOverviewResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'reports.view');

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getEgressOverview(token)
      .then((payload) => {
        if (alive) setData(payload);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setData(null);
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, session.status, nonce]);

  const rows = useMemo(() => {
    const list = data?.venues ?? [];
    if (filter === 'all') return list;
    return list.filter((venue) => venue.status === filter);
  }, [data, filter]);

  async function exportCsv() {
    if (!token || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadEgressOverviewCsv(token);
    } catch (cause) {
      setExportError(failMessage(cause, 'No se exportó el CSV.'));
    } finally {
      setExporting(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Egress</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir egress"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if ((loading && !data) || !token) return <p className={styles.quiet}>Cargando egress.</p>;

  const counts = data?.counts;
  const total = data?.venues.length ?? 0;
  const offline = counts ? (counts.noNetwork ?? 0) + (counts.empty ?? 0) : null;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Egress</h1>
        <p className={styles.quiet}>
          Circulación y vaciado de cada recinto de la organización. {formatCount(total)} recintos
          analizados.
        </p>
      </header>

      <div className={own.actions}>
        <TicketButton
          variant="secondary"
          disabled={exporting || !data}
          onClick={() => void exportCsv()}
        >
          {exporting ? 'Exportando' : 'Exportar CSV'}
        </TicketButton>
        <TicketButton
          variant="ghost"
          disabled={loading}
          onClick={() => setNonce((current) => current + 1)}
        >
          {loading ? 'Actualizando' : 'Actualizar'}
        </TicketButton>
      </div>
      {exportError ? (
        <p className={styles.danger} role="alert">
          {exportError}
        </p>
      ) : null}

      <div className={own.counts}>
        <div className={own.count}>
          <p className={styles.rowMeta}>OK</p>
          <p className={own.figure}>{formatCount(counts?.ok ?? null)}</p>
        </div>
        <div className={own.count}>
          <p className={styles.rowMeta}>Alertas</p>
          <p className={own.figure}>{formatCount(counts?.warn ?? null)}</p>
        </div>
        <div className={own.count}>
          <p className={styles.rowMeta}>Críticos</p>
          <p className={own.figure}>{formatCount(counts?.critical ?? null)}</p>
        </div>
        <div className={own.count}>
          <p className={styles.rowMeta}>Sin red o vacío</p>
          <p className={own.figure}>{formatCount(offline)}</p>
        </div>
      </div>

      <header className={styles.sectionHead}>
        <p className={styles.rowTitle}>Detalle por recinto</p>
      </header>
      <div className={own.filter}>
        <div className={own.seg}>
          <Segment label="Estado" value={filter} options={FILTER_OPTIONS} onChange={setFilter} />
        </div>
      </div>

      {rows.length === 0 ? <p className={styles.quiet}>No hay recintos con ese estado.</p> : null}
      {rows.length > 0 ? (
        <div className={styles.rows}>
          {rows.map((venue) => (
            <div key={venue.venueId} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{venue.venueName}</p>
                <p className={styles.rowMeta}>{venueMeta(venue)}</p>
                <p className={styles.tertiary}>{venue.statusReason}</p>
              </div>
              <p className={own.state}>{STATUS_LABEL[venue.status]}</p>
              <Link href={`/venues/${venue.venueId}/map`} className={own.link}>
                Abrir mapa
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      {data?.generatedAt ? (
        <p className={`${styles.tertiary} ${own.generated}`}>
          Generado {formatWhen(data.generatedAt)}
        </p>
      ) : null}
    </section>
  );
}
