'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AccessAttendanceMetrics,
  CampaignFunnelMetrics,
  EventSalesPaceMetrics,
  ExecutiveSummaryMetrics,
  FraudSignalsMetrics,
  InventoryMetrics,
  MetricsAlertsResponse,
  MetricsGranularity,
  MetricsTimeSeriesResponse,
  OrdersPaymentsMetrics,
  ResaleMetrics,
  SettlementsMetrics,
  WaitlistMetrics,
} from '@boletera/shared';
import { http } from '../http';
import { queryKeys } from '../query-keys';

/** Common range / scope filters for /metrics/* endpoints. */
export type MetricsRangeParams = {
  from?: string;
  to?: string;
  organizationId?: string;
  eventId?: string;
};

export type MetricsTimeseriesMetric =
  | 'revenue'
  | 'orders'
  | 'tickets'
  | 'refunds'
  | 'checkins';

/** Params for GET /metrics/timeseries. */
export type TimeseriesParams = MetricsRangeParams & {
  granularity: MetricsGranularity;
  metric: MetricsTimeseriesMetric;
};

/** Short stale window — backend aggregates are cached ~30–60s. */
const METRICS_STALE_TIME = 20_000;

function toQueryString(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function metricsUrl(path: string, params: MetricsRangeParams = {}): string {
  return `/metrics/${path}${toQueryString({
    from: params.from,
    to: params.to,
    organizationId: params.organizationId,
    eventId: params.eventId,
  })}`;
}

export function useExecutiveMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.executive(params),
    queryFn: ({ signal }) =>
      http<ExecutiveSummaryMetrics>(metricsUrl('executive', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useEventSalesPace(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.salesPace(params),
    queryFn: ({ signal }) =>
      http<EventSalesPaceMetrics>(metricsUrl('events/sales-pace', params), {
        signal,
      }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useInventoryMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.inventory(params),
    queryFn: ({ signal }) =>
      http<InventoryMetrics>(metricsUrl('inventory', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useOrdersMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.orders(params),
    queryFn: ({ signal }) =>
      http<OrdersPaymentsMetrics>(metricsUrl('orders', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useAccessMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.access(params),
    queryFn: ({ signal }) =>
      http<AccessAttendanceMetrics>(metricsUrl('access', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useResaleMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.resale(params),
    queryFn: ({ signal }) =>
      http<ResaleMetrics>(metricsUrl('resale', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useWaitlistMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.waitlist(params),
    queryFn: ({ signal }) =>
      http<WaitlistMetrics>(metricsUrl('waitlist', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useCampaignMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.campaigns(params),
    queryFn: ({ signal }) =>
      http<CampaignFunnelMetrics>(metricsUrl('campaigns', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useFraudMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.fraud(params),
    queryFn: ({ signal }) =>
      http<FraudSignalsMetrics>(metricsUrl('fraud', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useSettlementsMetrics(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.settlements(params),
    queryFn: ({ signal }) =>
      http<SettlementsMetrics>(metricsUrl('settlements', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useMetricsTimeseries(params: TimeseriesParams) {
  return useQuery({
    queryKey: queryKeys.metrics.timeseries(params),
    queryFn: ({ signal }) =>
      http<MetricsTimeSeriesResponse>(
        `/metrics/timeseries${toQueryString({
          from: params.from,
          to: params.to,
          organizationId: params.organizationId,
          eventId: params.eventId,
          granularity: params.granularity,
          metric: params.metric,
        })}`,
        { signal },
      ),
    staleTime: METRICS_STALE_TIME,
  });
}

export function useMetricsAlerts(params: MetricsRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.metrics.alerts(params),
    queryFn: ({ signal }) =>
      http<MetricsAlertsResponse>(metricsUrl('alerts', params), { signal }),
    staleTime: METRICS_STALE_TIME,
  });
}
