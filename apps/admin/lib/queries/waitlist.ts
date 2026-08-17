'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { WaitlistRow } from '../platform-api';

export function useWaitlist(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.waitlist.organization(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<WaitlistRow[]>(`/waitlist/organization/${organizationId}`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useNotifyWaitlist(organizationId: string, eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ limit = 50 }: { limit?: number }) =>
      http<{ notified: number }>(`/waitlist/event/${eventId}/notify?limit=${limit}`, {
        method: 'POST',
      }),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: queryKeys.waitlist.organization(organizationId),
      }),
  });
}
