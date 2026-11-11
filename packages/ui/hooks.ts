import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';

// ==================== EVENT MANAGEMENT HOOKS ====================

export function useCreateEvent() {
  return useMutation({
    mutationFn: (data: any) => apiClient.createEvent(data),
  });
}

export function useGetEvent(eventId: string) {
  return useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiClient.getEvent(eventId),
    enabled: !!eventId,
  });
}

export function useListEvents(filters?: any) {
  return useQuery({
    queryKey: ['events', filters],
    queryFn: () => apiClient.listEvents(filters),
  });
}

export function useUpdateEvent(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.updateEvent(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function usePublishEvent(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.publishEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    },
  });
}

export function useSetPricingRules(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.setPricingRules(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    },
  });
}

// ==================== CAMPAIGN MANAGEMENT HOOKS ====================

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.createCampaign(data.organizationId, data.eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useListCampaigns(eventId: string) {
  return useQuery({
    queryKey: ['campaigns', eventId],
    queryFn: () => apiClient.listCampaigns(eventId),
    enabled: !!eventId,
  });
}

export function usePublishCampaign(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.publishCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useGeneratePresaleCodes(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (count: number) => apiClient.generatePresaleCodes(campaignId, count),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
  });
}

export function useGetCampaignAnalytics(campaignId: string) {
  return useQuery({
    queryKey: ['campaign-analytics', campaignId],
    queryFn: () => apiClient.getCampaignAnalytics(campaignId),
    enabled: !!campaignId,
  });
}

// ==================== REPORTING HOOKS ====================

export function useGetRealtimeDashboard(organizationId: string, eventId?: string) {
  return useQuery({
    queryKey: ['dashboard', organizationId, eventId],
    queryFn: () => apiClient.getRealtimeDashboard(organizationId, eventId),
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}

export function useGetSettlementReport(
  organizationId: string,
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
) {
  return useQuery({
    queryKey: ['settlement', organizationId, period],
    queryFn: () => apiClient.getSettlementReport(organizationId, period),
  });
}

export function useGetChannelPerformance(organizationId: string) {
  return useQuery({
    queryKey: ['channels-performance', organizationId],
    queryFn: () => apiClient.getChannelPerformance(organizationId),
  });
}

export function useGetCustomerAnalytics(organizationId: string) {
  return useQuery({
    queryKey: ['customer-analytics', organizationId],
    queryFn: () => apiClient.getCustomerAnalytics(organizationId),
  });
}

export function usePredictOccupancy(eventId: string) {
  return useQuery({
    queryKey: ['occupancy-prediction', eventId],
    queryFn: () => apiClient.predictOccupancy(eventId),
    enabled: !!eventId,
  });
}

export function useGetRevenueForecast(organizationId: string, days?: number) {
  return useQuery({
    queryKey: ['revenue-forecast', organizationId, days],
    queryFn: () => apiClient.getRevenueForecast(organizationId, days),
  });
}

// ==================== SEARCH HOOKS ====================

export function useSearchEvents(query: string, filters?: any) {
  return useQuery({
    queryKey: ['search-events', query, filters],
    queryFn: () => apiClient.searchEvents(query, filters),
    enabled: query.length > 0,
  });
}

export function useGetTrendingEvents() {
  return useQuery({
    queryKey: ['trending-events'],
    queryFn: () => apiClient.getTrendingEvents(),
  });
}

export function useGetSmartRecommendations() {
  return useQuery({
    queryKey: ['smart-recommendations'],
    queryFn: () => apiClient.getSmartRecommendations(),
  });
}

// ==================== LAYOUT / 3D HOOKS ====================

/** Live occupancy counts for an event (`GET /3d/events/:id/heatmap`). */
export function useGetOccupancyHeatmap(layoutId: string, eventId: string) {
  return useQuery({
    queryKey: ['heatmap', eventId],
    queryFn: () => apiClient.getEventOccupancyHeatmap(eventId),
    enabled: !!eventId || !!layoutId,
  });
}

/** Live seat status envelope (`GET /3d/events/:id/interactive`). layoutId ignored. */
export function useGet3DVisualization(layoutId: string, eventId: string) {
  return useQuery({
    queryKey: ['3d-interactive', eventId],
    queryFn: () => apiClient.getInteractive3D(eventId),
    enabled: !!eventId || !!layoutId,
  });
}

/** Preferred alias for interactive 3D status. */
export function useGetInteractive3D(eventId: string) {
  return useQuery({
    queryKey: ['3d-interactive', eventId],
    queryFn: () => apiClient.getInteractive3D(eventId),
    enabled: !!eventId,
  });
}

/**
 * Sightline recommendations (`POST /3d/events/:id/recommendations`).
 * Pass eventId as first arg (legacy callers used layoutId; if preferences.eventId is set it wins).
 */
export function useGetAISeatRecommendations(
  layoutIdOrEventId: string,
  preferences: {
    eventId?: string;
    count?: number;
    viewQuality?: 'best' | 'good' | 'any';
    tier?: 'premium' | 'standard' | 'economy';
  } = {}
) {
  const eventId = preferences.eventId ?? layoutIdOrEventId;
  return useQuery({
    queryKey: ['seat-recommendations', eventId, preferences],
    queryFn: () =>
      apiClient.get3DRecommendations(eventId, {
        count: preferences.count ?? 2,
        viewQuality: preferences.viewQuality ?? 'best',
        ...(preferences.tier ? { tier: preferences.tier } : {}),
      }),
    enabled: !!eventId,
  });
}

export function useHoldSeats(layoutId: string, eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (seatIds: string[]) => apiClient.holdSeats(layoutId, eventId, seatIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['heatmap', layoutId, eventId] });
    },
  });
}

// ==================== AUTH HOOKS ====================

export function useLogin() {
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiClient.login(credentials.email, credentials.password),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => apiClient.logout(),
  });
}

export function useGetCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiClient.getCurrentUser(),
  });
}
