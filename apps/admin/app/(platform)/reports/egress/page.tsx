'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  formatDateTime,
  formatNumber,
} from '@boletera/ui';
import {
  downloadEgressOverviewCsv,
  getEgressOverview,
  type EgressOverviewResponse,
  type EgressOverviewVenue,
} from '@/lib/platform-api';
import platform from '../../_styles/platform.module.scss';
import orderStyles from '../../orders/orders.module.scss';
import { EmptyBlock, Notice } from '../../orders/_ui/States';
import reportStyles from '../reports.module.scss';
import styles from './egress.module.scss';

type StatusFilter = 'all' | EgressOverviewVenue['status'];

const STATUS_LABEL: Record<EgressOverviewVenue['status'], string> = {
  ok: 'OK',
  warn: 'Alerta',
  critical: 'Crítico',
  'no-network': 'Sin red',
  empty: 'Vacío',
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'critical', label: 'Críticos' },
  { value: 'warn', label: 'Alertas' },
  { value: 'ok', label: 'OK' },
  { value: 'no-network', label: 'Sin red' },
  { value: 'empty', label: 'Vacíos' },
] as const;

function fmtNum(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  return formatNumber(n, digits);
}

function statusClass(status: EgressOverviewVenue['status']) {
  if (status === 'ok') return styles.badgeOk;
  if (status === 'warn') return styles.badgeWarn;
  if (status === 'critical') return styles.badgeCritical;
  if (status === 'no-network') return styles.badgeNetwork;
  return styles.badgeEmpty;
}

export default function EgressOverviewPage() {
  const [data, setData] = useState<EgressOverviewResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    const token = localStorage.getItem('boletera_token');
    if (!token) {
      setError('Inicia sesión para ver el dashboard');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      setData(await getEgressOverview(token));
    } catch {
      setError('No se pudo cargar el resumen de egress');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const list = data?.venues ?? [];
    if (filter === 'all') return list;
    return list.filter((v) => v.status === filter);
  }, [data, filter]);

  const counts = data?.counts;
  const totalVenues = data?.venues.length ?? 0;
  const offlineCount =
    counts == null ? null : (counts.noNetwork ?? 0) + (counts.empty ?? 0);

  return (
    <div className={reportStyles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Egress por venue"
        description="Salud de circulación y vaciado en todos los venues de la organización"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              loading={loading}
              loadingLabel="Actualizando…"
              onClick={() => void load()}
            >
              Actualizar
            </Button>
            <Button
              type="button"
              loading={exporting}
              loadingLabel="Exportando…"
              disabled={!data}
              onClick={async () => {
                const token = localStorage.getItem('boletera_token');
                if (!token) return;
                try {
                  setExporting(true);
                  await downloadEgressOverviewCsv(token);
                } catch {
                  setError('No se pudo exportar el CSV');
                } finally {
                  setExporting(false);
                }
              }}
            >
              Exportar CSV
            </Button>
          </>
        }
      />

      {error ? <Notice tone="danger" title={error} /> : null}

      <Section columns={4} gap="md" className={reportStyles.kpiStrip}>
        <KpiCard
          label="OK"
          value={counts?.ok ?? '—'}
          tone="success"
          loading={loading}
          hint={totalVenues ? `${formatNumber(totalVenues)} venues analizados` : undefined}
        />
        <KpiCard
          label="Alertas"
          value={counts?.warn ?? '—'}
          tone="warning"
          loading={loading}
        />
        <KpiCard
          label="Críticos"
          value={counts?.critical ?? '—'}
          tone="danger"
          loading={loading}
        />
        <KpiCard
          label="Sin red / vacío"
          value={offlineCount ?? '—'}
          tone="neutral"
          loading={loading}
        />
      </Section>

      <section className={reportStyles.panel}>
        <div className={reportStyles.panelHead}>
          <h2>Detalle por venue</h2>
          <SegmentedControl
            label="Estado"
            size="sm"
            options={FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={filter}
            onValueChange={(value) => setFilter(value as StatusFilter)}
          />
        </div>

        {loading ? (
          <p className={styles.muted}>Analizando layouts…</p>
        ) : rows.length === 0 ? (
          <EmptyBlock
            title="No hay venues en este filtro"
            hint="Prueba otro estado o exporta el CSV para revisar offline."
          />
        ) : (
          <table className={platform.table}>
            <caption className={orderStyles.srOnly}>Salud de egress por venue</caption>
            <thead>
              <tr>
                <th scope="col">Estado</th>
                <th scope="col">Venue</th>
                <th scope="col" className={orderStyles.numeric}>
                  Secciones
                </th>
                <th scope="col" className={orderStyles.numeric}>
                  Sin acceso
                </th>
                <th scope="col" className={orderStyles.numeric}>
                  Vaciado (min)
                </th>
                <th scope="col" className={orderStyles.numeric}>
                  Ruta máx.
                </th>
                <th scope="col">Bottleneck</th>
                <th scope="col">
                  <span className={orderStyles.srOnly}>Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.venueId}>
                  <td>
                    <span className={`${styles.badge} ${statusClass(v.status)}`}>
                      {STATUS_LABEL[v.status]}
                    </span>
                    <div className={styles.reason}>{v.statusReason}</div>
                  </td>
                  <th scope="row">{v.venueName}</th>
                  <td className={orderStyles.numeric}>{v.sections}</td>
                  <td className={orderStyles.numeric}>{v.unreachable}</td>
                  <td className={orderStyles.numeric}>{fmtNum(v.clearanceMinutes)}</td>
                  <td className={orderStyles.numeric}>{fmtNum(v.maxPathLength, 0)}</td>
                  <td>
                    {v.topBottleneckUtilization != null
                      ? `${Math.round(v.topBottleneckUtilization * 100)}%`
                      : '—'}
                    {v.topBottleneckKind ? (
                      <span className={styles.muted}> · {v.topBottleneckKind}</span>
                    ) : null}
                  </td>
                  <td>
                    <Link href={`/venues/${v.venueId}/map`} className={platform.ghostBtn}>
                      Abrir mapa
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data?.generatedAt ? (
          <p className={reportStyles.footerNote}>
            Generado {formatDateTime(data.generatedAt)}
          </p>
        ) : null}
      </section>
    </div>
  );
}
