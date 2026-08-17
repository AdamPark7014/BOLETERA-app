'use client';

import { useQuery } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export function useAuditLog(organizationId: string | null, limit = 80) {
  return useQuery({
    queryKey: queryKeys.audit.log(organizationId ?? '', limit),
    queryFn: ({ signal }) =>
      http<AuditEntry[]>(`/organization/${organizationId}/audit?limit=${limit}`, {
        signal,
      }),
    enabled: Boolean(organizationId),
  });
}
