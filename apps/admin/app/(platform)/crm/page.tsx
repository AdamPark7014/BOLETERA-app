'use client';

import Link from 'next/link';
import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import { useCrmWorkspace } from '@/lib/queries/crm';
import { useSession as useLegacySession } from '@/lib/use-session';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount } from '../events/_ticket/read';
import { channelLabel } from '../dashboard/format';
import { buildCrmActivity } from './_lib/activity';
import {
  buildCustomerRows,
  buildSegmentCards,
  churnRiskCustomers,
  crmKpis,
  frequentBuyers,
  indexAiByEmail,
} from './_lib/derive';
import {
  daysAgoIso,
  formatChurnPct,
  formatMoney,
  formatRelativeDay,
  formatRfm,
  formatShare,
  rangeLabel,
} from './_lib/format';
import { aiSegmentLabel, CHURN_LABEL, priorityLabel, SEGMENT_LABEL } from './_lib/labels';
import { buildCrmRecommendations } from './_lib/recommendations';
import type { CrmCustomerRow, CrmRangeKey } from './_lib/types';
import { useCrmUrlState } from './_lib/use-crm-url-state';
import own from './crm.module.scss';

const RANGE_OPTIONS: { value: CrmRangeKey; label: string }[] = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

/** Cuántos clientes se pintan por tanda; la lista completa sigue filtrable. */
const PAGE = 50;

function failText(error: unknown): string {
  if (error instanceof ApiError) return `${error.userMessage} (${error.status})`;
  if (error instanceof Error && error.message) {
    // Express responde «Cannot GET /ruta» cuando el API no tiene la ruta.
    if (/^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(error.message))
      return 'el API no tiene esta ruta (404).';
    return error.message;
  }
  return 'No respondió.';
}

function deltaText(deltaPercent: number | null | undefined): string {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return 'sin base previa';
  const sign = deltaPercent > 0 ? '+' : '';
  return `${sign}${deltaPercent.toLocaleString('es-MX', { maximumFractionDigits: 1 })} % vs. periodo previo`;
}

function whenShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  });
}

export default function CrmPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <CrmBody />
      </AdminFrame>
    </Suspense>
  );
}

function CrmBody() {
  const session = useSession();
  const { can } = useLegacySession();
  const canRead = can('order:read');

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando CRM.</p>;
  if (!canRead) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>CRM</h1>
          <p className={styles.quiet}>
            Tu rol no incluye la lectura de pedidos que alimenta el CRM.
          </p>
        </header>
      </section>
    );
  }
  return <CrmDatos organizationId={session.orgId} />;
}

function CrmDatos({ organizationId }: { organizationId: string }) {
  const url = useCrmUrlState();
  const deferredQuery = useDeferredValue(url.q);
  const [shown, setShown] = useState(PAGE);

  const rangeBounds = useMemo(
    () => ({ from: daysAgoIso(Number(url.range)), to: new Date().toISOString() }),
    [url.range]
  );

  const workspace = useCrmWorkspace({
    organizationId,
    from: rangeBounds.from,
    to: rangeBounds.to,
    enabled: true,
  });

  const aiByEmail = useMemo(
    () => indexAiByEmail(workspace.aiSegmentation.data?.customers),
    [workspace.aiSegmentation.data?.customers]
  );
  const customers = useMemo(
    () => buildCustomerRows(workspace.orders.data ?? [], aiByEmail),
    [aiByEmail, workspace.orders.data]
  );
  const segments = useMemo(() => buildSegmentCards(customers), [customers]);
  const kpis = useMemo(() => crmKpis(customers), [customers]);
  const frequent = useMemo(() => frequentBuyers(customers), [customers]);
  const churnList = useMemo(() => churnRiskCustomers(customers), [customers]);
  const recommendations = useMemo(
    () =>
      buildCrmRecommendations({
        customers,
        kpis,
        waitlist: workspace.waitlist.data ?? [],
        apiKeys: workspace.apiKeys.data ?? [],
        ai: workspace.aiRecommendations.data?.recommendations,
      }),
    [
      customers,
      kpis,
      workspace.apiKeys.data,
      workspace.aiRecommendations.data?.recommendations,
      workspace.waitlist.data,
    ]
  );
  const activity = useMemo(
    () =>
      buildCrmActivity({ orders: workspace.orders.data ?? [], audit: workspace.audit.data ?? [] }),
    [workspace.audit.data, workspace.orders.data]
  );
  const series = useMemo(() => {
    const points = workspace.timeseries.data?.series[0]?.points ?? [];
    return points.map((point) => ({
      label: point.label ?? point.bucket.slice(5, 10),
      value: point.value,
    }));
  }, [workspace.timeseries.data]);

  const channelOptions = useMemo(
    () =>
      [...new Set(customers.flatMap((row) => [...row.channelList]))]
        .sort((a, b) => a.localeCompare(b, 'es-MX'))
        .map((value) => ({
          value,
          count: customers.filter((row) => row.channelList.includes(value)).length,
        })),
    [customers]
  );

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return customers
      .filter((row) => {
        if (url.segments.length && !url.segments.includes(row.segment)) return false;
        if (
          url.channels.length &&
          !url.channels.some((channel) => row.channelList.includes(channel))
        )
          return false;
        if (!needle) return true;
        return `${row.name} ${row.email} ${row.topEvent} ${SEGMENT_LABEL[row.segment]} ${formatRfm(row.rfm)}`
          .toLocaleLowerCase('es-MX')
          .includes(needle);
      })
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }, [customers, deferredQuery, url.channels, url.segments]);

  const visible = filtered.slice(0, shown);
  const selected = url.selectedId
    ? (customers.find((row) => row.id === url.selectedId) ?? null)
    : null;
  const loading = workspace.orders.isPending;
  const hasActiveFilters = Boolean(url.q) || url.segments.length > 0 || url.channels.length > 0;
  const waitlistMetricTotal = workspace.waitlistMetrics.data?.summary.pending ?? null;
  const completed = workspace.ordersMetrics.data?.kpis.completedOrders;

  // Fuentes auxiliares: si fallan se dice cuál y por qué, sin tapar el resto.
  const auxFailures: { source: string; error: unknown }[] = [
    { source: 'Segmentación con IA', error: workspace.aiSegmentation.error },
    { source: 'Recomendaciones con IA', error: workspace.aiRecommendations.error },
    { source: 'Métricas de pedidos', error: workspace.ordersMetrics.error },
    { source: 'Serie de pedidos', error: workspace.timeseries.error },
    {
      source: 'Lista de espera',
      error: workspace.waitlist.error ?? workspace.waitlistMetrics.error,
    },
    { source: 'Claves partner', error: workspace.apiKeys.error },
    { source: 'Auditoría', error: workspace.audit.error },
    { source: 'Analítica', error: workspace.analytics.error },
  ].filter((item) => item.error != null);

  function toggleChannel(channel: string) {
    const next = new Set(url.channels);
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);
    url.setFilterSelection({ segment: [...url.segments], channel: [...next] });
  }

  const activeKeys = (workspace.apiKeys.data ?? []).filter((key) => key.active).length;
  const waiting = (workspace.waitlist.data ?? []).filter((row) => {
    const status = row.status.toUpperCase();
    return (
      status === 'WAITING' || status === 'PENDING' || status === 'ACTIVE' || status === 'QUEUED'
    );
  }).length;
  const analyticsRevenue = workspace.analytics.data?.metrics?.totalRevenue ?? null;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>CRM</h1>
        <p className={styles.quiet}>
          Cartera armada con los pedidos completados de {rangeLabel(url.range).toLowerCase()}.
          Segmentos, riesgo de abandono y recomendaciones suman lista de espera, claves partner e IA
          cuando responden.
        </p>
      </header>

      <div className={own.toolbar}>
        <div className={own.seg}>
          <Segment
            label="Rango"
            value={url.range}
            options={RANGE_OPTIONS}
            onChange={url.setRange}
          />
        </div>
        <TicketButton
          variant="ghost"
          disabled={workspace.orders.isFetching}
          onClick={() => void workspace.refetchAll()}
        >
          {workspace.orders.isFetching ? 'Actualizando' : 'Actualizar'}
        </TicketButton>
      </div>

      {auxFailures.length > 0 ? (
        <div className={own.notes}>
          {auxFailures.map((item) => (
            <p key={item.source} className={styles.tertiary}>
              {item.source} no disponible: {failText(item.error)}
            </p>
          ))}
        </div>
      ) : null}

      {workspace.orders.error ? (
        <ApiErrorView
          error={workspace.orders.error}
          context="cargar los pedidos del CRM"
          onRetry={() => void workspace.orders.refetch()}
        />
      ) : loading && customers.length === 0 ? (
        <p className={styles.quiet}>Cargando clientes.</p>
      ) : (
        <>
          <div className={own.tiles} aria-label="Indicadores del CRM">
            <div className={own.tile}>
              <p className={styles.rowMeta}>Clientes</p>
              <p className={own.tileFigure}>{formatCount(kpis.customers)}</p>
              <p className={styles.tertiary}>{formatCount(kpis.active)} activos</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>LTV promedio</p>
              <p className={own.tileFigure}>{formatMoney(kpis.avgLtv)}</p>
              <p className={styles.tertiary}>Gasto total {formatMoney(kpis.spend)}</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Recurrencia</p>
              <p className={own.tileFigure}>{formatShare(kpis.retention)}</p>
              <p className={styles.tertiary}>Con 2 o más pedidos pagados</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Frecuentes</p>
              <p className={own.tileFigure}>{formatCount(kpis.frequent)}</p>
              <p className={styles.tertiary}>3 o más pedidos completados</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Riesgo de abandono alto</p>
              <p className={own.tileFigure}>{formatCount(kpis.churnHigh)}</p>
              <p className={styles.tertiary}>Por días sin comprar</p>
            </div>
            <div className={own.tile}>
              <p className={styles.rowMeta}>Pedidos completados</p>
              <p className={own.tileFigure}>
                {workspace.ordersMetrics.isPending ? '—' : formatCount(completed?.value ?? 0)}
              </p>
              <p className={styles.tertiary}>{deltaText(completed?.deltaPercent)}</p>
            </div>
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Segmentos</h2>
              <p className={styles.tertiary}>Tocar un segmento filtra la cartera.</p>
            </div>
            {customers.length === 0 ? (
              <p className={styles.quiet}>
                Sin clientes todavía. Aparecen cuando hay pedidos completados.{' '}
                <Link href="/orders" className={own.link}>
                  Ver órdenes
                </Link>{' '}
                ·{' '}
                <Link href="/events/new" className={own.link}>
                  Crear evento
                </Link>
              </p>
            ) : (
              <div className={styles.stack}>
                {segments.map((segment) => {
                  const active = url.segments.includes(segment.id);
                  return (
                    <button
                      key={segment.id}
                      type="button"
                      aria-pressed={active}
                      className={
                        active ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton
                      }
                      onClick={() => url.toggleSegment(segment.id)}
                    >
                      <span>
                        {segment.label} · {segment.description}
                      </span>
                      <span className={own.zoneSide}>
                        <span className={own.num}>{formatCount(segment.count)}</span>
                        <span className={styles.figure}>{formatMoney(segment.spend)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Compradores frecuentes</h2>
              <p className={styles.tertiary}>2 o más pedidos completados</p>
            </div>
            {frequent.length === 0 ? (
              <p className={styles.quiet}>Sin frecuentes aún.</p>
            ) : (
              <div className={styles.rows}>
                {frequent.map((row) => (
                  <div key={row.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{row.name}</p>
                      <p className={styles.rowMeta}>
                        {formatCount(row.completedOrders)} pedidos · {SEGMENT_LABEL[row.segment]}
                      </p>
                    </div>
                    <TicketButton variant="ghost" onClick={() => url.setSelectedId(row.id)}>
                      Ver perfil
                    </TicketButton>
                    <p className={styles.figure}>{formatMoney(row.totalSpend)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Riesgo de abandono</h2>
              <p className={styles.tertiary}>Por días sin comprar. No es un modelo predictivo.</p>
            </div>
            {churnList.length === 0 ? (
              <p className={styles.quiet}>Sin señales medias o altas.</p>
            ) : (
              <div className={styles.rows}>
                {churnList.map((row) => (
                  <div key={row.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{row.name}</p>
                      <p className={styles.rowMeta}>
                        {formatRelativeDay(row.lastOrderAt)} · LTV {formatMoney(row.totalSpend)}
                      </p>
                    </div>
                    <TicketButton variant="ghost" onClick={() => url.setSelectedId(row.id)}>
                      Ver perfil
                    </TicketButton>
                    <p className={own.state}>
                      {CHURN_LABEL[row.churnBand]} · {formatChurnPct(row.churnRisk)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Cartera</h2>
              <p className={styles.tertiary} role="status">
                {formatCount(filtered.length)} de {formatCount(customers.length)} clientes · por LTV
              </p>
            </div>
            <div className={own.filters}>
              <Field
                label="Buscar"
                kind="search"
                placeholder="Cliente, correo, RFM o evento"
                value={url.q}
                onChange={(event) => url.setSearch(event.target.value)}
              />
              {channelOptions.length > 0 ? (
                <div className={own.chips} role="group" aria-label="Canal">
                  {channelOptions.map((option) => {
                    const on = url.channels.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={on}
                        className={on ? own.chipOn : own.chip}
                        onClick={() => toggleChannel(option.value)}
                      >
                        {channelLabel(option.value)} · {formatCount(option.count)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {hasActiveFilters ? (
                <div className={own.line}>
                  <TicketButton variant="ghost" onClick={url.clearFilters}>
                    Limpiar filtros
                  </TicketButton>
                </div>
              ) : null}
            </div>
            {filtered.length === 0 ? (
              <p className={styles.quiet}>
                {customers.length === 0
                  ? 'Aún no hay cartera. Se arma con los pedidos de la organización.'
                  : 'Nada con ese criterio.'}
              </p>
            ) : (
              <div className={styles.stack}>
                {selected && !visible.some((row) => row.id === selected.id) ? (
                  <Cliente row={selected} open onToggle={() => url.setSelectedId(null)} />
                ) : null}
                {visible.map((row) => (
                  <Cliente
                    key={row.id}
                    row={row}
                    open={url.selectedId === row.id}
                    onToggle={() => url.setSelectedId(url.selectedId === row.id ? null : row.id)}
                  />
                ))}
                {filtered.length > shown ? (
                  <div>
                    <TicketButton
                      variant="secondary"
                      onClick={() => setShown((current) => current + PAGE)}
                    >
                      Mostrar {formatCount(Math.min(PAGE, filtered.length - shown))} más
                    </TicketButton>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Pedidos por día</h2>
              <p className={styles.tertiary}>{rangeLabel(url.range)}</p>
            </div>
            {workspace.timeseries.isPending ? (
              <p className={styles.quiet}>Cargando serie.</p>
            ) : series.length === 0 ? (
              <p className={styles.quiet}>Sin pedidos en el periodo.</p>
            ) : (
              <div className={styles.rows}>
                {series.map((point, index) => (
                  <div key={`${point.label}-${index}`} className={styles.row}>
                    <p className={styles.rowTitle}>{point.label}</p>
                    <span />
                    <p className={own.num}>{formatCount(point.value)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Recomendaciones</h2>
              <p className={styles.tertiary}>
                {workspace.aiRecommendations.data?.recommendations.length
                  ? 'De la cartera y de la IA'
                  : 'De los conteos observados'}
              </p>
            </div>
            {recommendations.length === 0 ? (
              <p className={styles.quiet}>Sin recomendaciones.</p>
            ) : (
              <div className={styles.rows}>
                {recommendations.slice(0, 8).map((rec) => (
                  <div key={rec.id} className={own.item}>
                    <p className={styles.rowMeta}>
                      Prioridad {priorityLabel(rec.priority).toLowerCase()} ·{' '}
                      {rec.source === 'ai' ? 'IA' : 'Derivada'}
                    </p>
                    <p className={styles.rowTitle}>{rec.title}</p>
                    <p className={styles.quiet}>{rec.rationale}</p>
                    <p className={styles.tertiary}>Acción: {rec.action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Señales de demanda</h2>
            </div>
            <div className={styles.rows}>
              <div className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>Lista de espera</p>
                  {typeof waitlistMetricTotal === 'number' ? (
                    <p className={styles.rowMeta}>
                      Métrica de pendientes {formatCount(waitlistMetricTotal)}
                    </p>
                  ) : null}
                </div>
                <span />
                <p className={styles.figure}>{formatCount(waiting)}</p>
              </div>
              <div className={styles.row}>
                <p className={styles.rowTitle}>Claves partner activas</p>
                <span />
                <p className={styles.figure}>{formatCount(activeKeys)}</p>
              </div>
              <div className={styles.row}>
                <p className={styles.rowTitle}>Ingreso del mes en analítica</p>
                <span />
                <p className={styles.figure}>
                  {analyticsRevenue != null ? formatMoney(analyticsRevenue) : '—'}
                </p>
              </div>
            </div>
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Actividad</h2>
              <p className={styles.tertiary}>Pedidos recientes y auditoría</p>
            </div>
            {workspace.audit.isPending && activity.length === 0 ? (
              <p className={styles.quiet}>Cargando actividad.</p>
            ) : activity.length === 0 ? (
              <p className={styles.quiet}>Sin actividad.</p>
            ) : (
              <div className={styles.rows}>
                {activity.map((item) => (
                  <div key={item.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>
                        {item.actor} {item.action}
                      </p>
                      <p className={styles.rowMeta}>
                        {item.target} · {whenShort(item.timestamp)}
                      </p>
                    </div>
                    <span />
                    <p className={own.num}>{item.detail ?? ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Límites de los datos</h2>
            </div>
            <ul className={own.limits}>
              <li>
                No hay API de CRM: cada perfil es la suma local de los pedidos de la organización.
              </li>
              <li>Los pedidos llegan sin paginar; LTV y RFM cubren solo la muestra recibida.</li>
              <li>
                El riesgo de abandono local sale de los días sin comprar; el de la IA se usa solo si
                el correo coincide con su segmentación.
              </li>
              <li>
                Lista de espera, partners y auditoría aportan contexto; no son un CRM de contactos.
              </li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function Cliente({
  row,
  open,
  onToggle,
}: {
  row: CrmCustomerRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.stack}>
      <button
        type="button"
        className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>
          {row.name} · {SEGMENT_LABEL[row.segment]}
        </span>
        <span className={styles.figure}>{formatMoney(row.totalSpend, row.currency)}</span>
      </button>
      {open ? (
        <div className={own.detail}>
          <div className={styles.rows}>
            <Dato name="Correo" value={row.email} />
            <Dato
              name="RFM"
              value={`${formatRfm(row.rfm)} · ${row.rfmScore.toLocaleString('es-MX', { maximumFractionDigits: 1 })}`}
            />
            <Dato
              name="Pedidos completados"
              value={`${formatCount(row.completedOrders)} de ${formatCount(row.ordersCount)}`}
            />
            <Dato
              name="Riesgo de abandono"
              value={
                row.aiChurnProbability != null
                  ? `${formatChurnPct(row.aiChurnProbability)} según IA`
                  : `${CHURN_LABEL[row.churnBand]} · ${formatChurnPct(row.churnRisk)}`
              }
            />
            {row.aiSegment ? (
              <Dato name="Segmento de IA" value={aiSegmentLabel(row.aiSegment)} />
            ) : null}
            <Dato name="Primera compra" value={formatRelativeDay(row.firstOrderAt)} />
            <Dato name="Última compra" value={formatRelativeDay(row.lastOrderAt)} />
            <Dato name="Canales" value={row.channels || '—'} />
            <Dato name="Evento top" value={row.topEvent || '—'} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Dato({ name, value }: { name: string; value: string }) {
  return (
    <div className={styles.row}>
      <p className={styles.rowMeta}>{name}</p>
      <span />
      <p className={own.value}>{value}</p>
    </div>
  );
}
