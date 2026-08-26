'use client';

/**
 * Analítica del promotor.
 *
 * `/analytics/promoters/:organizationId/dashboard` dejó de ser público: exige
 * JWT, rol y pertenencia a la organización, y el `OrgAccessGuard` ya no eximen a
 * ADMIN ni acepta peticiones sin `organizationId`. Antes esta pantalla resolvía
 * la organización a mano y cualquier fallo terminaba en un "No se pudieron
 * cargar las métricas" que no distinguía sesión vencida de falta de permiso.
 *
 * También se corrige el periodo: el API acepta `DAY | WEEK | MONTH`; la pantalla
 * mandaba `YEAR`, que no existe.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
} from '@boletera/ui';
import { adminApi } from '@/lib/api';
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

const PERIOD_OPTIONS = PERIODS.map(([value, label]) => ({ value, label }));

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
      <PageHeader
        eyebrow="Ventas"
        title="Analítica"
        description={`Rendimiento de ventas ${periodLabel}`}
        actions={
          <SegmentedControl
            label="Periodo"
            size="sm"
            options={PERIOD_OPTIONS}
            value={period}
            onValueChange={(value) => setPeriod(value as Period)}
          />
        }
      />

      <ResourceView resource={resource} context="las métricas" loadingRows={4}>
        {(data) => <Dashboard data={data} />}
      </ResourceView>
    </div>
  );
}

function Dashboard({ data }: { data: PromoterDashboard }) {
  const router = useRouter();
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
          {data.name && (
            <>
              {' '}
              · <Badge tone="neutral" variant="outline" size="sm">{data.name}</Badge>
            </>
          )}
        </p>
      )}

      {empty ? (
        <EmptyBlock
          title="Sin ventas en el periodo seleccionado"
          hint="Prueba con un periodo más amplio o revisa que el evento ya esté en venta."
        />
      ) : (
        <>
          <Section columns={4} gap="md" className={styles.kpiStrip} aria-label="Indicadores del periodo">
            <KpiCard
              label="Ingresos brutos"
              value={formatMoney(metrics.totalRevenue, currency)}
              tone="accent"
              unit={currency}
            />
            <KpiCard label="Órdenes" value={formatNumber(metrics.totalOrders)} />
            <KpiCard label="Boletos vendidos" value={formatNumber(metrics.totalTicketsSold)} />
            <KpiCard label="Comisión" value={formatMoney(metrics.commission, currency)} unit={currency} />
            <KpiCard
              label="Neto al promotor"
              value={formatMoney(metrics.netRevenue, currency)}
              tone="success"
              unit={currency}
            />
          </Section>

          <Section
            title="Eventos con más ingresos"
            className={styles.panel}
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push('/events')}
              >
                Ver eventos
              </Button>
            }
          >
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
                          <Badge tone="accent" variant="solid" size="sm" className={styles.rank}>
                            {i + 1}
                          </Badge>
                          {e.eventTitle}
                        </strong>
                        {/* Las cifras van en texto; la barra es solo apoyo visual. */}
                        <span>
                          {formatNumber(e.orders)} órdenes · {formatMoney(e.revenue, currency)}
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
          </Section>
        </>
      )}
    </>
  );
}
