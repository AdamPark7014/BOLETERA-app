'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { TicketButton } from '@boletera/ui';
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
  { value: 'info', label: 'Info' },
];

function failText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.userMessage;
  if (error instanceof Error && error.message) {
    if (/^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(error.message))
      return 'El API no tiene esta ruta (404).';
    return error.message;
  }
  return fallback;
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
  if (days < 0) return 'Evento pasado';
  if (days === 0) return 'Hoy';
  return `Faltan ${formatCount(days)} d`;
}

function paceDeltaLabel(delta: number): string {
  const points = Math.round(delta * 1000) / 10;
  if (points === 0) return 'en línea con lo esperado';
  const sign = points > 0 ? '+' : '';
  return `${sign}${points.toLocaleString('es-MX', { maximumFractionDigits: 1 })} pp vs. esperado`;
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
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando tablero.</p>;
  if (!canSee) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Tablero</h1>
          <p className={styles.quiet}>Tu rol no incluye el tablero.</p>
        </header>
      </section>
    );
  }
  return <TableroDatos canChannels={hasCapability(session.role, 'marketing.manage')} />;
}

function TableroDatos({ canChannels }: { canChannels: boolean }) {
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>('7d');
  const [metric, setMetric] = useState<DashboardMetric>('revenue');
  const range = useMemo(() => buildDashboardRange(rangeKey), [rangeKey]);
  const data = useDashboardData(range, metric);

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Tablero</h1>
        <p className={styles.quiet}>
          {range.label} · MXN · Ciudad de México.{' '}
          {data.generatedAt
            ? `Datos generados ${formatRelative(data.generatedAt)}, comparados ${range.comparisonLabel.replace(/^vs\.\s*/, 'con ')}.`
            : 'Preparando el periodo.'}
        </p>
      </header>

      <div className={own.toolbar}>
        <div className={own.seg}>
          <Segment
            label="Periodo"
            value={range.key}
            options={RANGE_OPTIONS}
            onChange={setRangeKey}
          />
        </div>
        <TicketButton variant="ghost" disabled={data.isRefreshing} onClick={data.refetchAll}>
          {data.isRefreshing ? 'Actualizando' : 'Actualizar'}
        </TicketButton>
        <Link href="/events/new" className={own.link}>
          Crear evento
        </Link>
      </div>

      {data.failures.length > 0 ? (
        <div className={own.failures}>
          {data.failures.map((failure) => (
            <p key={failure.source} className={styles.danger} role="alert">
              {failure.source}: {failText(failure.error, 'No se pudo cargar.')}
            </p>
          ))}
          <div>
            <TicketButton variant="secondary" onClick={data.refetchAll}>
              Reintentar
            </TicketButton>
          </div>
        </div>
      ) : null}

      <Indicadores data={data} range={range} />
      <Proyeccion data={data} />
      <Serie data={data} range={range} metric={metric} onMetric={setMetric} />
      {canChannels ? <Canales data={data} /> : null}
      <Alertas data={data} />
      <Ritmo data={data} />
      <Actividad data={data} />
    </section>
  );
}

function Indicadores({ data, range }: { data: DashboardData; range: DashboardRange }) {
  const kpis = data.executive.data?.kpis;
  if (!kpis) {
    return data.executive.isPending ? (
      <p className={`${styles.quiet} ${own.block}`}>Cargando indicadores.</p>
    ) : null;
  }
  return (
    <div className={own.tiles} aria-label="Indicadores del periodo">
      {KPI_ORDER.map((key) => {
        const kpi = kpis[key];
        if (!kpi) return null;
        return (
          <div key={key} className={own.tile}>
            <p className={styles.rowMeta}>{kpi.label}</p>
            <p className={own.tileFigure}>{formatKpiValue(kpi)}</p>
            <p className={styles.tertiary}>
              {formatDeltaPercent(kpi.deltaPercent)} {range.comparisonLabel} · antes{' '}
              {formatKpiScalar(kpi.unit, kpi.previousValue)}
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
  const pace =
    projection.daysInPeriod > 0 ? (projection.daysElapsed / projection.daysInPeriod) * 100 : 0;
  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <h2 className={own.blockTitle}>Proyección del periodo</h2>
        <p className={styles.tertiary}>Método {projection.method.replace('_', ' ')}</p>
      </div>
      <div className={styles.rows}>
        <div className={styles.row}>
          <p className={styles.rowTitle}>Ingreso proyectado</p>
          <span />
          <p className={styles.figure}>{formatMxn(projection.projectedGrossRevenue)}</p>
        </div>
        <div className={styles.row}>
          <p className={styles.rowTitle}>Boletos proyectados</p>
          <span />
          <p className={styles.figure}>{formatCount(projection.projectedTicketsSold)}</p>
        </div>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Avance del periodo</p>
            <p className={styles.rowMeta}>
              Día {formatCount(projection.daysElapsed)} de {formatCount(projection.daysInPeriod)}
            </p>
          </div>
          <span />
          <p className={styles.figure}>{formatPercentPoints(pace)}</p>
        </div>
      </div>
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

  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <h2 className={own.blockTitle}>
          {meta.label} en el tiempo · {range.granularityLabel}
        </h2>
        <div className={own.seg}>
          <Segment
            label="Métrica"
            value={metric}
            options={[...METRIC_SEGMENTS]}
            onChange={onMetric}
          />
        </div>
      </div>
      {data.chartQuery.error && chartData.length === 0 ? (
        <p className={styles.danger} role="alert">
          {failText(data.chartQuery.error, 'No se pudo cargar la serie.')}
        </p>
      ) : loading ? (
        <p className={styles.quiet}>Cargando serie.</p>
      ) : chartData.length === 0 ? (
        <p className={styles.quiet}>Aún no hay {meta.noun} en este periodo.</p>
      ) : (
        <>
          <div className={own.tiles}>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Acumulado</p>
              <p className={own.tileFigure}>{format(stats.total)}</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Promedio</p>
              <p className={own.tileFigure}>{format(stats.average)}</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Pico{stats.peakLabel ? ` · ${stats.peakLabel}` : ''}</p>
              <p className={own.tileFigure}>{format(stats.peak)}</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>{range.comparisonShortLabel}</p>
              <p className={own.tileFigure}>{format(comparisonStats.total)}</p>
              <p className={styles.tertiary}>{formatDeltaPercent(delta)}</p>
            </div>
          </div>
          <div className={styles.rows}>
            <div className={own.series}>
              <p className={styles.rowMeta}>{range.granularity === 'hour' ? 'Hora' : 'Fecha'}</p>
              <p className={styles.rowMeta}>{meta.label}</p>
              <p className={styles.rowMeta}>{range.comparisonShortLabel}</p>
            </div>
            {chartData.map((datum, index) => (
              <div key={`${datum.label}-${index}`} className={own.series}>
                <p className={styles.rowTitle}>{datum.label}</p>
                <p className={own.num}>{format(datum.value)}</p>
                <p className={own.numQuiet}>{format(comparisonData[index]?.value ?? 0)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Canales({ data }: { data: DashboardData }) {
  const breakdown = data.executive.data?.revenueByChannel;
  const channels = channelRows(breakdown);
  const total = breakdown?.total ?? channels.reduce((sum, row) => sum + row.revenue, 0);
  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <h2 className={own.blockTitle}>Canales</h2>
        <Link href="/channels" className={own.link}>
          Configurar
        </Link>
      </div>
      {data.executive.isPending && !breakdown ? (
        <p className={styles.quiet}>Cargando canales.</p>
      ) : null}
      {!data.executive.isPending && channels.length === 0 ? (
        <p className={styles.quiet}>Sin ventas por canal en este periodo.</p>
      ) : null}
      {channels.length > 0 ? (
        <div className={styles.rows}>
          {channels.map((channel) => (
            <div key={channel.key} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{channel.label}</p>
                <p className={styles.rowMeta}>
                  {channel.orders > 0
                    ? `${formatCount(channel.orders)} órdenes`
                    : 'Sin órdenes contadas'}
                </p>
              </div>
              <p className={own.numQuiet}>{formatPercentPoints(channel.percent)}</p>
              <p className={styles.figure}>{formatMxn(channel.revenue)}</p>
            </div>
          ))}
          <div className={styles.row}>
            <p className={styles.rowTitle}>Total</p>
            <span />
            <p className={styles.figure}>{formatMxn(total)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Alertas({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState<AlertFilter>('all');
  const payload = data.alerts.data;
  const alerts = useMemo(() => filterAlerts(payload?.alerts, filter, 8), [payload?.alerts, filter]);
  const counts = payload?.countsBySeverity;
  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <div>
          <h2 className={own.blockTitle}>Alertas</h2>
          {counts ? (
            <p className={styles.tertiary}>
              {formatCount(counts.critical)} críticas · {formatCount(counts.warning)} atención ·{' '}
              {formatCount(counts.info)} info
            </p>
          ) : null}
        </div>
        <div className={own.seg}>
          <Segment label="Severidad" value={filter} options={ALERT_FILTERS} onChange={setFilter} />
        </div>
      </div>
      {data.alerts.isPending && !payload ? <p className={styles.quiet}>Cargando alertas.</p> : null}
      {payload && alerts.length === 0 ? (
        <p className={styles.quiet}>
          {filter === 'all' ? 'Sin alertas en este periodo.' : 'Nada con esa severidad.'}
        </p>
      ) : null}
      {alerts.length > 0 ? (
        <div className={styles.rows}>
          {alerts.map((alert) => (
            <div key={alert.id} className={own.alert}>
              <p className={styles.rowMeta}>
                {severityLabel(alert.severity)} · {formatRelative(alert.detectedAt)}
              </p>
              <p className={styles.rowTitle}>{alert.title}</p>
              <p className={styles.quiet}>{alert.explanation}</p>
              <p className={styles.tertiary}>{alert.suggestedAction}</p>
              <div>
                <Link href={alertActionHref(alert)} className={own.link}>
                  Ir a {alert.entityLabel ?? 'detalle'}
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Ritmo({ data }: { data: DashboardData }) {
  const payload = data.salesPace.data;
  const summary = paceSummary(payload, 6);
  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <div>
          <h2 className={own.blockTitle}>Ritmo de venta</h2>
          {summary.total > 0 ? (
            <p className={styles.tertiary}>
              {summary.atRisk > 0
                ? `${formatCount(summary.atRisk)} en riesgo · ${formatCount(summary.onTrack)} en ritmo`
                : `${formatCount(summary.onTrack)} de ${formatCount(summary.total)} en ritmo`}
            </p>
          ) : null}
        </div>
        <Link href="/events" className={own.link}>
          Ver eventos
        </Link>
      </div>
      {data.salesPace.isPending && !payload ? (
        <p className={styles.quiet}>Cargando ritmo.</p>
      ) : null}
      {payload && summary.rows.length === 0 ? (
        <p className={styles.quiet}>Sin eventos activos.</p>
      ) : null}
      {summary.rows.length > 0 ? (
        <div className={styles.rows}>
          {summary.rows.map((row) => (
            <Link
              key={row.eventId}
              href={`/events/${row.eventId}`}
              className={`${styles.row} ${own.rowLink}`}
            >
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{row.title}</p>
                <p className={styles.rowMeta}>
                  {daysLabel(row.daysUntilEvent)} · {formatPercentPoints(row.occupancyPercent)}{' '}
                  ocupación · {paceDeltaLabel(row.paceDelta)}
                </p>
              </div>
              <p className={own.numQuiet}>
                {formatCount(row.ticketsSold)} / {formatCount(row.totalCapacity)}
              </p>
              <p className={own.state}>{riskLabel(row.riskLevel)}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Actividad({ data }: { data: DashboardData }) {
  const overview = data.overview.data;
  const orders = recentOrders(overview, 8);
  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <div>
          <h2 className={own.blockTitle}>Actividad reciente</h2>
          {orders[0] ? (
            <p className={styles.tertiary}>Última orden {formatRelative(orders[0].createdAt)}</p>
          ) : null}
        </div>
        <Link href="/orders" className={own.link}>
          Ver órdenes
        </Link>
      </div>
      {data.overview.isPending && !overview ? (
        <p className={styles.quiet}>Cargando actividad.</p>
      ) : null}
      {overview && orders.length === 0 ? (
        <p className={styles.quiet}>Sin órdenes todavía.</p>
      ) : null}
      {orders.length > 0 ? (
        <div className={styles.rows}>
          {orders.map((order) => (
            <div key={order.publicId} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{order.eventTitle || 'Evento'}</p>
                <p className={styles.rowMeta}>
                  {channelLabel(order.channel || 'WEB')} · {orderStatusLabel(order.status)} ·{' '}
                  {formatRelative(order.createdAt)} ·{' '}
                  <span className={styles.mono}>{order.publicId}</span>
                </p>
              </div>
              <span />
              <p className={styles.figure}>{formatMxn(Number(order.totalAmount))}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
