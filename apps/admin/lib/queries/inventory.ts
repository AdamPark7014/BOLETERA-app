'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  EventSalesPaceMetrics,
  InventoryMetrics,
  MetricsAlertsResponse,
} from '@boletera/shared';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import { useEvents } from './events';
import { useVenues } from './venues';

/** Common range / scope filters for inventory suite endpoints. */
export type InventoryRangeParams = {
  from?: string;
  to?: string;
  organizationId?: string;
  eventId?: string;
};

export type InventoryAvailabilityTicket = {
  id: string;
  seatId: string | null;
  status: string;
  section: string | null;
  row: string | null;
  seatNumber: string | null;
};

export type InventoryAvailability = {
  tickets: InventoryAvailabilityTicket[];
  activeHolds: number;
  statusCounts: Record<string, number>;
};

const STALE_TIME = 20_000;

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

function metricsUrl(path: string, params: InventoryRangeParams = {}): string {
  return `/metrics/${path}${toQueryString({
    from: params.from,
    to: params.to,
    organizationId: params.organizationId,
    eventId: params.eventId,
  })}`;
}

/** GET /metrics/inventory — zone/tier capacity, holds, blocked, sell-through. */
export function useInventoryMetrics(params: InventoryRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.metrics(params),
    queryFn: ({ signal }) =>
      http<InventoryMetrics>(metricsUrl('inventory', params), { signal }),
    staleTime: STALE_TIME,
  });
}

/** GET /metrics/events/sales-pace — at-risk sellout pace. */
export function useInventorySalesPace(params: InventoryRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.salesPace(params),
    queryFn: ({ signal }) =>
      http<EventSalesPaceMetrics>(metricsUrl('events/sales-pace', params), {
        signal,
      }),
    staleTime: STALE_TIME,
  });
}

/** GET /metrics/alerts — inventory / events domain signals. */
export function useInventoryAlerts(params: InventoryRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.alerts(params),
    queryFn: ({ signal }) =>
      http<MetricsAlertsResponse>(metricsUrl('alerts', params), { signal }),
    staleTime: STALE_TIME,
  });
}

/** Live seat/GA availability for a single event (expires stale holds first). */
export function useInventoryAvailability(eventId: string | null) {
  return useQuery({
    queryKey: queryKeys.inventory.availability(eventId ?? ''),
    queryFn: ({ signal }) =>
      http<InventoryAvailability>(`/inventory/${eventId}/availability`, { signal }),
    enabled: Boolean(eventId),
    staleTime: 10_000,
    refetchInterval: eventId ? 15_000 : false,
  });
}

export function useInventoryEvents() {
  return useEvents();
}

export function useInventoryVenues() {
  return useVenues();
}
