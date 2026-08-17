'use client';

import { useCallback, useMemo } from 'react';
import type { MetricsTimePoint } from '@boletera/shared';
import {
  useEventSalesPace,
  useExecutiveMetrics,
  useMetricsAlerts,
  useMetricsTimeseries,
  usePlatformOverview,
} from '@/lib/queries';
import type { DashboardRange } from '../range';
import {
  alignComparison,
  derivedAverageTicket,
  seriesStats,
  sparklineValues,
  toChartData,
  type DashboardMetric,
  type KpiKey,
} from './derive';

const EMPTY_POINTS: readonly MetricsTimePoint[] = [];

/** Etiqueta de cada consulta para el banner de error parcial. */
type QueryFailure = { source: string; error: Error };

function asError(error: unknown): Error | null {
  if (error instanceof Error) return error;
  if (error == null) return null;
  return new Error(String(error));
}

/**
 * Fuente única de datos del dashboard ejecutivo.
 *
 * Descarga en paralelo el resumen ejecutivo, las tres series base (ingresos,
 * órdenes y boletos), la serie del periodo anterior, el ritmo de venta, las
 * alertas y la actividad reciente. Las series base se comparten entre el
 * gráfico principal y las sparklines de los KPI, así que cambiar de métrica no
 * dispara peticiones nuevas: TanStack Query reutiliza la misma clave de caché.
 */
export function useDashboardData(range: DashboardRange, metric: DashboardMetric) {
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range.from, range.to]);
  const previousParams = useMemo(
    () => ({ from: range.previousFrom, to: range.previousTo }),
    [range.previousFrom, range.previousTo],
  );

  const executive = useExecutiveMetrics(params);
  const salesPace = useEventSalesPace(params);
  const alerts = useMetricsAlerts(params);
  const overview = usePlatformOverview();

  const revenueSeries = useMetricsTimeseries({
    ...params,
    granularity: range.granularity,
    metric: 'revenue',
  });
  const ordersSeries = useMetricsTimeseries({
    ...params,
    granularity: range.granularity,
    metric: 'orders',
  });
  const ticketsSeries = useMetricsTimeseries({
    ...params,
    granularity: range.granularity,
    metric: 'tickets',
  });
  const comparisonSeries = useMetricsTimeseries({
    ...previousParams,
    granularity: range.granularity,
    metric,
  });

  const points = useMemo(
    () => ({
      revenue:
        revenueSeries.data?.series[0]?.points ??
        executive.data?.series.find((series) => series.key === 'revenue')?.points ??
        EMPTY_POINTS,
      orders: ordersSeries.data?.series[0]?.points ?? EMPTY_POINTS,
      tickets: ticketsSeries.data?.series[0]?.points ?? EMPTY_POINTS,
    }),
    [
      executive.data?.series,
      ordersSeries.data?.series,
      revenueSeries.data?.series,
      ticketsSeries.data?.series,
    ],
  );

  const chartData = useMemo(
    () => toChartData(points[metric], range.granularity),
    [metric, points, range.granularity],
  );

  const comparisonData = useMemo(
    () => alignComparison(chartData, comparisonSeries.data?.series[0]?.points ?? EMPTY_POINTS),
    [chartData, comparisonSeries.data?.series],
  );

  const stats = useMemo(() => seriesStats(chartData), [chartData]);
  const comparisonStats = useMemo(() => seriesStats(comparisonData), [comparisonData]);

  const trends = useMemo<Record<KpiKey, readonly number[]>>(() => {
    const revenue = sparklineValues(points.revenue);
    return {
      grossRevenue: revenue,
      netRevenue: revenue,
      ordersCompleted: sparklineValues(points.orders),
      ticketsSold: sparklineValues(points.tickets),
      averageTicketPrice: derivedAverageTicket(points.revenue, points.tickets),
      conversionRate: [],
    };
  }, [points]);

  const failures = useMemo<QueryFailure[]>(() => {
    const candidates: readonly { source: string; error: unknown }[] = [
      { source: 'Resumen ejecutivo', error: executive.error },
      { source: 'Serie temporal', error: revenueSeries.error ?? ordersSeries.error ?? ticketsSeries.error },
      { source: 'Ritmo de venta', error: salesPace.error },
      { source: 'Alertas', error: alerts.error },
      { source: 'Actividad', error: overview.error },
    ];
    const result: QueryFailure[] = [];
    for (const candidate of candidates) {
      const error = asError(candidate.error);
      if (error) result.push({ source: candidate.source, error });
    }
    return result;
  }, [
    alerts.error,
    executive.error,
    ordersSeries.error,
    overview.error,
    revenueSeries.error,
    salesPace.error,
    ticketsSeries.error,
  ]);

  const isRefreshing =
    (executive.isFetching && !executive.isPending) ||
    (revenueSeries.isFetching && !revenueSeries.isPending) ||
    (salesPace.isFetching && !salesPace.isPending) ||
    (alerts.isFetching && !alerts.isPending);

  const refetchAll = useCallback(() => {
    void executive.refetch();
    void revenueSeries.refetch();
    void ordersSeries.refetch();
    void ticketsSeries.refetch();
    void comparisonSeries.refetch();
    void salesPace.refetch();
    void alerts.refetch();
    void overview.refetch();
  }, [
    alerts,
    comparisonSeries,
    executive,
    ordersSeries,
    overview,
    revenueSeries,
    salesPace,
    ticketsSeries,
  ]);

  const generatedAt =
    executive.data?.generatedAt ??
    revenueSeries.data?.generatedAt ??
    alerts.data?.generatedAt ??
    null;

  return {
    executive,
    salesPace,
    alerts,
    overview,
    chartQuery:
      metric === 'orders' ? ordersSeries : metric === 'tickets' ? ticketsSeries : revenueSeries,
    comparisonSeries,
    chartData,
    comparisonData,
    stats,
    comparisonStats,
    trends,
    failures,
    isRefreshing,
    refetchAll,
    generatedAt,
  };
}

export type DashboardData = ReturnType<typeof useDashboardData>;
