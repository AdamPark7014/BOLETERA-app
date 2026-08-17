'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
};

export function useApiKeys(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.partners.keys(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<ApiKey[]>(`/partners/${organizationId}/keys`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useCreateApiKey(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      scopes?: string[];
      rateLimit?: number;
      expiresInDays?: number;
    }) =>
      http<{ id: string; secret: string; keyPrefix: string }>(
        `/partners/${organizationId}/keys`,
        { method: 'POST', body },
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.partners.keys(organizationId) }),
  });
}

export function useRevokeApiKey(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) =>
      http(`/partners/${organizationId}/keys/${keyId}/revoke`, { method: 'PATCH' }),
    onMutate: async (keyId) => {
      const key = queryKeys.partners.keys(organizationId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ApiKey[]>(key);
      client.setQueryData<ApiKey[]>(key, (keys) =>
        keys?.map((item) => (item.id === keyId ? { ...item, active: false } : item)),
      );
      return { previous };
    },
    onError: (_error, _keyId, context) =>
      client.setQueryData(queryKeys.partners.keys(organizationId), context?.previous),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.partners.keys(organizationId) }),
  });
}
