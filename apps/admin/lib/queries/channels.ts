'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { ChannelHealthMap } from '../platform-api';

export type ChannelConfiguration = {
  web: { enabled: boolean; allocation: number };
  taquilla: { enabled: boolean; allocation: number; locations?: string[] };
  api: { enabled: boolean; allocation: number };
  phone?: { enabled: boolean; allocation: number };
};

export function useChannelHealth(eventId: string) {
  return useQuery({
    queryKey: queryKeys.channels.health(eventId),
    queryFn: ({ signal }) =>
      http<ChannelHealthMap>(`/channels/${eventId}/health`, { signal }),
    enabled: Boolean(eventId),
  });
}

export function useConfigureChannels(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ChannelConfiguration) =>
      http(`/channels/${eventId}/configure`, { method: 'POST', body }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.channels.health(eventId) }),
  });
}
