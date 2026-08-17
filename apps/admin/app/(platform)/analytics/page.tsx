'use client';

/**
 * Analítica del promotor.
 *
 * `/analytics/promoters/:organizationId/dashboard` dejó de ser público: exige
 * JWT, rol y pertenencia a la organización, y el `OrgAccessGuard` ya no exime a
 * ADMIN ni acepta peticiones sin `organizationId`. Antes esta pantalla resolvía
 * la organización a mano y cualquier fallo terminaba en un "No se pudieron
 * cargar las métricas" que no distinguía sesión vencida de falta de permiso.
 *
 * También se corrige el periodo: el API acepta `DAY | WEEK | MONTH`; la pantalla
 * mandaba `YEAR`, que no existe.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import platform from '../_styles/platform.module.scss';
import styles from './analytics.module.scss';
import { EmptyBlock, ResourceView } from '../orders/_ui/States';
import { useResource } from '../orders/_ui/useResource';
import { formatDate, formatMoney, formatNumber } from '../orders/_ui/format';

type Period = 'DAY' | 'WEEK' | 'MONTH';

const PERIODS: [Period, string, string][] = [
  ['DAY', 'Día', 'hoy'],
  ['WEEK', 'Semana', 'esta semana'],
  ['MONTH', 'Mes', 'este mes'],
];

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

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('MONTH');

  const resource = useResource<PromoterDashboard>(
    useCallback(
      ({ token, orgId, signal }) =>
        adminApi<PromoterDashboard>(
          `/analytics/promoters/${orgId}/dashboard?period=${period}`,
          token,
          { signal },
        ),
      [period],
    ),
    { deps: [period] },
  );

  const periodLabel = PERIODS.find(([p]) => p === period)?.[2] ?? '';

  return (
    <div className={styles.wrap}>
      <header className={platform.pageHeader}>
        <div>
          <h1>Analítica</h1>
          <p>Rendimiento de ventas {periodLabel}</p>
        </div>
        <div className={styles.periodTabs} role="group" aria-label="Periodo">
          {PERIODS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              className={period === id ? styles.tabOn : styles.tab}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <ResourceView resource={resource} context="las métricas" loadingRows={4}>
        {(data) => <Dashboard data={data} />}
      </ResourceView>
    </div>
  );
}

function Dashboard({ data }: { data: PromoterDashboard }) {
  const metrics = data.metrics ?? {};
  const currency = (metrics.currency || 'MXN').toUpperCase();
  const topEvents = data.topEvents ?? [];

  const maxRevenue = useMemo(
    () => Math.max(1, ...topEvents.map((e) => e.revenue || 0)),
    [topEvents],
  );

  const empty = !metrics.totalOrders && !metrics.totalRevenue && topEvents.length === 0;

  return (
    <>
      {data.dateRange && (
        <p className={styles.muted}>
          Periodo {formatDate(data.dateRange.startDate)} – {formatDate(data.dateRange.endDate)}
          {data.name && <> · {data.name}</>}
        </p>
      )}

      {empty ? (
        <EmptyBlock
          title="Sin ventas en el periodo seleccionado"
          hint="Prueba con un periodo más amplio o revisa que el evento ya esté en venta."
        />
      ) : (
        <>
          <section className={styles.kpis}>
            <article className={styles.kpiHero}>
              <span>Ingresos brutos</span>
              <strong>{formatMoney(metrics.totalRevenue, currency)}</strong>
            </article>
            <article>
              <span>Órdenes</span>
              <strong>{formatNumber(metrics.totalOrders)}</strong>
            </article>
            <article>
              <span>Boletos vendidos</span>
              <strong>{formatNumber(metrics.totalTicketsSold)}</strong>
            </article>
            <article>
              <span>Comisión</span>
              <strong>{formatMoney(metrics.commission, currency)}</strong>
            </article>
            <article>
              <span>Neto al promotor</span>
              <strong>{formatMoney(metrics.netRevenue, currency)}</strong>
            </article>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Eventos con más ingresos</h2>
              <Link href="/events" className={platform.ghostBtn}>
                Ver eventos
              </Link>
            </div>

            {topEvents.length === 0 ? (
              <EmptyBlock
                title="Sin eventos con ventas en este periodo"
                hint="Los eventos aparecen aquí en cuanto registran su primera orden."
              />
            ) : (
              <ul className={styles.bars}>
                {topEvents.map((e, i) => {
                  const pct = Math.round(((e.revenue || 0) / maxRevenue) * 100);
                  return (
                    <li key={e.eventId}>
                      <div className={styles.barMeta}>
                        <strong>
                          <span className={styles.rank}>{i + 1}</span>
                          {e.eventTitle}
                        </strong>
                        {/* Las cifras van en texto; la barra es solo apoyo visual. */}
                        <span>
                          {formatNumber(e.orders)} órdenes ·{' '}
                          {formatMoney(e.revenue, currency)}
                        </span>
                      </div>
                      <div className={styles.barTrack} aria-hidden="true">
                        <div className={styles.barFill} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
