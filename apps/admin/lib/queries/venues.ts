'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { EgressOverviewResponse, EgressReportApiJson } from '../platform-api';

export type VenueRow = {
  id: string;
  name: string;
  slug: string;
  city?: string;
  totalCapacity?: number;
  capacity?: number;
  _count?: { events: number };
  layouts?: { id: string; version: number; updatedAt: string }[];
};

export type CreateVenueInput = {
  name: string;
  city?: string;
  state?: string;
  address?: string;
  totalCapacity?: number;
  template?: 'arena' | 'theater' | 'stadium' | 'festival' | 'blank';
};

export function useVenues() {
  return useQuery({
    queryKey: queryKeys.venues.list(),
    queryFn: ({ signal }) => http<VenueRow[]>('/admin/venues', { signal }),
  });
}

export function useVenueLayout(venueId: string) {
  return useQuery({
    queryKey: queryKeys.venues.layout(venueId),
    queryFn: ({ signal }) =>
      http<{
        venue: { id: string; name: string; slug: string };
        layout: { id: string; mapData: SeatMapData };
      }>(`/venues/${venueId}/layout`, { signal }),
    enabled: Boolean(venueId),
  });
}

export function useVenueEgress(venueId: string) {
  return useQuery({
    queryKey: queryKeys.venues.egress(venueId),
    queryFn: ({ signal }) =>
      http<EgressReportApiJson>(`/venues/${venueId}/layout/egress`, { signal }),
    enabled: Boolean(venueId),
  });
}

export function useEgressOverview() {
  return useQuery({
    queryKey: queryKeys.venues.egressOverview(),
    queryFn: ({ signal }) => http<EgressOverviewResponse>('/venues/egress-overview', { signal }),
  });
}

export function useCreateVenue() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVenueInput) => http<VenueRow>('/admin/venues', { method: 'POST', body }),
    onSuccess: (venue) => {
      client.setQueryData<VenueRow[]>(queryKeys.venues.list(), (venues = []) => [
        ...venues,
        venue,
      ]);
      void client.invalidateQueries({ queryKey: queryKeys.overview.all });
    },
  });
}

export function useSaveVenueLayout(venueId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mapData: SeatMapData) =>
      http(`/venues/${venueId}/layout`, { method: 'PUT', body: { mapData } }),
    onMutate: async (mapData) => {
      const key = queryKeys.venues.layout(venueId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<{
        venue: { id: string; name: string; slug: string };
        layout: { id: string; mapData: SeatMapData };
      }>(key);
      if (previous) {
        client.setQueryData(key, {
          ...previous,
          layout: { ...previous.layout, mapData },
        });
      }
      return { previous };
    },
    onError: (_error, _data, context) =>
      client.setQueryData(queryKeys.venues.layout(venueId), context?.previous),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.venues.layout(venueId) });
      void client.invalidateQueries({ queryKey: queryKeys.venues.egress(venueId) });
    },
  });
}

export function useSuggestLayout(venueId: string) {
  return useMutation({
    mutationFn: (prompt: string) =>
      http<{ venue: unknown; layout: { mapData: SeatMapData } }>(
        `/venues/${venueId}/layout/suggest`,
        { method: 'POST', body: { prompt } },
      ),
  });
}

export function useApplyLayoutTemplate(venueId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      template,
      capacity,
    }: {
      template: 'arena' | 'theater' | 'stadium' | 'festival';
      capacity?: number;
    }) =>
      http<{ venue: unknown; layout: { mapData: SeatMapData } }>(
        `/venues/${venueId}/layout/from-template`,
        { method: 'POST', body: { template, capacity } },
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.venues.layout(venueId) }),
  });
}

export function useAnalyzeVenueEgress(venueId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { mapData?: SeatMapData; format?: 'json' | 'csv' | 'pdf' }) => {
      const format = input.format ?? 'json';
      return http<EgressReportApiJson | string | Blob>(
        `/venues/${venueId}/layout/egress`,
        {
          method: 'POST',
          body: { mapData: input.mapData, format },
          responseType: format === 'json' ? 'json' : format === 'csv' ? 'text' : 'blob',
        },
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.venues.egress(venueId) });
      void client.invalidateQueries({ queryKey: queryKeys.venues.egressOverview() });
    },
  });
}

export function useImportAiLayout(venueId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sections: SeatMapSection[]) =>
      http(`/venues/${venueId}/layout/ai-import`, {
        method: 'POST',
        body: { sections },
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.venues.layout(venueId) }),
  });
}
