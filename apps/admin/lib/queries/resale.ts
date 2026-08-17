'use client';

import { useQuery } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type ResaleListing = {
  id: string;
  askingPrice: string;
  status: string;
  ticket: { code: string };
};

export function useResaleListings(limit = 30) {
  return useQuery({
    queryKey: queryKeys.resale.listings(limit),
    queryFn: async ({ signal }) => {
      const result = await http<
        { listings?: ResaleListing[] } | ResaleListing[]
      >(`/resale/listings?limit=${limit}`, { signal, auth: false });
      return Array.isArray(result) ? result : (result.listings ?? []);
    },
  });
}
