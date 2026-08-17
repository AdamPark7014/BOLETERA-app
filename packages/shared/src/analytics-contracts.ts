/**
 * Shared analytics / metrics contracts for Boletera admin dashboards.
 * Single source of truth for API payloads consumed by admin + web clients.
 * Currency: MXN. Business timezone: America/Mexico_City.
 */

/** Supported time-bucket granularities for series endpoints. */
export type MetricsGranularity = 'hour' | 'day' | 'week' | 'month';

/** Alert severity for actionable recommendations. */
export type MetricsAlertSeverity = 'info' | 'warning' | 'critical';

/** Alert domain / source module. */
export type MetricsAlertDomain =
  | 'executive'
  | 'events'
  | 'inventory'
  | 'orders'
  | 'access'
  | 'resale'
  | 'waitlist'
  | 'campaigns'
  | 'fraud'
  | 'settlements';

/** Standard date range used by every metrics query. */
export interface MetricsDateRange {
  from: string; // ISO-8601
  to: string; // ISO-8601
}

/** Paginated list envelope. */
export interface MetricsPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MetricsPaged<T> {
  items: T[];
  meta: MetricsPageMeta;
}

/** Generic KPI with period-over-period comparison. */
export interface MetricsKpi<T = number> {
  key: string;
  label: string;
  value: T;
  previousValue: T;
  /** Absolute delta (value - previousValue). */
  delta: T;
  /** Percent change vs previous period; null when previous is zero. */
  deltaPercent: number | null;
  unit?: 'mxn' | 'count' | 'percent' | 'ratio';
  currency?: 'MXN';
}

/** Generic time-series point. */
export interface MetricsTimePoint {
  /** Bucket start instant (ISO-8601, Mexico City wall-clock aligned). */
  bucket: string;
  value: number;
  label?: string;
}

/** Named series (e.g. revenue + orders on same axis). */
export interface MetricsTimeSeries {
  key: string;
  label: string;
  granularity: MetricsGranularity;
  unit?: 'mxn' | 'count' | 'percent';
  points: MetricsTimePoint[];
}

/** Breakdown row for a categorical dimension. */
export interface MetricsDimensionRow {
  key: string;
  label: string;
  value: number;
  secondaryValue?: number;
  percentOfTotal?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface MetricsBreakdown {
  dimension: string;
  label: string;
  total: number;
  rows: MetricsDimensionRow[];
}

/** Funnel stage for conversion analytics. */
export interface MetricsFunnelStage {
  key: string;
  label: string;
  count: number;
  /** Conversion from previous stage; null for first stage. */
  conversionFromPrevious: number | null;
  /** Conversion from top of funnel. */
  conversionFromTop: number;
}

export interface MetricsFunnel {
  key: string;
  label: string;
  stages: MetricsFunnelStage[];
}

/** Actionable alert / recommendation derived from aggregates. */
export interface MetricsAlert {
  id: string;
  domain: MetricsAlertDomain;
  severity: MetricsAlertSeverity;
  title: string;
  /** Human-readable explanation in Spanish. */
  explanation: string;
  /** Suggested next action in Spanish. */
  suggestedAction: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  metricValue?: number;
  threshold?: number;
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Domain payloads
// ---------------------------------------------------------------------------

export interface ExecutiveSummaryMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  comparisonRange: MetricsDateRange;
  currency: 'MXN';
  timezone: 'America/Mexico_City';
  kpis: {
    grossRevenue: MetricsKpi;
    netRevenue: MetricsKpi;
    ticketsSold: MetricsKpi;
    averageTicketPrice: MetricsKpi;
    conversionRate: MetricsKpi;
    ordersCompleted: MetricsKpi;
  };
  revenueByChannel: MetricsBreakdown;
  projection: {
    /** Linear projection of period revenue to full comparable window. */
    projectedGrossRevenue: number;
    projectedTicketsSold: number;
    method: 'linear_pace';
    daysElapsed: number;
    daysInPeriod: number;
  };
  series: MetricsTimeSeries[];
  generatedAt: string;
}

export interface EventSalesPaceRow {
  eventId: string;
  title: string;
  status: string;
  startsAt: string;
  daysUntilEvent: number;
  totalCapacity: number;
  ticketsSold: number;
  occupancyPercent: number;
  remainingCapacity: number;
  grossRevenue: number;
  /** Actual cumulative sell-through pace (sold / capacity). */
  actualPace: number;
  /**
   * Expected pace assuming linear sell-through from salesStart (or createdAt)
   * to event start. 0–1.
   */
  expectedPace: number;
  /** actualPace - expectedPace (negative = behind). */
  paceDelta: number;
  riskLevel: 'on_track' | 'watch' | 'at_risk' | 'critical';
}

export interface EventSalesPaceMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  events: EventSalesPaceRow[];
  atRisk: EventSalesPaceRow[];
  topPerformers: EventSalesPaceRow[];
  generatedAt: string;
}

export interface InventoryZoneRow {
  eventId: string;
  eventTitle: string;
  offerId: string;
  zone: string;
  tierName: string;
  totalQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  holdQuantity: number;
  availabilityPercent: number;
  /** Tickets sold per day since offer start (or event created). */
  sellThroughVelocity: number;
  /** Estimated days to sell-out at current velocity; null if velocity ~0. */
  daysToSellOut: number | null;
}

export interface InventoryMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  summary: {
    totalCapacity: number;
    available: number;
    held: number;
    sold: number;
    blocked: number;
    activeHolds: number;
  };
  byZone: InventoryZoneRow[];
  statusBreakdown: MetricsBreakdown;
  generatedAt: string;
}

export interface OrdersPaymentsMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  comparisonRange: MetricsDateRange;
  volumeByStatus: MetricsBreakdown;
  paymentMethodBreakdown: MetricsBreakdown;
  kpis: {
    approvalRate: MetricsKpi;
    refundRate: MetricsKpi;
    chargebackCount: MetricsKpi;
    completedOrders: MetricsKpi;
    grossRevenue: MetricsKpi;
  };
  generatedAt: string;
}

export interface AccessAttendanceMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  eventId?: string;
  checkInByHour: MetricsTimeSeries;
  noShowRate: number;
  ticketsSold: number;
  ticketsCheckedIn: number;
  ticketsNoShow: number;
  trafficByAccessPoint: MetricsBreakdown;
  generatedAt: string;
}

export interface ResaleMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  summary: {
    activeListings: number;
    soldListings: number;
    cancelledListings: number;
    grossGmv: number;
    platformFees: number;
    averageAskingPrice: number;
    averageSoldPrice: number;
  };
  statusBreakdown: MetricsBreakdown;
  series: MetricsTimeSeries[];
  generatedAt: string;
}

export interface WaitlistMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  summary: {
    pending: number;
    notified: number;
    converted: number;
    expired: number;
    cancelled: number;
    conversionRate: number;
  };
  byEvent: MetricsDimensionRow[];
  funnel: MetricsFunnel;
  generatedAt: string;
}

export interface CampaignFunnelMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  promotions: Array<{
    promotionId: string;
    code: string;
    name: string;
    usageCount: number;
    usageLimit: number | null;
    ordersAttributed: number;
    revenueAttributed: number;
    discountGiven: number;
    conversionRate: number;
    performance: 'strong' | 'average' | 'poor';
  }>;
  funnel: MetricsFunnel;
  generatedAt: string;
}

export interface FraudSignalsMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  summary: {
    totalFlags: number;
    openFlags: number;
    criticalFlags: number;
    averageRiskScore: number;
    resolvedFlags: number;
    falsePositives: number;
  };
  byType: MetricsBreakdown;
  bySeverity: MetricsBreakdown;
  recentSignals: Array<{
    id: string;
    type: string;
    severity: string;
    score: number;
    reason: string;
    status: string;
    orderId: string | null;
    eventId: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
}

export interface SettlementsMetrics {
  organizationId: string;
  dateRange: MetricsDateRange;
  summary: {
    grossRevenue: number;
    refunds: number;
    commission: number;
    netPayable: number;
    pendingPayouts: number;
    completedPayouts: number;
  };
  payouts: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    grossRevenue: number;
    commission: number;
    netAmount: number;
    status: string;
    referenceId: string | null;
    processedAt: string | null;
  }>;
  byEvent: MetricsDimensionRow[];
  generatedAt: string;
}

export interface MetricsTimeSeriesResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  granularity: MetricsGranularity;
  metric: string;
  series: MetricsTimeSeries[];
  generatedAt: string;
}

export interface MetricsAlertsResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  alerts: MetricsAlert[];
  countsBySeverity: Record<MetricsAlertSeverity, number>;
  generatedAt: string;
}

/** Legacy / event-scoped dashboard still served by analytics module. */
export interface EventDashboardMetrics {
  eventId: string;
  organizationId: string;
  title: string;
  status: string;
  startsAt: string;
  venue: { name: string };
  metrics: {
    completedOrders: number;
    failedOrders: number;
    totalTickets: number;
    soldTickets: number;
    soldPercent: number;
    refundedTickets: number;
    fraudFlags: number;
  };
  revenue: {
    gross: number;
    commission: number;
    net: number;
    currency: string;
  };
  offers: Array<{
    id: string;
    name: string;
    basePrice: number;
    totalQuantity: number;
    remainingQuantity: number;
  }>;
  generatedAt: string;
}

export interface PromoterDashboardMetrics {
  organizationId: string;
  name: string;
  period: 'DAY' | 'WEEK' | 'MONTH';
  dateRange: MetricsDateRange;
  metrics: {
    totalOrders: number;
    totalTicketsSold: number;
    totalRevenue: number;
    commission: number;
    netRevenue: number;
    currency: string;
  };
  topEvents: Array<{
    eventId: string;
    eventTitle: string;
    orders: number;
    revenue: number;
  }>;
  generatedAt: string;
}
