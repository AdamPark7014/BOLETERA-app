'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { ChannelAnalyticsMap, ChannelHealthMap } from '../platform-api';

export type ChannelEntryConfiguration = {
  enabled: boolean;
  allocation: number;
  responsibleParty?: string;
  locations?: string[];
  partners?: string[];
  hours?: string;
  discount?: number;
  activeHours?: string;
};

export type ChannelConfiguration = Partial<
  Record<
    | 'web'
    | 'taquilla'
    | 'api'
    | 'admin'
    | 'promoter'
    | 'courtesy'
    | 'corporate'
    | 'mobile'
    | 'phone'
    | 'invitation'
    | 'affiliate'
    | 'vip'
    | 'resale',
    ChannelEntryConfiguration
  >
>;

export function useChannelHealth(eventId: string) {
  return useQuery({
    queryKey: queryKeys.channels.health(eventId),
    queryFn: ({ signal }) =>
      http<ChannelHealthMap>(`/channels/${eventId}/health`, { signal }),
    enabled: Boolean(eventId),
  });
}

export function useChannelAnalytics(eventId: string) {
  return useQuery({
    queryKey: queryKeys.channels.analytics(eventId),
    queryFn: ({ signal }) =>
      http<ChannelAnalyticsMap>(`/channels/${eventId}/analytics`, { signal }),
    enabled: Boolean(eventId),
  });
}

export function useConfigureChannels(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ChannelConfiguration) =>
      http(`/channels/${eventId}/configure`, { method: 'POST', body }),
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.channels.health(eventId) });
    },
  });
}
