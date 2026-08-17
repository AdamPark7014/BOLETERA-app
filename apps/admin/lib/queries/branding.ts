'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type Branding = {
  primaryColor?: string;
  subdomain?: string;
  logoUrl?: string;
};

export function useBranding() {
  return useQuery({
    queryKey: queryKeys.branding.detail(),
    queryFn: ({ signal }) => http<Branding>('/admin/branding', { signal }),
  });
}

export function useUpdateBranding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Branding) =>
      http<Branding>('/admin/branding', { method: 'PUT', body }),
    onMutate: async (branding) => {
      const key = queryKeys.branding.detail();
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Branding>(key);
      client.setQueryData(key, (current: Branding | undefined) => ({
        ...current,
        ...branding,
      }));
      return { previous };
    },
    onError: (_error, _branding, context) =>
      client.setQueryData(queryKeys.branding.detail(), context?.previous),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.branding.detail() }),
  });
}
