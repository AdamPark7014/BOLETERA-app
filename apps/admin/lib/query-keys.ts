type QueryScope = readonly unknown[];

const scope = <T extends QueryScope>(...parts: T): T => parts;

export const queryKeys = {
  session: {
    all: scope('session'),
    me: () => scope('session', 'me'),
  },
  overview: {
    all: scope('overview'),
    platform: () => scope('overview', 'platform'),
  },
  events: {
    all: scope('events'),
    lists: () => scope('events', 'list'),
    list: (filters: Record<string, unknown> = {}) => scope('events', 'list', filters),
    detail: (eventId: string) => scope('events', 'detail', eventId),
    hub: (eventId: string) => scope('events', 'hub', eventId),
    calendar: (month: number, year: number) => scope('events', 'calendar', year, month),
    byVenue: (venueId: string) => scope('events', 'venue', venueId),
  },
  orders: {
    all: scope('orders'),
    list: (filters: Record<string, unknown> = {}) => scope('orders', 'list', filters),
    detail: (orderId: string) => scope('orders', 'detail', orderId),
  },
  venues: {
    all: scope('venues'),
    list: () => scope('venues', 'list'),
    detail: (venueId: string) => scope('venues', 'detail', venueId),
    layout: (venueId: string) => scope('venues', venueId, 'layout'),
    egress: (venueId: string) => scope('venues', venueId, 'egress'),
    egressOverview: () => scope('venues', 'egress-overview'),
  },
  analytics: {
    all: scope('analytics'),
    promoter: (organizationId: string, period: string) =>
      scope('analytics', 'promoter', organizationId, period),
    realtime: (organizationId: string, eventId?: string) =>
      scope('analytics', 'realtime', organizationId, eventId ?? 'all'),
  },
  ai: {
    all: scope('ai'),
    forecast: (eventId: string, params: Record<string, unknown> = {}) =>
      scope('ai', 'forecast', eventId, params),
    anomalies: (params: Record<string, unknown> = {}) =>
      scope('ai', 'anomalies', params),
    fraudRisk: (params: Record<string, unknown> = {}) =>
      scope('ai', 'fraud-risk', params),
    fraudOrder: (orderId: string, params: Record<string, unknown> = {}) =>
      scope('ai', 'fraud-order', orderId, params),
    recommendations: (params: Record<string, unknown> = {}) =>
      scope('ai', 'recommendations', params),
    executive: (params: Record<string, unknown> = {}) =>
      scope('ai', 'executive', params),
    /** @deprecated Prefer `executive` — kept for cache key continuity during rename. */
    narrative: (params: Record<string, unknown> = {}) =>
      scope('ai', 'executive', params),
    segmentation: (params: Record<string, unknown> = {}) =>
      scope('ai', 'segmentation', params),
  },
  metrics: {
    all: scope('metrics'),
    executive: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'executive', params),
    salesPace: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'sales-pace', params),
    inventory: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'inventory', params),
    orders: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'orders', params),
    access: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'access', params),
    resale: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'resale', params),
    waitlist: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'waitlist', params),
    campaigns: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'campaigns', params),
    fraud: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'fraud', params),
    settlements: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'settlements', params),
    timeseries: (params: Record<string, unknown>) =>
      scope('metrics', 'timeseries', params),
    alerts: (params: Record<string, unknown> = {}) =>
      scope('metrics', 'alerts', params),
  },
  campaigns: {
    all: scope('campaigns'),
    list: (eventId: string) => scope('campaigns', 'list', eventId),
    detail: (campaignId: string) => scope('campaigns', 'detail', campaignId),
  },
  channels: {
    all: scope('channels'),
    health: (eventId: string) => scope('channels', 'health', eventId),
  },
  /** Claves de composición CRM (sin GET /crm/*; cache de vistas derivadas). */
  crm: {
    all: scope('crm'),
    workspace: (params: Record<string, unknown> = {}) =>
      scope('crm', 'workspace', params),
  },
  resale: {
    all: scope('resale'),
    listings: (limit: number) => scope('resale', 'listings', limit),
  },
  waitlist: {
    all: scope('waitlist'),
    organization: (organizationId: string) => scope('waitlist', organizationId),
  },
  partners: {
    all: scope('partners'),
    keys: (organizationId: string) => scope('partners', organizationId, 'keys'),
  },
  apiManagement: {
    all: scope('api-management'),
    /** Comparte caché con partners.keys — misma fuente GET /partners/:org/keys. */
    keys: (organizationId: string) => scope('partners', organizationId, 'keys'),
    usage: (organizationId: string) =>
      scope('api-management', organizationId, 'usage'),
    quotas: (organizationId: string) =>
      scope('api-management', organizationId, 'quotas'),
  },
  integrations: {
    all: scope('integrations'),
    catalog: () => scope('integrations', 'catalog'),
    banorteConfig: () => scope('integrations', 'banorte', 'config'),
    banorteValidate: () => scope('integrations', 'banorte', 'validate'),
    webhookHealth: () => scope('integrations', 'webhooks', 'health'),
  },
  payouts: {
    all: scope('payouts'),
    list: () => scope('payouts', 'list'),
    settlement: (organizationId: string, period: string) =>
      scope('payouts', organizationId, 'settlement', period),
  },
  fraud: {
    all: scope('fraud'),
    flags: (limit: number) => scope('fraud', 'flags', limit),
  },
  inventory: {
    all: scope('inventory'),
    metrics: (params: Record<string, unknown> = {}) =>
      scope('inventory', 'metrics', params),
    salesPace: (params: Record<string, unknown> = {}) =>
      scope('inventory', 'sales-pace', params),
    alerts: (params: Record<string, unknown> = {}) =>
      scope('inventory', 'alerts', params),
    availability: (eventId: string) => scope('inventory', 'availability', eventId),
  },
  reservations: {
    all: scope('reservations'),
    inventory: (params: Record<string, unknown> = {}) =>
      scope('reservations', 'inventory', params),
    ordersMetrics: (params: Record<string, unknown> = {}) =>
      scope('reservations', 'orders-metrics', params),
    orders: (filters: Record<string, unknown> = {}) =>
      scope('reservations', 'orders', filters),
  },
  pricing: {
    all: scope('pricing'),
    recommendations: (eventId: string) =>
      scope('pricing', 'recommendations', eventId),
    pending: (eventId: string) => scope('pricing', 'pending', eventId),
    revenue: (eventId: string) => scope('pricing', 'revenue-estimate', eventId),
    history: (offerId: string, limit: number) =>
      scope('pricing', 'history', offerId, limit),
    event: (eventId: string) => scope('pricing', eventId),
  },
  audit: {
    all: scope('audit'),
    log: (organizationId: string, limit: number) =>
      scope('audit', organizationId, limit),
  },
  billing: {
    all: scope('billing'),
    fiscalProfile: (organizationId: string) =>
      scope('billing', organizationId, 'fiscal-profile'),
    invoices: (organizationId: string) => scope('billing', organizationId, 'invoices'),
  },
  season: {
    all: scope('season'),
    list: (organizationId: string) => scope('season', organizationId),
  },
  memberships: {
    all: scope('memberships'),
    plans: (organizationId: string) => scope('memberships', organizationId, 'plans'),
    plan: (planId: string) => scope('memberships', 'plan', planId),
    metrics: (organizationId: string) => scope('memberships', organizationId, 'metrics'),
    benefits: (organizationId: string) => scope('memberships', organizationId, 'benefits'),
    benefitUsage: (organizationId: string) =>
      scope('memberships', organizationId, 'benefits', 'usage'),
    renewals: (organizationId: string) => scope('memberships', organizationId, 'renewals'),
    retention: (organizationId: string) => scope('memberships', organizationId, 'retention'),
    activity: (organizationId: string) => scope('memberships', organizationId, 'activity'),
  },
  sponsorships: {
    all: scope('sponsorships'),
    sponsors: (organizationId: string) =>
      scope('sponsorships', organizationId, 'sponsors'),
    assets: (organizationId: string) => scope('sponsorships', organizationId, 'assets'),
    packages: (organizationId: string) =>
      scope('sponsorships', organizationId, 'packages'),
    activations: (organizationId: string) =>
      scope('sponsorships', organizationId, 'activations'),
    compliance: (organizationId: string) =>
      scope('sponsorships', organizationId, 'compliance'),
    activity: (organizationId: string) =>
      scope('sponsorships', organizationId, 'activity'),
  },
  reports: {
    all: scope('reports'),
    sales: () => scope('reports', 'sales'),
    zReports: (organizationId: string) => scope('reports', 'z', organizationId),
  },
  organization: {
    all: scope('organization'),
    detail: (organizationId: string) => scope('organization', organizationId),
    capabilities: (organizationId: string) =>
      scope('organization', organizationId, 'capabilities'),
    team: (organizationId: string) => scope('organization', organizationId, 'team'),
  },
  branding: {
    all: scope('branding'),
    detail: () => scope('branding', 'detail'),
  },
  scanner: {
    all: scope('scanner'),
  },
} as const;

export type AppQueryKey =
  | ReturnType<typeof queryKeys.events.list>
  | ReturnType<typeof queryKeys.orders.list>
  | ReturnType<typeof queryKeys.venues.list>
  | ReturnType<typeof queryKeys.organization.detail>;
