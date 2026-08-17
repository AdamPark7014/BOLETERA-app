'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AiAnomaliesResponse,
  AiAnomalyMetric,
  AiExecutiveNarrativeResponse,
  AiFraudRiskOrderResponse,
  AiFraudRiskResponse,
  AiRecommendationsResponse,
  AiSalesForecastResponse,
  AiSegmentationResponse,
} from '@boletera/shared';
import { http } from '../http';
import { queryKeys } from '../query-keys';

/** Common range / scope filters for /ai/* endpoints. */
export type AiRangeParams = {
  from?: string;
  to?: string;
  eventId?: string;
  organizationId?: string;
};

export type AiAnomaliesParams = AiRangeParams & {
  metric?: AiAnomalyMetric;
  zThreshold?: number;
};

export type AiFraudRiskParams = AiRangeParams & {
  limit?: number;
};

export type AiRecommendationsParams = AiRangeParams & {
  limit?: number;
};

export type AiSegmentationParams = AiRangeParams & {
  limit?: number;
};

export type AiForecastParams = Pick<AiRangeParams, 'from' | 'to' | 'organizationId'>;

/** Short stale window — ai-engine responses are cached server-side. */
const AI_STALE_TIME = 30_000;

function toQueryString(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function aiUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): string {
  return `/ai/${path}${toQueryString(params)}`;
}

/** GET /ai/forecast/events/:eventId — sales & occupancy projection. */
export function useAiSalesForecast(
  eventId: string | null,
  params: AiForecastParams = {},
) {
  return useQuery({
    queryKey: queryKeys.ai.forecast(eventId ?? '', params),
    queryFn: ({ signal }) =>
      http<AiSalesForecastResponse>(
        aiUrl(`forecast/events/${encodeURIComponent(eventId ?? '')}`, {
          from: params.from,
          to: params.to,
          organizationId: params.organizationId,
        }),
        { signal },
      ),
    enabled: Boolean(eventId),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}

/** GET /ai/anomalies — z-score spikes/drops. */
export function useAiAnomalies(params: AiAnomaliesParams = {}) {
  return useQuery({
    queryKey: queryKeys.ai.anomalies(params),
    queryFn: ({ signal }) =>
      http<AiAnomaliesResponse>(
        aiUrl('anomalies', {
          from: params.from,
          to: params.to,
          eventId: params.eventId,
          organizationId: params.organizationId,
          metric: params.metric,
          zThreshold: params.zThreshold,
        }),
        { signal },
      ),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}

/** GET /ai/fraud/risk — explainable fraud risk batch for the period. */
export function useAiFraudRisk(params: AiFraudRiskParams = {}) {
  return useQuery({
    queryKey: queryKeys.ai.fraudRisk(params),
    queryFn: ({ signal }) =>
      http<AiFraudRiskResponse>(
        aiUrl('fraud/risk', {
          from: params.from,
          to: params.to,
          eventId: params.eventId,
          organizationId: params.organizationId,
          limit: params.limit,
        }),
        { signal },
      ),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}

/** GET /ai/fraud/risk/orders/:orderId — single-order fraud score. */
export function useAiFraudRiskOrder(
  orderId: string | null,
  params: Pick<AiRangeParams, 'organizationId'> = {},
) {
  return useQuery({
    queryKey: queryKeys.ai.fraudOrder(orderId ?? '', params),
    queryFn: ({ signal }) =>
      http<AiFraudRiskOrderResponse>(
        aiUrl(`fraud/risk/orders/${encodeURIComponent(orderId ?? '')}`, {
          organizationId: params.organizationId,
        }),
        { signal },
      ),
    enabled: Boolean(orderId),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}

/** GET /ai/recommendations — actionable organizer recommendations. */
export function useAiRecommendations(params: AiRecommendationsParams = {}) {
  return useQuery({
    queryKey: queryKeys.ai.recommendations(params),
    queryFn: ({ signal }) =>
      http<AiRecommendationsResponse>(
        aiUrl('recommendations', {
          from: params.from,
          to: params.to,
          eventId: params.eventId,
          organizationId: params.organizationId,
          limit: params.limit,
        }),
        { signal },
      ),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}

/** GET /ai/summaries/executive — deterministic Spanish executive narrative. */
export function useAiExecutiveSummary(params: AiRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.ai.executive(params),
    queryFn: ({ signal }) =>
      http<AiExecutiveNarrativeResponse>(
        aiUrl('summaries/executive', {
          from: params.from,
          to: params.to,
          eventId: params.eventId,
          organizationId: params.organizationId,
        }),
        { signal },
      ),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}

/**
 * @deprecated Prefer `useAiExecutiveSummary` (matches GET /ai/summaries/executive).
 */
export const useAiExecutiveNarrative = useAiExecutiveSummary;

/** GET /ai/segmentation/customers — RFM segments + churn probability. */
export function useAiCustomerSegmentation(params: AiSegmentationParams = {}) {
  return useQuery({
    queryKey: queryKeys.ai.segmentation(params),
    queryFn: ({ signal }) =>
      http<AiSegmentationResponse>(
        aiUrl('segmentation/customers', {
          from: params.from,
          to: params.to,
          eventId: params.eventId,
          organizationId: params.organizationId,
          limit: params.limit,
        }),
        { signal },
      ),
    staleTime: AI_STALE_TIME,
    retry: false,
  });
}
