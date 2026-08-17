/**
 * Shared AI / intelligence engine contracts for TicketOS.
 * Deterministic, explainable predictions — no LLM payloads.
 * Currency: MXN. Business timezone: America/Mexico_City.
 */

import type { MetricsDateRange } from './analytics-contracts';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Statistical confidence band for a numeric forecast. */
export type AiConfidenceLevel = 'none' | 'low' | 'medium' | 'high';

/** Explicit insufficiency instead of inventing a number. */
export type AiDataSufficiency = 'sufficient' | 'limited' | 'insufficient';

export interface AiConfidenceInterval {
  /** Point estimate (mean / median of the projection). */
  point: number;
  /** Lower bound of the interval (inclusive). */
  lower: number;
  /** Upper bound of the interval (inclusive). */
  upper: number;
  /** Nominal coverage, e.g. 0.8 for an 80% interval. */
  coverage: number;
  /** Qualitative confidence derived from sample size + residual variance. */
  level: AiConfidenceLevel;
  /** Number of observations / peers used. */
  sampleSize: number;
  sufficiency: AiDataSufficiency;
}

export interface AiMethodMeta {
  /** Stable method id, e.g. "holt_linear_blend". */
  id: string;
  /** Human-readable method name in Spanish. */
  name: string;
  /** Short justification of why this method was chosen. */
  rationale: string;
}

export interface AiFactor {
  key: string;
  label: string;
  /** Contribution weight in [-1, 1] or absolute score points. */
  weight: number;
  /** Observed value that triggered the factor (optional). */
  value?: number;
  /** Spanish explanation of this factor. */
  explanation: string;
}

// ---------------------------------------------------------------------------
// 1) Sales & occupancy forecast
// ---------------------------------------------------------------------------

export interface AiSalesForecastRequest {
  eventId: string;
  /** Optional ISO range used when building the observed sales curve. */
  from?: string;
  to?: string;
}

export interface AiComparableEventRef {
  eventId: string;
  title: string;
  category: string;
  similarity: number;
  finalOccupancyPercent: number;
  finalGrossRevenue: number;
}

export interface AiSalesForecastResponse {
  organizationId: string;
  eventId: string;
  eventTitle: string;
  startsAt: string;
  daysUntilEvent: number;
  totalCapacity: number;
  ticketsSold: number;
  grossRevenue: number;
  occupancyPercent: number;
  currency: 'MXN';
  timezone: 'America/Mexico_City';
  method: AiMethodMeta;
  projectedTicketsSold: AiConfidenceInterval;
  projectedOccupancyPercent: AiConfidenceInterval;
  projectedGrossRevenue: AiConfidenceInterval;
  comparables: AiComparableEventRef[];
  /** Daily observed cumulative sell-through used as input (0–1). */
  observedPace: Array<{ dayIndex: number; cumulativeOccupancy: number }>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 2) Anomaly detection
// ---------------------------------------------------------------------------

export type AiAnomalyMetric =
  | 'tickets_sold'
  | 'gross_revenue'
  | 'refund_amount'
  | 'payment_approval_rate'
  | 'access_traffic';

export type AiAnomalyDirection = 'spike' | 'drop';

export interface AiAnomalyPoint {
  metric: AiAnomalyMetric;
  bucket: string;
  observed: number;
  baselineMean: number;
  baselineStd: number;
  zScore: number;
  direction: AiAnomalyDirection;
  severity: 'watch' | 'alert' | 'critical';
  explanation: string;
  eventId?: string;
  eventTitle?: string;
}

export interface AiAnomaliesResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  method: AiMethodMeta;
  /** Z-score absolute threshold used (default 2.5). */
  zThreshold: number;
  anomalies: AiAnomalyPoint[];
  baselineWindows: number;
  sufficiency: AiDataSufficiency;
  sampleSize: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 3) Fraud risk scoring
// ---------------------------------------------------------------------------

export type AiFraudRiskBand = 'low' | 'medium' | 'high' | 'critical';

export interface AiFraudRiskScore {
  subjectType: 'order' | 'user';
  subjectId: string;
  score: number;
  band: AiFraudRiskBand;
  factors: AiFactor[];
  relatedOrderIds?: string[];
  relatedEventIds?: string[];
}

export interface AiFraudRiskResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  method: AiMethodMeta;
  scores: AiFraudRiskScore[];
  summary: {
    scored: number;
    highOrCritical: number;
    averageScore: number;
  };
  generatedAt: string;
}

export interface AiFraudRiskOrderResponse {
  organizationId: string;
  method: AiMethodMeta;
  score: AiFraudRiskScore;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 4) Actionable recommendations
// ---------------------------------------------------------------------------

export type AiRecommendationKind =
  | 'boost_sales_pace'
  | 'clear_inventory_zone'
  | 'improve_campaign'
  | 'review_pricing'
  | 'investigate_anomaly'
  | 'mitigate_fraud';

export type AiRecommendationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface AiRecommendation {
  id: string;
  kind: AiRecommendationKind;
  priority: AiRecommendationPriority;
  title: string;
  /** Concrete action in Spanish. */
  action: string;
  rationale: string;
  /** Estimated incremental tickets or MXN impact when estimable. */
  estimatedImpact: {
    metric: 'tickets' | 'revenue_mxn' | 'occupancy_pp' | 'risk_reduction';
    value: number;
    unit: string;
  } | null;
  confidence: AiConfidenceLevel;
  sufficiency: AiDataSufficiency;
  sampleSize: number;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  factors: AiFactor[];
}

export interface AiRecommendationsResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  method: AiMethodMeta;
  recommendations: AiRecommendation[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 5) Deterministic executive narratives
// ---------------------------------------------------------------------------

export interface AiExecutiveNarrativeResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  comparisonRange: MetricsDateRange;
  language: 'es-MX';
  timezone: 'America/Mexico_City';
  currency: 'MXN';
  method: AiMethodMeta;
  /** Deterministic Spanish summary; never invents unobserved facts. */
  narrative: string;
  highlights: string[];
  watchouts: string[];
  kpisCited: Array<{
    key: string;
    label: string;
    value: number;
    previousValue: number;
    deltaPercent: number | null;
    unit: 'mxn' | 'count' | 'percent' | 'ratio';
  }>;
  generatedAt: string;
}

/**
 * Optional future LLM boundary. Implementations must remain deterministic
 * until an explicit adapter is injected; the default engine never calls LLMs.
 */
export interface AiNarrativeRenderer {
  render(input: {
    language: 'es-MX';
    facts: string[];
    highlights: string[];
    watchouts: string[];
  }): string;
}

// ---------------------------------------------------------------------------
// 6) Customer segmentation & churn
// ---------------------------------------------------------------------------

export type AiCustomerSegment =
  | 'champion'
  | 'loyal'
  | 'promising'
  | 'at_risk'
  | 'hibernating'
  | 'new'
  | 'insufficient_history';

export interface AiCustomerSegmentRow {
  userId: string;
  email: string;
  segment: AiCustomerSegment;
  /** Recency days since last completed order. */
  recencyDays: number;
  frequency: number;
  monetaryMxn: number;
  churnProbability: number | null;
  churnConfidence: AiConfidenceLevel;
  factors: AiFactor[];
}

export interface AiSegmentationResponse {
  organizationId: string;
  dateRange: MetricsDateRange;
  method: AiMethodMeta;
  sufficiency: AiDataSufficiency;
  sampleSize: number;
  segments: Array<{
    segment: AiCustomerSegment;
    count: number;
    percentOfTotal: number;
    averageMonetaryMxn: number;
  }>;
  customers: AiCustomerSegmentRow[];
  generatedAt: string;
}
