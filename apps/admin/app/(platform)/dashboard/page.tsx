'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError, adminApi, getStoredToken } from '@/lib/api';
import { getPlatformOverview, type PlatformOverview } from '@/lib/platform-api';
import { useSession } from '@/components/Session/SessionProvider';
import { RealtimeDashboardPanel } from '@/components/RealtimeDashboardPanel';
import type { Capability } from '@/lib/permissions';
import styles from './dashboard.module.scss';

const channelMeta: Record<string, { color: string; label: string }> = {
  WEB: { color: 'var(--bl-gray-600)', label: 'Web' },
  TAQUILLA: { color: 'var(--bl-gray-900)', label: 'Taquilla POS' },
  API: { color: 'var(--bl-gray-500)', label: 'API' },
  ADMIN: { color: 'var(--bl-gray-400)', label: 'Admin' },
  RESALE: { color: 'var(--bl-gray-700)', label: 'Reventa' },
};

function fmtCurrency(n: number | undefined) {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function StatIcon({ kind }: { kind: 'pulse' | 'cart' | 'cash' | 'terminal' }) {
  const path: Record<string, string> = {
    pulse: 'M2 12h4l2-6 4 12 3-8 2 4 2-2h3',
    cart: 'M6 4h12l2 6-7 10-7-10z M3 10h18 M9 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z M15 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
    cash: 'M2 7h20v10H2z M6 12h2 M14 12h4',
    terminal: 'M3 4h18v14H3z M7 9l2 2-2 2 M11 13h4 M9 21h6',
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={path[kind]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Atajos con su capacidad: ofrecer un enlace que dará 403 no es un atajo. */
const quickActions: {
  href: string;
  title: string;
  desc: string;
  icon: string;
  accent: string;
  cap: Capability;
}[] = [
  {
    href: '/events/new',
    title: 'Crear evento',
    desc: 'Nuevo show, mapa y ofertas',
    icon: 'M12 5v14M5 12h14',
    accent: 'ink',
    cap: 'events.manage',
  },
  {
    href: '/channels',
    title: 'Canales de venta',
    desc: 'Web, POS, API y reventa',
    icon: 'M4 12h4l3-7 4 14 3-7h2',
    accent: 'ink',
    cap: 'marketing.manage',
  },
  {
    href: '/scanner',
    title: 'Escáner',
    desc: 'Validación de acceso',
    icon: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M3 12h18',
    accent: 'ink',
    cap: 'access.scan',
  },
  {
    href: '/payouts',
    title: 'Liquidaciones',
    desc: 'Pagos a organizadores',
    icon: 'M3 7h18v10H3z M7 12h2 M15 12h2',
    accent: 'ink',
    cap: 'finance.view',
  },
];

/** Un aviso accionable de la primera pantalla. */
type Attention = {
  id: string;
  level: 'critical' | 'warn';
  title: string;
  detail: string;
  href?: string;
  cta?: string;
};

export default function DashboardPage() {
  const { can, organizationId, loading: sessionLoading } = useSession();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentsDemo, setPaymentsDemo] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getPlatformOverview(token));
    } catch (err) {
      // Antes esto era `.catch(() => {})`: el dashboard se quedaba en guiones y
      // parecía "no hay ventas hoy" cuando en realidad la petición había fallado.
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo cargar el resumen.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Estado de la pasarela: en demo no se está cobrando nada de verdad. */
  useEffect(() => {
    const token = getStoredToken();
    if (!token || !can('settings.payments')) return;
    adminApi<{ demo: boolean }>('/payments/config', token, { silent: true, noRetry: true })
      .then((c) => setPaymentsDemo(c.demo))
      .catch(() => setPaymentsDemo(null));
  }, [can]);

  const totalChannelRevenue =
    data?.channelBreakdown?.reduce((s, c) => s + c.revenue, 0) ?? 0;

  const visibleActions = useMemo(() => quickActions.filter((q) => can(q.cap)), [can]);

  /**
   * Lo que de verdad importa hoy. Solo entra aquí lo que tiene una acción
   * detrás; una cifra que nadie puede mover es adorno, no información.
   */
  const attention = useMemo<Attention[]>(() => {
    const items: Attention[] = [];

    if (!sessionLoading && !organizationId) {
      items.push({
        id: 'no-org',
        level: 'critical',
        title: 'Tu cuenta no tiene organización activa',
        detail:
          'El API rechaza todas las rutas de organización mientras siga así, incluso con rol de administrador. Pide que te asignen una.',
      });
    }

    if (paymentsDemo) {
      items.push({
        id: 'demo',
        level: 'critical',
        title: 'Banorte está en modo demo',
        detail: 'Los cobros son simulados: ninguna venta llega al banco ni se liquidará.',
        href: '/settings/payments',
        cta: 'Revisar pagos',
      });
    }

    const pending = data?.recentOrders?.filter((o) => o.status === 'PENDING').length ?? 0;
    if (pending > 0 && can('orders.view')) {
      items.push({
        id: 'pending',
        level: 'warn',
        title: `${pending} ${pending === 1 ? 'orden reciente pendiente' : 'órdenes recientes pendientes'}`,
        detail:
          'Siguen sin confirmarse. Si se acumulan, suele ser el IPN de Banorte sin llegar al API.',
        href: '/orders',
        cta: 'Ver órdenes',
      });
    }

    if (!loading && !error && data && data.activeEvents === 0 && can('events.view')) {
      items.push({
        id: 'no-events',
        level: 'warn',
        title: 'No hay eventos activos',
        detail: 'Sin eventos publicados no hay nada a la venta hoy.',
        href: '/events',
        cta: 'Ver eventos',
      });
    }

    return items;
  }, [sessionLoading, organizationId, paymentsDemo, data, can, loading, error]);

  return (
    <div className={styles.wrap}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Hoy</p>
          <h1>Resumen de operación</h1>
          <p className={styles.lead}>
            Eventos, órdenes, pagos Banorte y taquilla.
          </p>
        </div>
        <div className={styles.headerActions}>
          {can('events.manage') && (
            <Link href="/events/new" className={styles.primaryBtn}>
              + Crear evento
            </Link>
          )}
          {can('reports.view') && (
            <Link href="/reports" className={styles.ghostBtn}>
              Exportar reportes
            </Link>
          )}
        </div>
      </header>

      {/* Lo primero de la primera pantalla: lo que hay que atender hoy. */}
      {attention.length > 0 && (
        <section className={styles.attention} aria-labelledby="attention-title">
          <h2 id="attention-title" className={styles.attentionTitle}>
            Requiere atención
          </h2>
          <ul className={styles.attentionList}>
            {attention.map((a) => (
              <li
                key={a.id}
                className={a.level === 'critical' ? styles.attCritical : styles.attWarn}
              >
                <div>
                  {/* La severidad va en texto, no solo en el color del borde. */}
                  <span className={styles.attLevel}>
                    {a.level === 'critical' ? 'Crítico' : 'Revisar'}
                  </span>
                  <strong className={styles.attHeading}>{a.title}</strong>
                  <p className={styles.attDetail}>{a.detail}</p>
                </div>
                {a.href && a.cta && (
                  <Link href={a.href} className={styles.ghostBtn}>
                    {a.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className={styles.loadError} role="alert">
          <p>{error}</p>
          <button type="button" className={styles.ghostBtn} onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      )}

      <section className={styles.kpis} aria-busy={loading}>
        <article className={`${styles.kpi} ${styles.kpiHero}`}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: 'var(--bl-gray-100)', color: 'var(--bl-gray-900)' }}>
              <StatIcon kind="cash" />
            </span>
            <span className={styles.kpiLabel}>Ingresos hoy</span>
          </div>
          <strong className={styles.kpiVal}>{fmtCurrency(data?.revenueToday)}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>Actualizado al momento</span>
          </div>
        </article>

        <article className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: '#17171715', color: 'var(--bl-gray-900)' }}>
              <StatIcon kind="cart" />
            </span>
            <span className={styles.kpiLabel}>Órdenes hoy</span>
          </div>
          <strong className={styles.kpiVal}>{data?.ordersToday ?? '—'}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>Completadas hoy</span>
          </div>
        </article>

        <article className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: 'var(--bl-gray-100)', color: 'var(--bl-gray-600)' }}>
              <StatIcon kind="terminal" />
            </span>
            <span className={styles.kpiLabel}>Terminales POS</span>
          </div>
          <strong className={styles.kpiVal}>{data?.taquillaTerminals ?? '—'}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>Registradas en la org</span>
          </div>
        </article>

        <article className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: 'var(--bl-gray-100)', color: 'var(--bl-gray-700)' }}>
              <StatIcon kind="pulse" />
            </span>
            <span className={styles.kpiLabel}>Holds activos</span>
          </div>
          <strong className={styles.kpiVal}>{data?.activeHolds ?? '—'}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>
              {data?.activeEvents ?? 0} eventos · {data?.totalVenues ?? 0} venues
            </span>
          </div>
        </article>
      </section>

      {/* Real-time */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Métricas en vivo</h2>
            <p>Actualización cada 10 segundos vía SSE</p>
          </div>
          <span className={styles.sseBadge}>
            <span className={styles.liveDot} />
            stream activo
          </span>
        </div>
        <RealtimeDashboardPanel />
      </section>

      {/* Channels */}
      <div className={styles.twoCol}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Canales de venta hoy</h2>
              <p>Distribución por origen de orden</p>
            </div>
          </div>

          {data?.channelBreakdown?.length ? (
            <>
              <div className={styles.channelBar}>
                {data.channelBreakdown.map((c) => {
                  const pct = totalChannelRevenue
                    ? Math.round((c.revenue / totalChannelRevenue) * 100)
                    : 0;
                  const meta = channelMeta[c.channel] ?? channelMeta.WEB;
                  return (
                    <span
                      key={c.channel}
                      style={{ width: `${pct}%`, background: meta.color }}
                      title={`${meta.label} ${pct}%`}
                    />
                  );
                })}
              </div>
              <ul className={styles.channelList}>
                {data.channelBreakdown.map((c) => {
                  const pct = totalChannelRevenue
                    ? Math.round((c.revenue / totalChannelRevenue) * 100)
                    : 0;
                  const meta = channelMeta[c.channel] ?? channelMeta.WEB;
                  return (
                    <li key={c.channel}>
                      <span className={styles.channelDot} style={{ background: meta.color }} />
                      <span className={styles.channelName}>{meta.label}</span>
                      <span className={styles.channelOrders}>{c.orders} órdenes</span>
                      <strong className={styles.channelRev}>{fmtCurrency(c.revenue)}</strong>
                      <span className={styles.channelPct}>{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className={styles.empty}>
              <p>Sin ventas hoy todavía.</p>
              <Link href="/events" className={styles.ghostBtn}>
                Ver catálogo
              </Link>
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Atajos</h2>
              <p>Las acciones más frecuentes</p>
            </div>
          </div>
          <div className={styles.actionsGrid}>
            {visibleActions.map((q) => (
              <Link key={q.href} href={q.href} className={`${styles.actionCard} ${styles[q.accent]}`}>
                <div className={styles.actionIcon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d={q.icon} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <strong>{q.title}</strong>
                  <span>{q.desc}</span>
                </div>
                <span className={styles.actionArrow}>→</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Actividad reciente</h2>
            <p>Últimos eventos del sistema</p>
          </div>
          {can('orders.view') && (
            <Link href="/orders" className={styles.linkAll}>
              Ver órdenes →
            </Link>
          )}
        </div>
        <div className={styles.activity}>
          {data?.recentOrders?.length ? (
            data.recentOrders.slice(0, 5).map((o) => (
              <div key={o.publicId} className={styles.activityRow}>
                <span
                  className={styles.actTag}
                  style={{ color: 'var(--bl-gray-700)', background: 'var(--bl-gray-100)', borderColor: 'var(--bl-gray-200)' }}
                >
                  {o.channel || 'WEB'}
                </span>
                <span className={styles.actText}>
                  Orden {o.publicId} · {o.eventTitle || 'Evento'} ·{' '}
                  {fmtCurrency(Number(o.totalAmount))}
                </span>
                <span className={styles.actTime}>{o.status}</span>
              </div>
            ))
          ) : (
            <div className={styles.activityRow}>
              <span className={styles.actText}>
                Sin actividad reciente. Las órdenes aparecerán aquí cuando haya ventas.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
