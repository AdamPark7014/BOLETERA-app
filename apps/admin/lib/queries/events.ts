'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { EventHub, EventRow } from '../platform-api';

export type CreateEventInput = {
  title: string;
  description: string;
  type: 'single' | 'series' | 'residency';
  startDate: string;
  venueId: string;
  capacity: number;
  basePrice: number;
};

export function useEvents(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.events.list(filters),
    queryFn: ({ signal }) => http<EventRow[]>('/admin/events', { signal }),
  });
}

export function useEventHub(eventId: string) {
  return useQuery({
    queryKey: queryKeys.events.hub(eventId),
    queryFn: ({ signal }) => http<EventHub>(`/events/manage/${eventId}/hub`, { signal }),
    enabled: Boolean(eventId),
  });
}

export function useEventCalendar(month: number, year: number) {
  return useQuery({
    queryKey: queryKeys.events.calendar(month, year),
    queryFn: ({ signal }) =>
      http<{ calendar: Record<string, unknown[]>; totalEvents: number }>(
        `/events/manage/calendar/${month}/${year}`,
        { signal },
      ),
  });
}

export function useEventsByVenue(venueId: string) {
  const query = useEvents();
  return {
    ...query,
    data: query.data?.filter((event) => event.venueId === venueId),
  };
}

export function useCreateEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      http<EventRow>('/events/manage', {
        method: 'POST',
        body: { ...input, startDate: new Date(input.startDate).toISOString() },
      }),
    onSuccess: (event) => {
      client.setQueryData<EventRow[]>(queryKeys.events.list(), (current = []) => [
        event,
        ...current,
      ]);
      void client.invalidateQueries({ queryKey: queryKeys.events.all });
      void client.invalidateQueries({ queryKey: queryKeys.overview.all });
    },
  });
}

export function useCreateEventSeries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      seriesName: string;
      description: string;
      venueId: string;
      occurrences: Array<{
        date: string;
        title?: string;
        capacity?: number;
        basePrice?: number;
      }>;
    }) =>
      http<{ seriesName: string; totalEvents: number }>('/events/manage/series', {
        method: 'POST',
        body: {
          ...body,
          occurrences: body.occurrences.map((item) => ({
            ...item,
            date: new Date(item.date).toISOString(),
          })),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.events.all });
      void client.invalidateQueries({ queryKey: queryKeys.overview.all });
    },
  });
}

export function useCreateResidency() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      venueId: string;
      startDate: string;
      frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
      occurrenceCount: number;
      capacity: number;
      basePrice: number;
    }) =>
      http<{ totalEvents: number }>('/events/manage/residency', {
        method: 'POST',
        body: { ...body, startDate: new Date(body.startDate).toISOString() },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.events.all });
      void client.invalidateQueries({ queryKey: queryKeys.overview.all });
    },
  });
}

export function usePublishEvent(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      http<{ totalSeats: number; sections: number }>(`/events/${eventId}/publish`, {
        method: 'POST',
      }),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: queryKeys.events.lists() });
      const snapshots = client.getQueriesData<EventRow[]>({
        queryKey: queryKeys.events.lists(),
      });
      client.setQueriesData<EventRow[]>(
        { queryKey: queryKeys.events.lists() },
        (events) =>
          events?.map((event) =>
            event.id === eventId ? { ...event, status: 'PUBLISHED' } : event,
          ),
      );
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      context?.snapshots.forEach(([key, value]) => client.setQueryData(key, value));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
      void client.invalidateQueries({ queryKey: queryKeys.events.hub(eventId) });
      void client.invalidateQueries({ queryKey: queryKeys.events.lists() });
    },
  });
}

export function useUpdateOffer(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      offerId,
      ...body
    }: {
      offerId: string;
      basePrice?: number;
      name?: string;
      isAvailable?: boolean;
    }) =>
      http(`/events/manage/${eventId}/offers/${offerId}`, {
        method: 'PUT',
        body,
      }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.events.hub(eventId) }),
  });
}

export function useSetEventPricing(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      basePrice: number;
      dynamicPricingEnabled: boolean;
      customZonePricing?: Record<string, number>;
    }) => http(`/events/manage/${eventId}/pricing`, { method: 'PUT', body }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.events.hub(eventId) }),
  });
}
