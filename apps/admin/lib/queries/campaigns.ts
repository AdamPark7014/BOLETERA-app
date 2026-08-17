'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  allocation: number;
  discountValue: number;
  redeemed?: number;
  codes?: string[];
};

export function useCampaigns(eventId: string) {
  return useQuery({
    queryKey: queryKeys.campaigns.list(eventId),
    queryFn: ({ signal }) => http<Campaign[]>(`/campaigns/list/${eventId}`, { signal }),
    enabled: Boolean(eventId),
  });
}

export function useCampaignAnalytics(campaignId: string) {
  return useQuery({
    queryKey: queryKeys.campaigns.detail(campaignId),
    queryFn: ({ signal }) => http<unknown>(`/campaigns/${campaignId}/analytics`, { signal }),
    enabled: Boolean(campaignId),
  });
}

export function useCreateCampaign(organizationId: string, eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      http<Campaign>(`/campaigns/create/${organizationId}/${eventId}`, {
        method: 'POST',
        body,
      }),
    onSuccess: (campaign) =>
      client.setQueryData<Campaign[]>(
        queryKeys.campaigns.list(eventId),
        (current = []) => [...current, campaign],
      ),
  });
}

export function usePublishCampaign(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      http(`/campaigns/${campaignId}/publish`, { method: 'POST' }),
    onMutate: async (campaignId) => {
      const key = queryKeys.campaigns.list(eventId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Campaign[]>(key);
      client.setQueryData<Campaign[]>(key, (campaigns) =>
        campaigns?.map((campaign) =>
          campaign.id === campaignId ? { ...campaign, status: 'ACTIVE' } : campaign,
        ),
      );
      return { previous };
    },
    onError: (_error, _id, context) =>
      client.setQueryData(queryKeys.campaigns.list(eventId), context?.previous),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.campaigns.list(eventId) }),
  });
}

export function useExportPresaleCodes() {
  return useMutation({
    mutationFn: (campaignId: string) =>
      http<string>(`/campaigns/${campaignId}/codes/export`, { responseType: 'text' }),
  });
}
