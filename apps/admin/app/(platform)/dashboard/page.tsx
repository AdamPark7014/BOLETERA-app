'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import type { MetricsAlert } from '@boletera/shared';
import { ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import {
  alertHref,
  channelLabel,
  formatCount,
  formatDeltaPercent,
  formatKpiScalar,
  formatKpiValue,
  formatMxn,
  formatPercentPoints,
  formatRelative,
  orderStatusLabel,
  riskLabel,
  severityLabel,
} from './format';
import {
  buildDashboardRange,
  RANGE_SEGMENTS,
  type DashboardRange,
  type DashboardRangeKey,
} from './range';
import {
  KPI_ORDER,
  METRIC_META,
  METRIC_SEGMENTS,
  channelRows,
  filterAlerts,
  metricFormatter,
  paceSummary,
  recentOrders,
  type AlertFilter,
  type DashboardMetric,
} from './_lib/derive';
import { useDashboardData, type DashboardData } from './_lib/use-dashboard-data';
import own from './dashboard.module.scss';

const RANGE_OPTIONS = RANGE_SEGMENTS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const ALERT_FILTERS: { value: AlertFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Críticas' },
  { value: 'warning', label: 'Atención' },
  { value: 'info', label: 'Avisos' },
];

const CHANNEL_COLORS = ['var(--gold)', 'var(--gold-soft)', '#8A7359', '#5C4E3E', '#3F362C'];

/** 403 = el rol no puede leer esa fuente: se oculta la pieza, no se muestra un error. */
function isForbidden(error: unknown): boolean {
  const status = (error as { status?: number | null } | null)?.status;
  if (status === 403) return true;
  return error instanceof Error && /forbidden/i.test(error.message);
}

function failText(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage;
  return 'No se pudo cargar. Intenta de nuevo en un momento.';
}

function alertActionHref(alert: MetricsAlert): string {
  return (
    alertHref(alert.entityType, alert.entityId) ??
    (alert.domain === 'fraud'
      ? '/fraud'
      : alert.domain === 'campaigns'
        ? '/campaigns'
        : alert.domain === 'orders'
          ? '/orders'
          : '/events')
  );
}

function daysLabel(days: number): string {
  if (days < 0) return 'Ya pasó';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${formatCount(days)} días`;
}

function riskChip(level: string): string {
  if (level === 'critical') return styles.chipDanger;
  if (level === 'at_risk' || level === 'watch') return styles.chipWarn;
  return styles.chipOk;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <TableroBody />
      </AdminFrame>
    </Suspense>
  );
}

function TableroBody() {
  const session = useSession();
  const canSee = hasCapability(session.role, 'dashboard.view');

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando inicio">
        <div className={styles.skeleton} style={{ height: 48, maxWidth: 320 }} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 340 }} />
      </div>
    );
  }
  if (!canSee) {
    return (
      <section className={styles.empty}>
        <h1 className={styles.emptyTitle}>Tu rol no incluye el tablero</h1>
        <p className={styles.quiet}>Abre una de las secciones del menú para empezar.</p>
      </section>
    );
  }
  return (
    <TableroDatos
      canChannels={hasCapability(session.role, 'marketing.manage')}
      canCreate={hasCapability(session.role, 'events.manage')}
    />
  );
}

function TableroDatos({ canChannels, canCreate }: { canChannels: boolean; canCreate: boolean }) {
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>('7d');
  const [metric, setMetric] = useState<DashboardMetric>('revenue');
  const range = useMemo(() => buildDashboardRange(rangeKey), [rangeKey]);
  const data = useDashboardData(range, metric);
  const failures = data.failures.filter((failure) => !isForbidden(failure.error));

  return (
    <section className={own.page}>
      <header className={own.head}>
        <div className={styles.sectionHead} style={{ marginBottom: 0 }}>
          <h1 className={styles.sectionTitle}>Inicio</h1>
          <p className={styles.quiet}>
            {range.label} · MXN
            {data.generatedAt ? ` · actualizado ${formatRelative(data.generatedAt)}` : ''}
          </p>
        </div>
        <div className={own.toolbar}>
          <Segment
            label="Periodo"
            value={range.key}
            options={RANGE_OPTIONS}
            onChange={setRangeKey}
          />
          <button
            type="button"
            className={own.ghostBtn}
            disabled={data.isRefreshing}
            onClick={data.refetchAll}
          >
            {data.isRefreshing ? 'Actualizando' : 'Actualizar'}
          </button>
          {canCreate ? (
            <Link href="/events/new" className={styles.goldLink}>
              Crear evento
            </Link>
          ) : null}
        </div>
      </header>

      {failures.length > 0 ? (
        <div className={own.failures} role="alert">
          {failures.map((failure) => (
            <p key={failure.source} className={styles.quiet}>
              <strong className={styles.danger}>{failure.source}:</strong> {failText(failure.error)}
            </p>
          ))}
          <button type="button" className={own.ghostBtn} onClick={data.refetchAll}>
            Reintentar
          </button>
        </div>
      ) : null}

      <Indicadores data={data} range={range} />

      <div className={styles.split}>
        <div className={`${styles.panel} ${styles.splitWide} ${own.chartPanel}`}>
          <Serie data={data} range={range} metric={metric} onMetric={setMetric} />
        </div>
        <div className={styles.splitNarrow}>
          {canChannels ? <Canales data={data} /> : null}
          <Proyeccion data={data} />
        </div>
      </div>

      <div className={styles.split}>
        <div className={`${styles.panel} ${styles.splitWide}`}>
          <Ritmo data={data} />
        </div>
        <div className={`${styles.panel} ${styles.splitNarrow}`}>
          <Actividad data={data} />
        </div>
      </div>

      <div className={styles.panel}>
        <Alertas data={data} />
      </div>
    </section>
  );
}

function Indicadores({ data, range }: { data: DashboardData; range: DashboardRange }) {
  const kpis = data.executive.data?.kpis;
  if (!kpis) {
    if (!data.executive.isPending) return null;
    return <div className={styles.skeleton} style={{ height: 124 }} aria-label="Cargando cifras" />;
  }
  return (
    <div className={styles.kpis} aria-label="Indicadores del periodo">
      {KPI_ORDER.map((key) => {
        const kpi = kpis[key];
        if (!kpi) return null;
        const delta = kpi.deltaPercent;
        return (
          <div key={key} className={styles.kpi}>
            <p className={styles.kpiLabel}>{kpi.label}</p>
            <p className={styles.kpiValue}>{formatKpiValue(kpi)}</p>
            <p className={styles.kpiNote}>
              {delta == null ? (
                <span>sin periodo previo para comparar</span>
              ) : (
                <>
                  <span className={delta >= 0 ? styles.up : styles.down}>
                    {formatDeltaPercent(delta)}
                  </span>
                  <span>
                    {range.comparisonLabel} · antes {formatKpiScalar(kpi.unit, kpi.previousValue)}
                  </span>
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Proyeccion({ data }: { data: DashboardData }) {
  const projection = data.executive.data?.projection;
  if (!projection) return null;
  const coherent = projection.daysInPeriod > 0 && projection.daysElapsed <= projection.daysInPeriod;
  const pace = coherent ? (projection.daysElapsed / projection.daysInPeriod) * 100 : null;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Cierre estimado del periodo</h2>
      </div>
      <div className={own.projection}>
        <div>
          <p className={styles.kpiLabel}>Ingreso</p>
          <p className={own.projFigure}>{formatMxn(projection.projectedGrossRevenue)}</p>
        </div>
        <div>
          <p className={styles.kpiLabel}>Boletos</p>
          <p className={own.projFigure}>{formatCount(projection.projectedTicketsSold)}</p>
        </div>
      </div>
      {pace != null ? (
        <div className={own.projPace}>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pace}%` }} />
          </div>
          <p className={styles.tertiary}>
            Van {formatCount(projection.daysElapsed)} de {formatCount(projection.daysInPeriod)} días
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Serie({
  data,
  range,
  metric,
  onMetric,
}: {
  data: DashboardData;
  range: DashboardRange;
  metric: DashboardMetric;
  onMetric: (next: DashboardMetric) => void;
}) {
  const meta = METRIC_META[metric];
  const format = metricFormatter(metric);
  const { chartData, comparisonData, stats, comparisonStats } = data;
  const loading = data.chartQuery.isPending && chartData.length === 0;
  const delta =
    comparisonStats.total > 0
      ? ((stats.total - comparisonStats.total) / comparisonStats.total) * 100
      : null;
  const max = Math.max(1, ...chartData.map((d) => d.value), ...comparisonData.map((d) => d.value));

  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>
            {meta.label} por {range.granularity === 'hour' ? 'hora' : 'día'}
          </h2>
          {chartData.length > 0 ? (
            <p className={styles.kpiNote} style={{ marginTop: 4 }}>
              <span>
                Total <strong className={own.strong}>{format(stats.total)}</strong>
              </span>
              {delta != null ? (
                <span className={delta >= 0 ? styles.up : styles.down}>
                  {formatDeltaPercent(delta)} {range.comparisonLabel}
                </span>
              ) : null}
              {stats.peakLabel ? <span>pico {stats.peakLabel}</span> : null}
            </p>
          ) : null}
        </div>
        <Segment
          label="Métrica"
          value={metric}
          options={[...METRIC_SEGMENTS]}
          onChange={onMetric}
        />
      </div>
      {data.chartQuery.error && chartData.length === 0 && !isForbidden(data.chartQuery.error) ? (
        <p className={styles.danger} role="alert">
          {failText(data.chartQuery.error)}
        </p>
      ) : loading ? (
        <div className={styles.skeleton} style={{ height: 260 }} aria-label="Cargando gráfica" />
      ) : chartData.length === 0 ? (
        <p className={styles.quiet}>Aún no hay {meta.noun} en este periodo.</p>
      ) : (
        <>
          <div className={own.legend}>
            <span>
              <span className={own.swatchNow} aria-hidden="true" />
              Este periodo
            </span>
            <span>
              <span className={own.swatchPrev} aria-hidden="true" />
              {range.comparisonShortLabel}
            </span>
          </div>
          <div
            className={own.bars}
            role="img"
            aria-label={`${meta.label}: total ${format(stats.total)} en ${chartData.length} cortes`}
          >
            {chartData.map((datum, index) => {
              const prev = comparisonData[index]?.value ?? 0;
              return (
                <div
                  key={`${datum.label}-${index}`}
                  className={own.barCol}
                  title={`${datum.label}: ${format(datum.value)} · antes ${format(prev)}`}
                >
                  <div className={own.barPair}>
                    <span className={own.barPrev} style={{ height: `${(prev / max) * 100}%` }} />
                    <span
                      className={own.barNow}
                      style={{ height: `${(datum.value / max) * 100}%` }}
                    />
                  </div>
                  <span className={own.barLabel}>
                    {chartData.length > 12 && index % Math.ceil(chartData.length / 8) !== 0
                      ? ''
                      : datum.label}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function Canales({ data }: { data: DashboardData }) {
  const breakdown = data.executive.data?.revenueByChannel;
  const channels = channelRows(breakdown);
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Por canal</h2>
        <Link href="/channels" className={styles.panelLink}>
          Configurar
        </Link>
      </div>
      {data.executive.isPending && !breakdown ? (
        <div className={styles.skeleton} style={{ height: 120 }} aria-label="Cargando canales" />
      ) : channels.length === 0 ? (
        <p className={styles.quiet}>Sin ventas por canal en este periodo.</p>
      ) : (
        <ul className={own.channels}>
          {channels.map((channel, index) => (
            <li key={channel.key} className={own.channel}>
              <div className={own.channelHead}>
                <span>{channel.label}</span>
                <span className={own.channelNum}>
                  {formatMxn(channel.revenue)} · {formatPercentPoints(channel.percent)}
                </span>
              </div>
              <div className={styles.bar}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${Math.max(channel.percent, 2)}%`,
                    background: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Alertas({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState<AlertFilter>('all');
  const payload = data.alerts.data;
  const alerts = useMemo(() => filterAlerts(payload?.alerts, filter, 8), [payload?.alerts, filter]);
  const counts = payload?.countsBySeverity;
  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Alertas</h2>
          {counts ? (
            <p className={styles.kpiNote} style={{ marginTop: 4 }}>
              <span className={counts.critical > 0 ? styles.chipDanger : styles.chip}>
                {formatCount(counts.critical)} críticas
              </span>
              <span className={counts.warning > 0 ? styles.chipWarn : styles.chip}>
                {formatCount(counts.warning)} de atención
              </span>
            </p>
          ) : null}
        </div>
        <Segment label="Severidad" value={filter} options={ALERT_FILTERS} onChange={setFilter} />
      </div>
      {data.alerts.isPending && !payload ? (
        <div className={styles.skeleton} style={{ height: 120 }} aria-label="Cargando alertas" />
      ) : null}
      {!payload && !data.alerts.isPending ? (
        <p className={styles.quiet}>Las alertas no están disponibles para tu rol.</p>
      ) : null}
      {payload && alerts.length === 0 ? (
        <p className={styles.quiet}>
          {filter === 'all'
            ? 'Todo en orden: sin alertas en este periodo.'
            : 'Nada con esa severidad.'}
        </p>
      ) : null}
      {alerts.length > 0 ? (
        <ul className={own.alerts}>
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={
                alert.severity === 'critical'
                  ? own.alertCritical
                  : alert.severity === 'warning'
                    ? own.alertWarn
                    : own.alert
              }
            >
              <p className={styles.rowMeta}>
                {severityLabel(alert.severity)} · {formatRelative(alert.detectedAt)}
              </p>
              <p className={styles.rowTitle}>{alert.title}</p>
              <p className={styles.quiet}>{alert.explanation}</p>
              <Link href={alertActionHref(alert)} className={styles.panelLink}>
                {alert.suggestedAction || `Ir a ${alert.entityLabel ?? 'detalle'}`}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Ritmo({ data }: { data: DashboardData }) {
  const payload = data.salesPace.data;
  const summary = paceSummary(payload, 6);
  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Ritmo de venta por evento</h2>
          {summary.total > 0 ? (
            <p className={styles.tertiary}>
              {summary.atRisk > 0
                ? `${formatCount(summary.atRisk)} en riesgo · ${formatCount(summary.onTrack)} en ritmo`
                : `${formatCount(summary.onTrack)} de ${formatCount(summary.total)} en ritmo`}
            </p>
          ) : null}
        </div>
        <Link href="/events" className={styles.panelLink}>
          Ver eventos
        </Link>
      </div>
      {data.salesPace.isPending && !payload ? (
        <div className={styles.skeleton} style={{ height: 200 }} aria-label="Cargando ritmo" />
      ) : null}
      {payload && summary.rows.length === 0 ? (
        <p className={styles.quiet}>No hay eventos activos en este periodo.</p>
      ) : null}
      {summary.rows.length > 0 ? (
        <div className={own.paceTable} role="table" aria-label="Ritmo de venta">
          <div className={own.paceHead} role="row">
            <span role="columnheader">EVENTO</span>
            <span role="columnheader">VENDIDO</span>
            <span role="columnheader" className={own.right}>
              ESTADO
            </span>
          </div>
          {summary.rows.map((row) => {
            const pct = Math.min(100, Math.max(0, row.occupancyPercent));
            return (
              <Link
                key={row.eventId}
                href={`/events/${row.eventId}`}
                className={own.paceRow}
                role="row"
              >
                <span role="cell" className={own.paceMain}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowMeta}>{daysLabel(row.daysUntilEvent)}</span>
                </span>
                <span role="cell" className={own.paceBar}>
                  <span className={styles.bar} style={{ flex: 1, height: 6 }}>
                    <span
                      className={styles.barFill}
                      style={{ display: 'block', width: `${pct}%` }}
                    />
                  </span>
                  <span className={own.paceNum}>
                    {formatCount(row.ticketsSold)} / {formatCount(row.totalCapacity)}
                  </span>
                </span>
                <span role="cell" className={own.right}>
                  <span className={riskChip(row.riskLevel)}>{riskLabel(row.riskLevel)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

function Actividad({ data }: { data: DashboardData }) {
  const overview = data.overview.data;
  const orders = recentOrders(overview, 7);
  if (!overview && !data.overview.isPending) {
    return (
      <>
        <h2 className={styles.panelTitle}>Ventas recientes</h2>
        <p className={styles.quiet}>El detalle de órdenes no está disponible para tu rol.</p>
      </>
    );
  }
  return (
    <>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Ventas recientes</h2>
        <Link href="/orders" className={styles.panelLink}>
          Ver órdenes
        </Link>
      </div>
      {data.overview.isPending && !overview ? (
        <div className={styles.skeleton} style={{ height: 200 }} aria-label="Cargando ventas" />
      ) : null}
      {overview && orders.length === 0 ? (
        <p className={styles.quiet}>Todavía no hay órdenes.</p>
      ) : null}
      {orders.length > 0 ? (
        <ul className={own.activity}>
          {orders.map((order) => (
            <li key={order.publicId} className={own.activityRow}>
              <span className={own.activityMain}>
                <span className={own.activityTitle}>{order.eventTitle || 'Evento'}</span>
                <span className={styles.rowMeta}>
                  {channelLabel(order.channel || 'WEB')} · {orderStatusLabel(order.status)} ·{' '}
                  {formatRelative(order.createdAt)}
                </span>
              </span>
              <span
                className={
                  order.status === 'REFUNDED' || order.status === 'CANCELLED'
                    ? `${own.activityAmount} ${own.refunded}`
                    : own.activityAmount
                }
              >
                {formatMxn(Number(order.totalAmount))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
