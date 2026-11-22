'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Field, TicketButton, formatTicketAmount } from '@boletera/ui';
import { adminApi, ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../_shared/api-state';
import { AdminFrame } from '../../_ticket/AdminFrame';
import { NotFound } from '../../_ticket/NotFound';
import { NoAccess } from '../../_ticket/NoAccess';
import { Segment } from '../../_ticket/controls';
import styles from '../../_ticket/frame.module.scss';
import own from './analytics.module.scss';

type SeriesPoint = { bucket: string; revenue: number; tickets: number };
type BreakdownRow = {
  key: string;
  label: string;
  orders: number;
  tickets: number;
  revenue: number;
};

type EventAnalytics = {
  eventId: string;
  title: string;
  range: { from: string; to: string };
  series: { minute: SeriesPoint[]; hour: SeriesPoint[]; day: SeriesPoint[] };
  funnel: { visits: number; holds: number; orders: number; paid: number };
  goal: {
    ticketsTarget: number | null;
    revenueTarget: number | null;
    ticketsSold: number;
    revenue: number;
    ticketsProgress: number;
    revenueProgress: number;
  };
  byChannel: BreakdownRow[];
  byPaymentMethod: BreakdownRow[];
  byZone: BreakdownRow[];
};

type TrackingReport = {
  eventId: string;
  links: {
    code: string;
    label: string;
    clicks: number;
    orders: number;
    tickets: number;
    revenue: number;
    known: boolean;
  }[];
};

type Grain = 'minute' | 'hour' | 'day';

const GRAIN_OPTIONS = [
  { value: 'day' as Grain, label: 'Día' },
  { value: 'hour' as Grain, label: 'Hora' },
  { value: 'minute' as Grain, label: 'Minuto' },
];

function money(n: number) {
  return formatTicketAmount(n);
}

function pct(n: number) {
  return `${Math.round(n * 100)} %`;
}

function SimpleBars({
  points,
  valueKey,
}: {
  points: SeriesPoint[];
  valueKey: 'revenue' | 'tickets';
}) {
  const max = Math.max(1, ...points.map((p) => p[valueKey]));
  const width = 560;
  const height = 160;
  const pad = 8;
  const barW = points.length ? (width - pad * 2) / points.length : 0;

  if (!points.length) {
    return <p className={styles.quiet}>Sin ventas en este periodo.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Ventas en el tiempo"
      className={own.chart}
    >
      {points.map((p, i) => {
        const h = ((p[valueKey] / max) * (height - 24)) | 0;
        const x = pad + i * barW;
        const y = height - 16 - h;
        return (
          <g key={p.bucket}>
            <rect
              x={x + 1}
              y={y}
              width={Math.max(1, barW - 2)}
              height={h}
              fill="var(--text)"
              opacity={0.85}
            />
          </g>
        );
      })}
    </svg>
  );
}

function FunnelSvg({ funnel }: { funnel: EventAnalytics['funnel'] }) {
  const stages = [
    { key: 'visits', label: 'Visitas', value: funnel.visits },
    { key: 'holds', label: 'Apartados', value: funnel.holds },
    { key: 'orders', label: 'Órdenes', value: funnel.orders },
    { key: 'paid', label: 'Pagadas', value: funnel.paid },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));
  const width = 560;
  const rowH = 36;

  return (
    <svg
      viewBox={`0 0 ${width} ${stages.length * rowH}`}
      role="img"
      aria-label="Embudo de compra"
      className={own.chart}
    >
      {stages.map((s, i) => {
        const w = Math.max(8, (s.value / max) * (width - 140));
        const y = i * rowH + 6;
        return (
          <g key={s.key}>
            <text x={0} y={y + 16} fill="var(--text-secondary)" fontSize="12">
              {s.label}
            </text>
            <rect x={100} y={y} width={w} height={24} rx={4} fill="var(--text)" opacity={0.8} />
            <text x={110 + w} y={y + 16} fill="var(--text)" fontSize="12">
              {s.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function EventAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <Body />
      </AdminFrame>
    </Suspense>
  );
}

function Body() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const canSee = hasCapability(session.role, 'analytics.view');
  const token = session.token;
  const [grain, setGrain] = useState<Grain>('day');
  const [data, setData] = useState<EventAnalytics | null>(null);
  const [report, setReport] = useState<TrackingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [ticketsGoal, setTicketsGoal] = useState('');
  const [revenueGoal, setRevenueGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      adminApi<EventAnalytics>(`/metrics/events/${id}/analytics`, token, {
        signal: controller.signal,
      }),
      adminApi<TrackingReport>(`/tracking-links/report?eventId=${encodeURIComponent(id)}`, token, {
        signal: controller.signal,
      }),
    ])
      .then(([analytics, links]) => {
        setData(analytics);
        setReport(links);
        setTicketsGoal(
          analytics.goal.ticketsTarget != null ? String(analytics.goal.ticketsTarget) : ''
        );
        setRevenueGoal(
          analytics.goal.revenueTarget != null ? String(analytics.goal.revenueTarget) : ''
        );
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause);
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, id, canSee, session.status, nonce]);

  const series = useMemo(() => {
    if (!data) return [];
    return data.series[grain] ?? [];
  }, [data, grain]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Analítica del evento</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error instanceof ApiError && error.isNotFound) {
    return <NotFound title="No encontramos este evento" href="/events" linkLabel="Ver eventos" />;
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Analítica del evento</h1>
        <p className={styles.quiet}>
          {data?.title ?? '…'} · <Link href={`/events/${id}`}>Volver al evento</Link>
        </p>
      </header>

      {error ? (
        <ApiErrorView
          error={error}
          context="abrir la analítica"
          onRetry={() => setNonce((n) => n + 1)}
        />
      ) : loading && !data ? (
        <div className={styles.stack} aria-busy="true" aria-label="Cargando analítica">
          <div className={styles.skeleton} style={{ height: 120 }} />
          <div className={styles.skeleton} style={{ height: 200 }} />
        </div>
      ) : data ? (
        <>
          <div className={own.toolbar}>
            <div className={own.seg}>
              <Segment label="Detalle" value={grain} options={GRAIN_OPTIONS} onChange={setGrain} />
            </div>
            <TicketButton
              variant="secondary"
              onClick={() => {
                if (!token) return;
                const base =
                  process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://127.0.0.1:4000/api/v1';
                void fetch(`${base}/metrics/events/${id}/analytics.csv`, {
                  headers: { Authorization: `Bearer ${token}` },
                })
                  .then(async (res) => {
                    if (!res.ok) throw new Error('No se pudo exportar');
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `analitica-${id}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch((cause: unknown) => setError(cause));
              }}
            >
              Exportar CSV
            </TicketButton>
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Meta de venta</h2>
            </div>
            <div className={styles.rows}>
              <div className={styles.row}>
                <p className={styles.rowTitle}>Boletos</p>
                <span />
                <p className={own.amount}>
                  {data.goal.ticketsSold}
                  {data.goal.ticketsTarget != null ? ` / ${data.goal.ticketsTarget}` : ''}{' '}
                  <span className={styles.quiet}>({pct(data.goal.ticketsProgress)})</span>
                </p>
              </div>
              <div className={styles.row}>
                <p className={styles.rowTitle}>Ingresos</p>
                <span />
                <p className={own.amount}>
                  {money(data.goal.revenue)}
                  {data.goal.revenueTarget != null
                    ? ` / ${money(data.goal.revenueTarget)}`
                    : ''}{' '}
                  <span className={styles.quiet}>({pct(data.goal.revenueProgress)})</span>
                </p>
              </div>
            </div>
            <div className={own.formRow}>
              <Field
                label="Meta de boletos"
                value={ticketsGoal}
                onChange={(e) => setTicketsGoal(e.target.value)}
                inputMode="numeric"
              />
              <Field
                label="Meta de ingresos"
                value={revenueGoal}
                onChange={(e) => setRevenueGoal(e.target.value)}
                inputMode="decimal"
              />
              <TicketButton
                disabled={saving || !token}
                onClick={() => {
                  if (!token) return;
                  setSaving(true);
                  setOkMsg(null);
                  adminApi(`/metrics/events/${id}/sales-goal`, token, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      tickets: ticketsGoal === '' ? null : Number(ticketsGoal),
                      revenue: revenueGoal === '' ? null : Number(revenueGoal),
                    }),
                  })
                    .then(() => {
                      setOkMsg('Meta guardada');
                      setNonce((n) => n + 1);
                    })
                    .catch((cause: unknown) => setError(cause))
                    .finally(() => setSaving(false));
                }}
              >
                Guardar meta
              </TicketButton>
            </div>
            {okMsg ? <p className={styles.quiet}>{okMsg}</p> : null}
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Ventas en el tiempo</h2>
            </div>
            <SimpleBars points={series} valueKey="revenue" />
          </div>

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Embudo</h2>
            </div>
            <FunnelSvg funnel={data.funnel} />
          </div>

          <Breakdown title="Por canal" rows={data.byChannel} />
          <Breakdown title="Por método de pago" rows={data.byPaymentMethod} />
          <Breakdown title="Por zona" rows={data.byZone} />

          <div className={own.block}>
            <div className={own.blockHead}>
              <h2 className={own.blockTitle}>Enlaces de seguimiento</h2>
            </div>
            <p className={styles.quiet}>
              Comparte la ficha con <code>?ref=CODIGO</code>. El comprador guarda el código 7 días.
            </p>
            <div className={own.formRow}>
              <Field
                label="Código"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="RADIO"
              />
              <Field
                label="Nombre"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Campaña radio"
              />
              <TicketButton
                disabled={saving || !token || !code || !label}
                onClick={() => {
                  if (!token) return;
                  setSaving(true);
                  setOkMsg(null);
                  adminApi(`/tracking-links`, token, {
                    method: 'POST',
                    body: JSON.stringify({ eventId: id, code, label }),
                  })
                    .then(() => {
                      setCode('');
                      setLabel('');
                      setOkMsg('Enlace creado');
                      setNonce((n) => n + 1);
                    })
                    .catch((cause: unknown) => setError(cause))
                    .finally(() => setSaving(false));
                }}
              >
                Crear enlace
              </TicketButton>
            </div>
            {!report?.links.length ? (
              <p className={styles.quiet}>Aún no hay enlaces ni ventas atribuidas.</p>
            ) : (
              <div className={styles.rows}>
                <div className={styles.row}>
                  <p className={styles.rowMeta}>Enlace</p>
                  <p className={styles.rowMeta}>Clics</p>
                  <p className={styles.rowMeta}>Ingresos</p>
                </div>
                {report.links.map((link) => (
                  <div key={link.code} className={styles.row}>
                    <p className={styles.rowTitle}>
                      {link.label} <span className={styles.quiet}>({link.code})</span>
                    </p>
                    <p className={own.num}>
                      {link.clicks} · {link.orders} órdenes
                    </p>
                    <p className={own.amount}>{money(link.revenue)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <div className={own.block}>
      <div className={own.blockHead}>
        <h2 className={own.blockTitle}>{title}</h2>
      </div>
      {!rows.length ? (
        <p className={styles.quiet}>Sin datos todavía.</p>
      ) : (
        <div className={styles.rows}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row}>
              <p className={styles.rowTitle}>{row.label}</p>
              <p className={own.num}>
                {row.orders} · {row.tickets} boletos
              </p>
              <p className={own.amount}>{money(row.revenue)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
