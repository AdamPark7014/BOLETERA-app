'use client';

import { useMemo } from 'react';
import type { AccessAttendanceMetrics } from '@boletera/shared';
import { AreaChart } from '@boletera/ui/src/components/AreaChart';
import { BarChart } from '@boletera/ui/src/components/BarChart';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { ProgressRing } from '@boletera/ui/src/components/ProgressRing';
import { vizColor } from '@boletera/ui/src/styles/tokens';
import { formatCount, formatPercentPoints, unitFormatter } from '../_lib/format';
import { breakdownToSeries, timeSeriesToChart } from '../_lib/series';
import styles from '../analytics.module.scss';
import { PanelState, PanelSkeleton } from './PanelState';

export function AccessSection({
  data,
  isPending,
  error,
  onRetry,
}: {
  data: AccessAttendanceMetrics | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const checkInSeries = useMemo(
    () =>
      data
        ? [
            timeSeriesToChart(data.checkInByHour, {
              name: 'Check-ins',
              color: vizColor(0),
            }),
          ]
        : [],
    [data],
  );

  const accessPointSeries = useMemo(
    () =>
      data
        ? breakdownToSeries(data.trafficByAccessPoint, 'Check-ins', { limit: 10 })
        : [],
    [data],
  );

  const showRate = data && data.ticketsSold > 0
    ? ((data.ticketsCheckedIn / data.ticketsSold) * 100)
    : 0;

  return (
    <div className={styles.grid}>
      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Asistencia"
          description="Check-ins frente a boletos vendidos y tasa de no-show."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.ticketsSold === 0 && value.ticketsCheckedIn === 0}
          emptyTitle="Sin actividad de acceso"
          emptyDescription="Cuando se escaneen boletos verás la curva de check-in y el no-show aquí. Filtra por evento para un análisis más preciso."
          skeleton={<PanelSkeleton height={96} lines={0} />}
        >
          {(value) => (
            <div className={styles.statList}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Vendidos</span>
                <strong className={styles.statValue}>{formatCount(value.ticketsSold)}</strong>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Check-ins</span>
                <strong className={styles.statValue}>
                  {formatCount(value.ticketsCheckedIn)}
                </strong>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>No-show</span>
                <strong className={styles.statValue}>
                  {formatCount(value.ticketsNoShow)}
                </strong>
                <span className={styles.statHint}>
                  {formatPercentPoints(value.noShowRate)}
                </span>
              </div>
              <div className={styles.stat} style={{ alignItems: 'center' }}>
                <ProgressRing
                  label="Tasa de asistencia"
                  value={showRate}
                  max={100}
                  size={72}
                  tone={value.noShowRate >= 30 ? 'danger' : value.noShowRate >= 15 ? 'warning' : 'success'}
                />
                <span className={styles.statHint}>Asistencia</span>
              </div>
            </div>
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span8}`} padding="md" variant="outline">
        <CardHeader
          title="Curva de check-in"
          description="Tráfico horario de accesos en el periodo."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.checkInByHour.points.length === 0}
          emptyTitle="Sin curva de check-in"
          emptyDescription="No hay escaneos registrados en el rango. Selecciona un evento con función reciente."
          skeleton={<PanelSkeleton height={220} lines={0} />}
        >
          {() => (
            <AreaChart
              label="Curva de check-in"
              series={checkInSeries}
              height={240}
              formatValue={unitFormatter('count')}
              smooth
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span4}`} padding="md" variant="outline">
        <CardHeader title="Tráfico por acceso" as="h2" />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.trafficByAccessPoint.rows.length === 0}
          emptyTitle="Sin puntos de acceso"
          emptyDescription="Los escaneos con zona/acceso aparecerán como barras aquí."
          skeleton={<PanelSkeleton height={220} lines={0} />}
        >
          {() => (
            <BarChart
              label="Tráfico por punto de acceso"
              series={accessPointSeries}
              height={240}
              formatValue={formatCount}
            />
          )}
        </PanelState>
      </Card>
    </div>
  );
}
