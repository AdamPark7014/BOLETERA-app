'use client';

import {
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  AreaChart,
} from '@boletera/ui';
import type { ChartSeries } from '@boletera/ui';
import { formatNumber, formatPercent } from '@boletera/ui';
import type { AccessAttendanceMetrics } from '@boletera/shared';
import { formatCount, formatDayShort, formatPercentPoints } from './format';
import styles from './event-hub.module.scss';

type Props = {
  access: AccessAttendanceMetrics | undefined;
  loading: boolean;
  error: string | null;
};

export function AccessPanel({ access, loading, error }: Props) {
  const points = access?.checkInByHour.points ?? [];
  const series: ChartSeries[] =
    points.length > 0
      ? [
          {
            id: 'checkins',
            name: 'Check-ins',
            data: points.map((point) => ({
              label: formatDayShort(point.bucket),
              value: point.value,
            })),
          },
        ]
      : [];

  const traffic = access?.trafficByAccessPoint.rows ?? [];

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="hub-panel-access"
      aria-labelledby="hub-tab-access"
    >
      {error ? (
        <EmptyState
          title="No se pudieron cargar accesos"
          description={error}
          illustration="error"
          tone="danger"
        />
      ) : (
        <>
          <section className={styles.kpiStrip} aria-label="KPIs de asistencia">
            <KpiCard
              label="Boletos vendidos"
              value={formatCount(access?.ticketsSold)}
              loading={loading && !access}
            />
            <KpiCard
              label="Check-ins"
              value={formatCount(access?.ticketsCheckedIn)}
              loading={loading && !access}
              tone="success"
            />
            <KpiCard
              label="No-show"
              value={formatCount(access?.ticketsNoShow)}
              loading={loading && !access}
              tone="warning"
            />
            <KpiCard
              label="Tasa no-show"
              value={
                access
                  ? formatPercentPoints(access.noShowRate * 100)
                  : '—'
              }
              loading={loading && !access}
              hint={access ? formatPercent(access.noShowRate) : undefined}
            />
          </section>

          <div className={styles.grid2}>
            <Card variant="outline" padding="md">
              <CardHeader
                title="Curva de check-in"
                description="Serie real de accesos en el periodo"
              />
              {loading && points.length === 0 ? (
                <EmptyState
                  title="Cargando curva…"
                  description="Consultando métricas de acceso."
                  illustration="chart"
                  size="sm"
                />
              ) : points.length === 0 ? (
                <EmptyState
                  title="Sin check-ins en el periodo"
                  description="Cuando haya accesos registrados, verás la curva aquí. No se inventan datos de asistencia."
                  illustration="chart"
                  size="sm"
                />
              ) : (
                <AreaChart
                  label="Check-ins del evento"
                  series={series}
                  height={220}
                  formatValue={formatNumber}
                  caption={`${formatCount(points.reduce((sum, p) => sum + p.value, 0))} check-ins`}
                />
              )}
            </Card>

            <Card variant="outline" padding="md">
              <CardHeader
                title="Tráfico por punto de acceso"
                description="Desglose reportado por métricas"
              />
              {traffic.length === 0 ? (
                <EmptyState
                  title="Sin puntos de acceso"
                  description="No hay desglose de tráfico por acceso para este evento."
                  illustration="inbox"
                  size="sm"
                />
              ) : (
                <div className={styles.tableWrap} role="region" aria-label="Puntos de acceso">
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Punto</th>
                        <th scope="col">Check-ins</th>
                        <th scope="col">Participación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traffic.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label || row.key}</td>
                          <td>{formatCount(row.value)}</td>
                          <td>
                            {row.percentOfTotal != null
                              ? formatPercentPoints(row.percentOfTotal)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
