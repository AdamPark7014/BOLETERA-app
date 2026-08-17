'use client';

import { AreaChart, Card, CardHeader, EmptyState, Skeleton } from '@boletera/ui';
import type { ChartSeries } from '@boletera/ui';
import type { MetricsTimePoint } from '@boletera/shared';
import { formatCurrency, formatNumber } from '@boletera/ui';
import { formatDayShort, formatMxn } from './format';
import styles from './event-hub.module.scss';

type Props = {
  points: readonly MetricsTimePoint[];
  loading: boolean;
  errorMessage?: string;
  metricLabel?: string;
  unit?: 'mxn' | 'count';
};

export function SalesCurve({
  points,
  loading,
  errorMessage,
  metricLabel = 'Ingresos',
  unit = 'mxn',
}: Props) {
  const series: ChartSeries[] =
    points.length > 0
      ? [
          {
            id: 'sales',
            name: metricLabel,
            data: points.map((point) => ({
              label: formatDayShort(point.bucket),
              value: point.value,
            })),
          },
        ]
      : [];

  const formatValue = unit === 'mxn' ? formatCurrency : formatNumber;
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <Card variant="outline" padding="md">
      <CardHeader
        title="Curva de ventas"
        description="Serie real del evento · últimos 30 días · MXN"
      />
      {errorMessage ? (
        <EmptyState
          title="No se pudo cargar la curva"
          description={errorMessage}
          illustration="error"
          tone="danger"
          size="sm"
        />
      ) : loading && points.length === 0 ? (
        <div aria-busy="true" aria-label="Cargando curva de ventas">
          <Skeleton shape="rect" width="100%" height={220} />
        </div>
      ) : points.length < 2 ? (
        <EmptyState
          title="Sin serie temporal suficiente"
          description="Cuando haya al menos dos puntos de venta, verás la curva aquí. No se muestran proyecciones inventadas."
          illustration="chart"
          size="sm"
        />
      ) : (
        <div className={styles.cardBody}>
          <AreaChart
            label={`Curva de ${metricLabel.toLowerCase()} del evento`}
            series={series}
            height={220}
            formatValue={formatValue}
            caption={
              unit === 'mxn'
                ? `${formatMxn(total)} en el periodo`
                : `${formatNumber(total)} en el periodo`
            }
          />
        </div>
      )}
    </Card>
  );
}
