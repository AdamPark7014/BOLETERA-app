'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InventoryMetrics, OrdersPaymentsMetrics } from '@boletera/shared';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import { useEvents } from './events';
import type { OrderRow } from './orders';

/** Range filters shared by reservation suite metrics. */
export type ReservationRangeParams = {
  from?: string;
  to?: string;
  organizationId?: string;
  eventId?: string;
};

export type ReleaseHoldResult = {
  released: boolean;
  status?: string;
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

function metricsUrl(path: string, params: ReservationRangeParams = {}): string {
  return `/metrics/${path}${toQueryString({
    from: params.from,
    to: params.to,
    organizationId: params.organizationId,
    eventId: params.eventId,
  })}`;
}

/** Inventory holds / blocked seats feeding the reservations cockpit. */
export function useReservationInventory(params: ReservationRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.reservations.inventory(params),
    queryFn: ({ signal }) =>
      http<InventoryMetrics>(metricsUrl('inventory', params), { signal }),
    staleTime: STALE_TIME,
  });
}

/** Orders payments KPIs — conversion / approval context for holds. */
export function useReservationOrdersMetrics(params: ReservationRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.reservations.ordersMetrics(params),
    queryFn: ({ signal }) =>
      http<OrdersPaymentsMetrics>(metricsUrl('orders', params), { signal }),
    staleTime: STALE_TIME,
  });
}

/** Pending / completed orders used as checkout holds and conversions. */
export function useReservationOrders(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.reservations.orders(filters),
    queryFn: ({ signal }) => http<OrderRow[]>('/admin/orders', { signal }),
  });
}

export function useReservationEvents() {
  return useEvents();
}

/** DELETE /inventory/holds/:id — explicit release of an active hold. */
export function useReleaseReservationHold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      holdId,
      sessionId,
    }: {
      holdId: string;
      sessionId?: string;
    }) => {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      return http<ReleaseHoldResult>(`/inventory/holds/${holdId}${qs}`, {
        method: 'DELETE',
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reservations.all });
      void client.invalidateQueries({ queryKey: queryKeys.inventory.all });
      void client.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });
}
