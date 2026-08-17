'use client';

import { AreaChart, Card, CardHeader, EmptyState, Skeleton } from '@boletera/ui';
import type { ChartSeries } from '@boletera/ui';
import { formatBucketLabel, formatCount } from './format';
import styles from './scanner.module.scss';

type Point = { bucket: string; value: number };

type Props = {
  points: readonly Point[];
  granularity: 'hour' | 'day';
  loading: boolean;
  errorMessage?: string;
};

export function ArrivalCurve({ points, granularity, loading, errorMessage }: Props) {
  const series: ChartSeries[] =
    points.length > 0
      ? [
          {
            id: 'arrivals',
            name: 'Llegadas',
            data: points.map((p) => ({
              label: formatBucketLabel(p.bucket, granularity),
              value: p.value,
            })),
          },
        ]
      : [];

  return (
    <Card className={styles.panel} padding="md">
      <CardHeader
        title="Curva de llegada"
        description="Check-ins agregados en el rango seleccionado"
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
        <div aria-busy="true" aria-label="Cargando curva de llegada">
          <Skeleton shape="rect" width="100%" height={200} />
        </div>
      ) : points.length === 0 ? (
        <EmptyState
          title="Sin llegadas en este rango"
          description="Cuando haya check-ins exitosos, verás la curva aquí."
          illustration="chart"
          size="sm"
        />
      ) : (
        <AreaChart
          label="Curva de llegada de asistentes"
          series={series}
          height={220}
          formatValue={formatCount}
          caption={`${formatCount(points.reduce((sum, p) => sum + p.value, 0))} check-ins en el periodo`}
        />
      )}
    </Card>
  );
}
