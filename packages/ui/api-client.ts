import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

class ApiClient {
  private instance: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.instance = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    });

    this.instance.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    this.instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.token = null;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  getToken() {
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('auth_token');
  }

  // Event management (admin)
  async createEvent(data: Record<string, unknown>) {
    return this.instance.post('/events/manage', data);
  }

  async getEvent(eventId: string) {
    return this.instance.get(`/events/manage/${eventId}/hub`);
  }

  async listEvents() {
    return this.instance.get('/events/manage');
  }

  async updateEvent(eventId: string, data: Record<string, unknown>) {
    return this.instance.put(`/events/manage/${eventId}`, data);
  }

  async publishEvent(eventId: string) {
    return this.instance.post(`/events/${eventId}/publish`, {});
  }

  // Channels
  async configureChannels(eventId: string, data: Record<string, unknown>) {
    return this.instance.post(`/channels/${eventId}/configure`, data);
  }

  async getChannelHealth(eventId: string) {
    return this.instance.get(`/channels/${eventId}/health`);
  }

  // Layouts
  async createVenueLayout(venueId: string, data: Record<string, unknown>) {
    return this.instance.post(`/layouts/venue/${venueId}`, data);
  }

  async holdSeats(
    layoutId: string,
    eventId: string,
    seatIds: string[],
    sessionId?: string,
    durationMinutes = 10
  ) {
    return this.instance.post(`/layouts/${layoutId}/seats/hold`, {
      eventId,
      seatIds,
      sessionId,
      durationMinutes,
    });
  }

  // Search (public)
  async searchEvents(query: string, filters?: Record<string, unknown>) {
    return this.instance.get('/search/events', { params: { query, ...filters } });
  }

  async getTrendingEvents() {
    return this.instance.get('/search/trending');
  }

  async getSmartRecommendations(userId?: string) {
    return this.instance.get('/search/recommendations', { params: userId ? { userId } : {} });
  }

  // Campaigns
  async createCampaign(organizationId: string, eventId: string, data: Record<string, unknown>) {
    return this.instance.post(`/campaigns/create/${organizationId}/${eventId}`, data);
  }

  async listCampaigns(eventId: string) {
    return this.instance.get(`/campaigns/list/${eventId}`);
  }

  async publishCampaign(campaignId: string) {
    return this.instance.post(`/campaigns/${campaignId}/publish`, {});
  }

  async validatePresaleCode(code: string, eventId: string) {
    return this.instance.post('/campaigns/validate-code', { code, eventId });
  }

  // Reporting
  async getRealtimeDashboard(organizationId: string, eventId?: string) {
    return this.instance.get(`/reports/dashboard/realtime/${organizationId}`, {
      params: eventId ? { eventId } : {},
    });
  }

  async getSettlementReport(organizationId: string, period: 'DAILY' | 'WEEKLY' | 'MONTHLY') {
    return this.instance.get(`/reports/settlement/${organizationId}/${period}`);
  }

  async getChannelPerformance(organizationId: string) {
    return this.instance.get(`/reports/channels/${organizationId}`);
  }

  async predictOccupancy(eventId: string) {
    return this.instance.get(`/reports/predict/${eventId}`);
  }

  // Taquilla
  async quickCheckout(data: Record<string, unknown>) {
    return this.instance.post('/taquilla/checkout', data);
  }

  async startCashierSession(terminalId: string) {
    return this.instance.post('/taquilla/session/start', { terminalId });
  }

  async getSessionSummary(sessionId: string) {
    return this.instance.get(`/taquilla/session/summary`, { params: { sessionId } });
  }

  async endCashierSession(sessionId: string) {
    return this.instance.post('/taquilla/session/end', { sessionId });
  }

  // 3D / live inventory (canonical)
  async getInteractive3D(eventId: string) {
    return this.instance.get(`/3d/events/${eventId}/interactive`);
  }

  async get3DRecommendations(eventId: string, preferences: Record<string, unknown>) {
    return this.instance.post(`/3d/events/${eventId}/recommendations`, preferences);
  }

  async getEventOccupancyHeatmap(eventId: string) {
    return this.instance.get(`/3d/events/${eventId}/heatmap`);
  }

  // Discovery (web)
  async listPublicEvents() {
    return this.instance.get('/discovery/events');
  }

  // Auth
  async login(email: string, password: string) {
    const response = await this.instance.post('/auth/login', { email, password });
    if (response.data.accessToken) {
      this.setToken(response.data.accessToken);
    }
    return response;
  }

  async getCurrentUser() {
    return this.instance.get('/auth/me');
  }
}

export const apiClient = new ApiClient();
