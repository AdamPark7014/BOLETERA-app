'use client';

import { useQuery } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type SalesReportRow = {
  channel: string;
  _sum: { totalAmount: string | null };
  _count: number;
};

export type ZReport = {
  sessionId: string;
  terminalName?: string;
  cashierId: string;
  endedAt?: string;
  report?: unknown;
};

export function useSalesReport() {
  return useQuery({
    queryKey: queryKeys.reports.sales(),
    queryFn: ({ signal }) => http<SalesReportRow[]>('/admin/reports/sales', { signal }),
  });
}

export function useZReports(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.reports.zReports(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<ZReport[]>(`/taquilla/z-reports?organizationId=${organizationId}`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function exportSalesReport(organizationId: string, signal?: AbortSignal) {
  return http<string>(`/reports/export/sales/${organizationId}`, {
    responseType: 'text',
    signal,
  });
}
