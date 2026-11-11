'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.useCreateEvent = useCreateEvent;
exports.useGetEvent = useGetEvent;
exports.useListEvents = useListEvents;
exports.useUpdateEvent = useUpdateEvent;
exports.usePublishEvent = usePublishEvent;
exports.useSetPricingRules = useSetPricingRules;
exports.useCreateCampaign = useCreateCampaign;
exports.useListCampaigns = useListCampaigns;
exports.usePublishCampaign = usePublishCampaign;
exports.useGeneratePresaleCodes = useGeneratePresaleCodes;
exports.useGetCampaignAnalytics = useGetCampaignAnalytics;
exports.useGetRealtimeDashboard = useGetRealtimeDashboard;
exports.useGetSettlementReport = useGetSettlementReport;
exports.useGetChannelPerformance = useGetChannelPerformance;
exports.useGetCustomerAnalytics = useGetCustomerAnalytics;
exports.usePredictOccupancy = usePredictOccupancy;
exports.useGetRevenueForecast = useGetRevenueForecast;
exports.useSearchEvents = useSearchEvents;
exports.useGetTrendingEvents = useGetTrendingEvents;
exports.useGetSmartRecommendations = useGetSmartRecommendations;
exports.useGetOccupancyHeatmap = useGetOccupancyHeatmap;
exports.useGet3DVisualization = useGet3DVisualization;
exports.useGetInteractive3D = useGetInteractive3D;
exports.useGetAISeatRecommendations = useGetAISeatRecommendations;
exports.useHoldSeats = useHoldSeats;
exports.useLogin = useLogin;
exports.useLogout = useLogout;
exports.useGetCurrentUser = useGetCurrentUser;
const react_query_1 = require('@tanstack/react-query');
const api_client_1 = require('../api-client');
// ==================== EVENT MANAGEMENT HOOKS ====================
function useCreateEvent() {
  return (0, react_query_1.useMutation)({
    mutationFn: (data) => api_client_1.apiClient.createEvent(data),
  });
}
function useGetEvent(eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['event', eventId],
    queryFn: () => api_client_1.apiClient.getEvent(eventId),
    enabled: !!eventId,
  });
}
function useListEvents(filters) {
  return (0, react_query_1.useQuery)({
    queryKey: ['events', filters],
    queryFn: () => api_client_1.apiClient.listEvents(filters),
  });
}
function useUpdateEvent(eventId) {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: (data) => api_client_1.apiClient.updateEvent(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
}
function usePublishEvent(eventId) {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: () => api_client_1.apiClient.publishEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    },
  });
}
function useSetPricingRules(eventId) {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: (data) => api_client_1.apiClient.setPricingRules(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    },
  });
}
// ==================== CAMPAIGN MANAGEMENT HOOKS ====================
function useCreateCampaign() {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: (data) =>
      api_client_1.apiClient.createCampaign(data.organizationId, data.eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
function useListCampaigns(eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['campaigns', eventId],
    queryFn: () => api_client_1.apiClient.listCampaigns(eventId),
    enabled: !!eventId,
  });
}
function usePublishCampaign(campaignId) {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: () => api_client_1.apiClient.publishCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
function useGeneratePresaleCodes(campaignId) {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: (count) => api_client_1.apiClient.generatePresaleCodes(campaignId, count),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
  });
}
function useGetCampaignAnalytics(campaignId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['campaign-analytics', campaignId],
    queryFn: () => api_client_1.apiClient.getCampaignAnalytics(campaignId),
    enabled: !!campaignId,
  });
}
// ==================== REPORTING HOOKS ====================
function useGetRealtimeDashboard(organizationId, eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['dashboard', organizationId, eventId],
    queryFn: () => api_client_1.apiClient.getRealtimeDashboard(organizationId, eventId),
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}
function useGetSettlementReport(organizationId, period) {
  return (0, react_query_1.useQuery)({
    queryKey: ['settlement', organizationId, period],
    queryFn: () => api_client_1.apiClient.getSettlementReport(organizationId, period),
  });
}
function useGetChannelPerformance(organizationId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['channels-performance', organizationId],
    queryFn: () => api_client_1.apiClient.getChannelPerformance(organizationId),
  });
}
function useGetCustomerAnalytics(organizationId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['customer-analytics', organizationId],
    queryFn: () => api_client_1.apiClient.getCustomerAnalytics(organizationId),
  });
}
function usePredictOccupancy(eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['occupancy-prediction', eventId],
    queryFn: () => api_client_1.apiClient.predictOccupancy(eventId),
    enabled: !!eventId,
  });
}
function useGetRevenueForecast(organizationId, days) {
  return (0, react_query_1.useQuery)({
    queryKey: ['revenue-forecast', organizationId, days],
    queryFn: () => api_client_1.apiClient.getRevenueForecast(organizationId, days),
  });
}
// ==================== SEARCH HOOKS ====================
function useSearchEvents(query, filters) {
  return (0, react_query_1.useQuery)({
    queryKey: ['search-events', query, filters],
    queryFn: () => api_client_1.apiClient.searchEvents(query, filters),
    enabled: query.length > 0,
  });
}
function useGetTrendingEvents() {
  return (0, react_query_1.useQuery)({
    queryKey: ['trending-events'],
    queryFn: () => api_client_1.apiClient.getTrendingEvents(),
  });
}
function useGetSmartRecommendations() {
  return (0, react_query_1.useQuery)({
    queryKey: ['smart-recommendations'],
    queryFn: () => api_client_1.apiClient.getSmartRecommendations(),
  });
}
// ==================== LAYOUT / 3D HOOKS ====================
function useGetOccupancyHeatmap(layoutId, eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['heatmap', eventId],
    queryFn: () => api_client_1.apiClient.getEventOccupancyHeatmap(eventId),
    enabled: !!eventId || !!layoutId,
  });
}
function useGet3DVisualization(layoutId, eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['3d-interactive', eventId],
    queryFn: () => api_client_1.apiClient.getInteractive3D(eventId),
    enabled: !!eventId || !!layoutId,
  });
}
function useGetInteractive3D(eventId) {
  return (0, react_query_1.useQuery)({
    queryKey: ['3d-interactive', eventId],
    queryFn: () => api_client_1.apiClient.getInteractive3D(eventId),
    enabled: !!eventId,
  });
}
function useGetAISeatRecommendations(layoutIdOrEventId, preferences = {}) {
  const eventId = preferences.eventId ?? layoutIdOrEventId;
  return (0, react_query_1.useQuery)({
    queryKey: ['seat-recommendations', eventId, preferences],
    queryFn: () =>
      api_client_1.apiClient.get3DRecommendations(eventId, {
        count: preferences.count ?? 2,
        viewQuality: preferences.viewQuality ?? 'best',
        ...(preferences.tier ? { tier: preferences.tier } : {}),
      }),
    enabled: !!eventId,
  });
}
function useHoldSeats(layoutId, eventId) {
  const queryClient = (0, react_query_1.useQueryClient)();
  return (0, react_query_1.useMutation)({
    mutationFn: (seatIds) => api_client_1.apiClient.holdSeats(layoutId, eventId, seatIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['heatmap', layoutId, eventId] });
    },
  });
}
// ==================== AUTH HOOKS ====================
function useLogin() {
  return (0, react_query_1.useMutation)({
    mutationFn: (credentials) =>
      api_client_1.apiClient.login(credentials.email, credentials.password),
  });
}
function useLogout() {
  return (0, react_query_1.useMutation)({
    mutationFn: () => api_client_1.apiClient.logout(),
  });
}
function useGetCurrentUser() {
  return (0, react_query_1.useQuery)({
    queryKey: ['me'],
    queryFn: () => api_client_1.apiClient.getCurrentUser(),
  });
}
//# sourceMappingURL=hooks.js.map
