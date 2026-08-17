'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type SeasonPass = {
  id: string;
  name: string;
  slug: string;
  seasonLabel: string;
  price: string | number;
  soldQuantity: number;
  maxQuantity: number;
  active: boolean;
  events: { event: { id: string; title: string } }[];
};

export type CreateSeasonPassInput = {
  name: string;
  slug: string;
  seasonLabel: string;
  startsAt: string;
  endsAt: string;
  price: number;
};

export function useSeasonPasses(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.season.list(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<SeasonPass[]>(`/season/org/${organizationId}`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useCreateSeasonPass(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSeasonPassInput) =>
      http<SeasonPass>(`/season/org/${organizationId}`, { method: 'POST', body }),
    onSuccess: (seasonPass) =>
      client.setQueryData<SeasonPass[]>(
        queryKeys.season.list(organizationId),
        (current = []) => [...current, seasonPass],
      ),
  });
}
