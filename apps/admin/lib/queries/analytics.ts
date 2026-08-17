'use client';

import { useQuery } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { PlatformOverview, RealtimeDashboard } from '../platform-api';

export type AnalyticsPeriod = 'WEEK' | 'MONTH' | 'YEAR';
export type PromoterDashboard = {
  metrics?: {
    totalRevenue?: number;
    totalOrders?: number;
    totalTicketsSold?: number;
    netRevenue?: number;
    currency?: string;
  };
  topEvents?: {
    eventId: string;
    eventTitle: string;
    revenue: number;
    orders: number;
  }[];
};

export function usePlatformOverview() {
  return useQuery({
    queryKey: queryKeys.overview.platform(),
    queryFn: ({ signal }) => http<PlatformOverview>('/admin/platform/overview', { signal }),
  });
}

export function usePromoterAnalytics(
  organizationId: string | null,
  period: AnalyticsPeriod,
) {
  return useQuery({
    queryKey: queryKeys.analytics.promoter(organizationId ?? '', period),
    queryFn: ({ signal }) =>
      http<PromoterDashboard>(
        `/analytics/promoters/${organizationId}/dashboard?period=${period}`,
        { signal },
      ),
    enabled: Boolean(organizationId),
  });
}

export function useRealtimeDashboard(
  organizationId: string | null,
  eventId?: string,
) {
  return useQuery({
    queryKey: queryKeys.analytics.realtime(organizationId ?? '', eventId),
    queryFn: ({ signal }) => {
      const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
      return http<RealtimeDashboard>(
        `/reports/dashboard/realtime/${organizationId}${query}`,
        { signal },
      );
    },
    enabled: Boolean(organizationId),
    staleTime: 10_000,
  });
}
