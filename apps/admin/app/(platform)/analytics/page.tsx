'use client';

/**
 * Analítica del promotor.
 *
 * `/analytics/promoters/:organizationId/dashboard` exige JWT, rol y pertenencia
 * a la organización. El API acepta `DAY | WEEK | MONTH` como periodo.
 */

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatTicketAmount } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount } from '../events/_ticket/read';
import own from './analytics.module.scss';

type Period = 'DAY' | 'WEEK' | 'MONTH';

const PERIODS: { value: Period; label: string; phrase: string }[] = [
  { value: 'DAY', label: 'Día', phrase: 'hoy' },
  { value: 'WEEK', label: 'Semana', phrase: 'esta semana' },
  { value: 'MONTH', label: 'Mes', phrase: 'este mes' },
];

const PERIOD_OPTIONS = PERIODS.map(({ value, label }) => ({ value, label }));

type PromoterDashboard = {
  organizationId: string;
  name?: string;
  period?: string;
  dateRange?: { startDate: string; endDate: string };
  metrics?: {
    totalOrders?: number;
    totalTicketsSold?: number;
    totalRevenue?: number;
    commission?: number;
    netRevenue?: number;
    currency?: string;
  };
  topEvents?: { eventId: string; eventTitle: string; revenue: number; orders: number }[];
};

/** Monto completo con dos decimales; la moneda se nombra solo si no es MXN. */
function money(value: number | null | undefined, currency: string): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const body = formatTicketAmount(n);
  return currency === 'MXN' ? body : `${body} ${currency}`;
}

function count(value: number | null | undefined): string {
  return formatCount(typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

function day(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' });
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <AnaliticaBody />
      </AdminFrame>
    </Suspense>
  );
}

function AnaliticaBody() {
  const session = useSession();
  const [period, setPeriod] = useState<Period>('MONTH');
  const [data, setData] = useState<PromoterDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const orgId = session.status === 'ready' ? session.orgId : null;
  const canSee = hasCapability(session.role, 'analytics.view');

  useEffect(() => {
    if (!token || !orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    adminApi<PromoterDashboard>(`/analytics/promoters/${orgId}/dashboard?period=${period}`, token, {
      signal: controller.signal,
    })
      .then((payload) => setData(payload))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, orgId, canSee, session.status, period, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Analítica</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }

  const phrase = PERIODS.find((item) => item.value === period)?.phrase ?? '';

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Analítica</h1>
        <p className={styles.quiet}>
          Ventas {phrase}
          {data?.dateRange
            ? ` · ${day(data.dateRange.startDate)} – ${day(data.dateRange.endDate)}`
            : ''}
          {data?.name ? ` · ${data.name}` : ''}
        </p>
      </header>
      <div className={own.toolbar}>
        <div className={own.seg}>
          <Segment label="Periodo" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
        </div>
      </div>
      {error ? (
        <ApiErrorView
          error={error}
          context="abrir la analítica"
          onRetry={() => setNonce((current) => current + 1)}
        />
      ) : loading && !data ? (
        <p className={styles.quiet}>Cargando analítica.</p>
      ) : data ? (
        <Resumen data={data} />
      ) : null}
    </section>
  );
}

function Resumen({ data }: { data: PromoterDashboard }) {
  const metrics = data.metrics ?? {};
  const currency = (metrics.currency || 'MXN').toUpperCase();
  const topEvents = data.topEvents ?? [];
  const empty = !metrics.totalOrders && !metrics.totalRevenue && topEvents.length === 0;

  if (empty) {
    return (
      <p className={styles.quiet}>
        Sin ventas en este periodo. Prueba uno más amplio o revisa que el evento ya esté en venta.
      </p>
    );
  }

  return (
    <>
      <div className={own.block}>
        <div className={own.blockHead}>
          <h2 className={own.blockTitle}>Indicadores del periodo</h2>
        </div>
        <div className={styles.rows}>
          <div className={styles.row}>
            <p className={styles.rowTitle}>Ingresos brutos</p>
            <span />
            <p className={own.amount}>{money(metrics.totalRevenue, currency)}</p>
          </div>
          <div className={styles.row}>
            <p className={styles.rowTitle}>Comisión</p>
            <span />
            <p className={own.amount}>{money(metrics.commission, currency)}</p>
          </div>
          <div className={styles.row}>
            <p className={styles.rowTitle}>Neto al promotor</p>
            <span />
            <p className={own.amount}>{money(metrics.netRevenue, currency)}</p>
          </div>
          <div className={styles.row}>
            <p className={styles.rowTitle}>Órdenes</p>
            <span />
            <p className={own.amount}>{count(metrics.totalOrders)}</p>
          </div>
          <div className={styles.row}>
            <p className={styles.rowTitle}>Boletos vendidos</p>
            <span />
            <p className={own.amount}>{count(metrics.totalTicketsSold)}</p>
          </div>
        </div>
      </div>

      <div className={own.block}>
        <div className={own.blockHead}>
          <h2 className={own.blockTitle}>Eventos con más ingresos</h2>
          <Link href="/events" className={own.link}>
            Ver eventos
          </Link>
        </div>
        {topEvents.length === 0 ? (
          <p className={styles.quiet}>Ningún evento tiene órdenes en este periodo.</p>
        ) : (
          <div className={styles.rows}>
            <div className={styles.row}>
              <p className={styles.rowMeta}>Evento</p>
              <p className={styles.rowMeta}>Órdenes</p>
              <p className={styles.rowMeta}>Ingresos</p>
            </div>
            {topEvents.map((event, index) => (
              <div key={event.eventId} className={styles.row}>
                <p className={styles.rowTitle}>
                  {index + 1}. {event.eventTitle}
                </p>
                <p className={own.num}>{count(event.orders)}</p>
                <p className={own.amount}>{money(event.revenue, currency)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
