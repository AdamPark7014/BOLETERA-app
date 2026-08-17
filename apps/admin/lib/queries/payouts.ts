'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { SettlementReport } from '../platform-api';

export type Payout = {
  id: string;
  status: string;
  amount?: number | string;
  [key: string]: unknown;
};

export type PayoutPayload = {
  data?: Payout[];
  payouts?: Payout[];
  [key: string]: unknown;
};

export function usePayouts() {
  return useQuery({
    queryKey: queryKeys.payouts.list(),
    queryFn: ({ signal }) => http<PayoutPayload>('/admin/payouts', { signal }),
  });
}

export function useSettlementReport(
  organizationId: string | null,
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
) {
  return useQuery({
    queryKey: queryKeys.payouts.settlement(organizationId ?? '', period),
    queryFn: ({ signal }) =>
      http<SettlementReport>(`/reports/settlement/${organizationId}/${period}`, {
        signal,
      }),
    enabled: Boolean(organizationId),
  });
}

export function useCompletePayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payoutId: string) =>
      http(`/admin/payouts/${payoutId}/complete`, { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.payouts.all }),
  });
}
