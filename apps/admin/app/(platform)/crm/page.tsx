'use client';

import { formatDateTime as uiDateTime } from '@boletera/ui';
import Link from 'next/link';
import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import { useCrmWorkspace } from '@/lib/queries/crm';
import { useSession as useLegacySession } from '@/lib/use-session';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';

const ALL_CHANNELS = '__todos__';
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
  if (error instanceof ApiError) return error.userMessage;
  if (error instanceof Error && error.message) {
    // Express responde «Cannot GET /ruta» cuando el API no tiene la ruta.
    if (/^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(error.message))
      return 'esta función no está disponible todavía.';
    return error.message;
  }
  return 'No respondió.';
}

function whenShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return uiDateTime(date);
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
          <h1 className={styles.sectionTitle}>Clientes</h1>
          <p className={styles.quiet}>Tu rol no puede ver clientes.</p>
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
    { source: 'Métricas de órdenes', error: workspace.ordersMetrics.error },
    { source: 'Serie de órdenes', error: workspace.timeseries.error },
    {
      source: 'Lista de espera',
      error: workspace.waitlist.error ?? workspace.waitlistMetrics.error,
    },
    { source: 'Llaves de socios', error: workspace.apiKeys.error },
    { source: 'Auditoría', error: workspace.audit.error },
    { source: 'Analítica', error: workspace.analytics.error },
  ].filter((item) => item.error != null);

  const activeKeys = (workspace.apiKeys.data ?? []).filter((key) => key.active).length;
  const waiting = (workspace.waitlist.data ?? []).filter((row) => {
    const status = row.status.toUpperCase();
    return (
      status === 'WAITING' || status === 'PENDING' || status === 'ACTIVE' || status === 'QUEUED'
    );
  }).length;
  const analyticsRevenue = workspace.analytics.data?.metrics?.totalRevenue ?? null;

  const segmentTotal = segments.reduce((sum, segment) => sum + segment.spend, 0);
  const seriesMax = Math.max(1, ...series.map((point) => point.value));

  return (
    <section className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Clientes</h1>
          <p className={styles.quiet}>{rangeLabel(url.range)}</p>
        </div>
        <div className={styles.toolbar} style={{ alignItems: 'center' }}>
          <Segment
            label="Rango"
            value={url.range}
            options={RANGE_OPTIONS}
            onChange={url.setRange}
          />
          <TicketButton
            variant="ghost"
            disabled={workspace.orders.isFetching}
            onClick={() => void workspace.refetchAll()}
          >
            {workspace.orders.isFetching ? 'Actualizando' : 'Actualizar'}
          </TicketButton>
        </div>
      </header>

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
          context="cargar los clientes"
          onRetry={() => void workspace.orders.refetch()}
        />
      ) : loading && customers.length === 0 ? (
        <div className={styles.stack} aria-busy="true" aria-label="Cargando clientes">
          <div className={styles.skeleton} style={{ height: 120 }} />
          <div className={styles.skeleton} style={{ height: 360 }} />
        </div>
      ) : (
        <>
          <div className={styles.kpis} aria-label="Indicadores de clientes">
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Clientes</p>
              <p className={styles.kpiValue}>{formatCount(kpis.customers)}</p>
              <p className={styles.kpiNote}>{formatCount(kpis.active)} activos</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Gasto promedio</p>
              <p className={styles.kpiValue}>{formatMoney(kpis.avgLtv)}</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Vuelven a comprar</p>
              <p className={styles.kpiValue}>{formatShare(kpis.retention)}</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>En riesgo</p>
              <p
                className={styles.kpiValue}
                style={kpis.churnHigh > 0 ? { color: 'var(--warn)' } : undefined}
              >
                {formatCount(kpis.churnHigh)}
              </p>
            </div>
          </div>
          <div className={styles.kpisSecondary}>
            <div className={styles.kpiSmall}>
              <p className={styles.kpiLabel}>Frecuentes</p>
              <p className={styles.kpiSmallValue}>{formatCount(kpis.frequent)}</p>
            </div>
            <div className={styles.kpiSmall}>
              <p className={styles.kpiLabel}>Órdenes completadas</p>
              <p className={styles.kpiSmallValue}>
                {workspace.ordersMetrics.isPending ? '—' : formatCount(completed?.value ?? 0)}
              </p>
            </div>
            <div className={styles.kpiSmall}>
              <p className={styles.kpiLabel}>Gasto total</p>
              <p className={styles.kpiSmallValue}>{formatMoney(kpis.spend)}</p>
            </div>
          </div>

          {customers.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Aún no hay clientes en este periodo</p>
              <p className={styles.quiet}>Prueba con un rango más amplio.</p>
              <Link href="/orders" className={styles.ghostLink}>
                Ver órdenes
              </Link>
            </div>
          ) : null}

          <div className={styles.split}>
            <div className={`${styles.panel} ${styles.splitWide}`}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Segmentos</h2>
              </div>
              {segments.length === 0 ? (
                <p className={styles.quiet}>Sin segmentos todavía.</p>
              ) : (
                <ul className={own.segments}>
                  {segments.map((segment) => {
                    const active = url.segments.includes(segment.id);
                    const share = segmentTotal > 0 ? (segment.spend / segmentTotal) * 100 : 0;
                    return (
                      <li key={segment.id}>
                        <button
                          type="button"
                          aria-pressed={active}
                          className={active ? `${own.segment} ${own.segmentOn}` : own.segment}
                          onClick={() => url.toggleSegment(segment.id)}
                        >
                          <span className={own.segmentText}>
                            <strong>{segment.label}</strong>
                            <span className={styles.rowMeta}>{segment.description}</span>
                          </span>
                          <span className={own.segmentBar}>
                            <span className={styles.bar} style={{ display: 'block', height: 6 }}>
                              <span
                                className={styles.barFill}
                                style={{ display: 'block', width: `${Math.max(share, 1)}%` }}
                              />
                            </span>
                          </span>
                          <span className={own.segmentNum}>{formatCount(segment.count)}</span>
                          <span className={own.segmentMoney}>{formatMoney(segment.spend)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className={styles.splitNarrow}>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>En riesgo de no volver</h2>
                </div>
                {churnList.length === 0 ? (
                  <p className={styles.quiet}>Nadie con riesgo medio o alto.</p>
                ) : (
                  <ul className={own.mini}>
                    {churnList.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={own.miniRow}
                          onClick={() => url.setSelectedId(row.id)}
                        >
                          <span className={own.miniMain}>
                            <strong>{row.name}</strong>
                            <span className={styles.rowMeta}>
                              {formatRelativeDay(row.lastOrderAt)} · {formatMoney(row.totalSpend)}
                            </span>
                          </span>
                          <span
                            className={
                              row.churnBand === 'high' ? styles.chipDanger : styles.chipWarn
                            }
                          >
                            {CHURN_LABEL[row.churnBand]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>Compradores frecuentes</h2>
                </div>
                {frequent.length === 0 ? (
                  <p className={styles.quiet}>Aún nadie con 2 o más órdenes.</p>
                ) : (
                  <ul className={own.mini}>
                    {frequent.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={own.miniRow}
                          onClick={() => url.setSelectedId(row.id)}
                        >
                          <span className={own.miniMain}>
                            <strong>{row.name}</strong>
                            <span className={styles.rowMeta}>
                              {formatCount(row.completedOrders)} órdenes ·{' '}
                              {SEGMENT_LABEL[row.segment]}
                            </span>
                          </span>
                          <span className={own.segmentMoney}>{formatMoney(row.totalSpend)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Cartera</h2>
              <p className={styles.tertiary} role="status">
                {formatCount(filtered.length)} de {formatCount(customers.length)}
              </p>
            </div>
            <div className={own.filters}>
              <Field
                label="Buscar"
                kind="search"
                placeholder="Cliente, correo o evento"
                value={url.q}
                onChange={(event) => url.setSearch(event.target.value)}
              />
              {channelOptions.length > 0 ? (
                <div style={{ width: 'min(280px, 100%)' }}>
                  <SheetSelect
                    label="Canal"
                    value={url.channels[0] ?? ALL_CHANNELS}
                    placeholder="Todos los canales"
                    options={[
                      { value: ALL_CHANNELS, label: 'Todos los canales' },
                      ...channelOptions.map((option) => ({
                        value: option.value,
                        label: `${channelLabel(option.value)} · ${formatCount(option.count)}`,
                      })),
                    ]}
                    onChange={(next) =>
                      url.setFilterSelection({
                        segment: [...url.segments],
                        channel: next === ALL_CHANNELS ? [] : [next],
                      })
                    }
                  />
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
                  ? 'Aún no hay cartera en este periodo.'
                  : 'Ningún cliente coincide. Quita algún filtro.'}
              </p>
            ) : (
              <div className={styles.tableWrap} style={{ border: 0, maxHeight: 'none' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Cliente</th>
                      <th scope="col">Segmento</th>
                      <th scope="col" className={styles.num}>
                        Órdenes
                      </th>
                      <th scope="col">Última compra</th>
                      <th scope="col" className={styles.num}>
                        Gasto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected && !visible.some((row) => row.id === selected.id) ? (
                      <Cliente row={selected} open onToggle={() => url.setSelectedId(null)} />
                    ) : null}
                    {visible.map((row) => (
                      <Cliente
                        key={row.id}
                        row={row}
                        open={url.selectedId === row.id}
                        onToggle={() =>
                          url.setSelectedId(url.selectedId === row.id ? null : row.id)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filtered.length > shown ? (
              <div style={{ marginTop: 12 }}>
                <TicketButton
                  variant="secondary"
                  onClick={() => setShown((current) => current + PAGE)}
                >
                  Mostrar {formatCount(Math.min(PAGE, filtered.length - shown))} más
                </TicketButton>
              </div>
            ) : null}
          </div>

          <div className={styles.split}>
            <div className={`${styles.panel} ${styles.splitWide}`}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Órdenes por día</h2>
              </div>
              {workspace.timeseries.isPending ? (
                <div className={styles.skeleton} style={{ height: 200 }} />
              ) : series.length === 0 ? (
                <p className={styles.quiet}>Sin órdenes en el periodo.</p>
              ) : (
                <div
                  className={own.bars}
                  role="img"
                  aria-label={`Órdenes por día en ${rangeLabel(url.range).toLowerCase()}`}
                >
                  {series.map((point, index) => (
                    <div
                      key={`${point.label}-${index}`}
                      className={own.barCol}
                      title={`${point.label}: ${formatCount(point.value)}`}
                    >
                      <span className={own.barTrack}>
                        <span
                          className={own.barNow}
                          style={{ height: `${(point.value / seriesMax) * 100}%` }}
                        />
                      </span>
                      <span className={own.barLabel}>
                        {series.length > 12 && index % Math.ceil(series.length / 8) !== 0
                          ? ''
                          : point.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={`${styles.panel} ${styles.splitNarrow}`}>
              <h2 className={styles.panelTitle}>Señales de demanda</h2>
              <dl className={own.signals}>
                <div>
                  <dt>En lista de espera</dt>
                  <dd>
                    {formatCount(waiting)}
                    {typeof waitlistMetricTotal === 'number' && waitlistMetricTotal !== waiting ? (
                      <span className={styles.rowMeta}> · {formatCount(waitlistMetricTotal)}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Socios con llave activa</dt>
                  <dd>{formatCount(activeKeys)}</dd>
                </div>
                <div>
                  <dt>Ingreso del mes</dt>
                  <dd>{analyticsRevenue != null ? formatMoney(analyticsRevenue) : 'Sin dato'}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className={styles.split}>
            <div className={`${styles.panel} ${styles.splitWide}`}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Qué hacer</h2>
              </div>
              {recommendations.length === 0 ? (
                <p className={styles.quiet}>Sin recomendaciones por ahora.</p>
              ) : (
                <div className={own.recs}>
                  {recommendations.slice(0, 6).map((rec) => (
                    <div key={rec.id} className={own.rec}>
                      <span
                        className={
                          rec.priority === 'high'
                            ? styles.chipDanger
                            : rec.priority === 'medium'
                              ? styles.chipWarn
                              : styles.chip
                        }
                      >
                        Prioridad {priorityLabel(rec.priority).toLowerCase()}
                      </span>
                      <p className={styles.rowTitle}>{rec.title}</p>
                      <p className={styles.quiet}>{rec.rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={`${styles.panel} ${styles.splitNarrow}`}>
              <h2 className={styles.panelTitle}>Actividad reciente</h2>
              {workspace.audit.isPending && activity.length === 0 ? (
                <div className={styles.skeleton} style={{ height: 160 }} />
              ) : activity.length === 0 ? (
                <p className={styles.quiet}>Sin actividad.</p>
              ) : (
                <ul className={own.mini}>
                  {activity.slice(0, 8).map((item) => (
                    <li key={item.id} className={own.activity}>
                      <strong>
                        {item.actor} {item.action}
                      </strong>
                      <span className={styles.rowMeta}>
                        {item.target} · {whenShort(item.timestamp)}
                        {item.detail ? ` · ${item.detail}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
    <>
      <tr>
        <td>
          <button
            type="button"
            className={styles.rowToggle}
            aria-expanded={open}
            onClick={onToggle}
          >
            {row.name}
          </button>
          <p className={styles.rowMeta}>{row.email}</p>
        </td>
        <td>
          <span className={styles.chip}>{SEGMENT_LABEL[row.segment]}</span>
        </td>
        <td className={styles.num}>{formatCount(row.completedOrders)}</td>
        <td className={styles.quiet}>{formatRelativeDay(row.lastOrderAt)}</td>
        <td className={styles.num}>
          <strong>{formatMoney(row.totalSpend, row.currency)}</strong>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <dl className={own.facts}>
              <Dato name="Correo" value={row.email} />
              <Dato
                name="Valor del cliente"
                value={`${row.rfmScore.toLocaleString('es-MX', { maximumFractionDigits: 1 })} de 5`}
              />
              <Dato
                name="Órdenes completadas"
                value={`${formatCount(row.completedOrders)} de ${formatCount(row.ordersCount)}`}
              />
              <Dato
                name="Riesgo de no volver"
                value={
                  row.aiChurnProbability != null
                    ? `${formatChurnPct(row.aiChurnProbability)} según el asistente`
                    : `${CHURN_LABEL[row.churnBand]} · ${formatChurnPct(row.churnRisk)}`
                }
              />
              {row.aiSegment ? (
                <Dato name="Segmento del asistente" value={aiSegmentLabel(row.aiSegment)} />
              ) : null}
              <Dato name="Primera compra" value={formatRelativeDay(row.firstOrderAt)} />
              <Dato name="Canales" value={row.channels || '—'} />
              <Dato name="Evento favorito" value={row.topEvent || '—'} />
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Dato({ name, value }: { name: string; value: string }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}
