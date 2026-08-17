'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

/**
 * Contratos JSON del módulo `pricing` (apps/api).
 * Prisma Decimal → string|number; fechas → ISO.
 */

export type PricingDirection = 'increase' | 'decrease' | 'hold';
export type PricingConfidence = 'high' | 'medium' | 'low';

export type PricingFactorCode =
  | 'sales_pace'
  | 'occupancy'
  | 'time'
  | 'inventory'
  | 'price_band'
  | 'segment'
  | 'promotion';

/** Contribución multiplicativa (1.0 = sin cambio). */
export type PricingFactor = {
  code: PricingFactorCode;
  contribution: number;
  detail: string;
  metricValue: number;
  threshold?: number;
};

export type PricingGuardrail = {
  floor: number;
  ceiling: number;
  clamped: boolean;
  preClampPrice: number;
  bandLabel: string;
};

export type OfferRecommendation = {
  offerId: string;
  zone: string;
  name: string;
  basePrice: number;
  currentPrice: number;
  recommendedPrice: number;
  recommendedMultiplier: number;
  direction: PricingDirection;
  /** Proporción: 0.12 = +12 %. */
  deltaPercent: number;
  factors: readonly PricingFactor[];
  guardrail: PricingGuardrail;
  requiresApproval: boolean;
  autoApplicable: boolean;
  explanation: string;
  confidence: PricingConfidence;
};

export type PricingSignals = {
  daysUntilEvent: number;
  expectedPace: number;
  actualPace: number;
  paceDelta: number;
  /** Escala 0–100. */
  occupancyPercent: number;
  soldTickets: number;
  totalCapacity: number;
};

/** `GET|POST …/recommendations` / `…/preview` */
export type RecommendationBundle = {
  eventId: string;
  organizationId: string;
  title: string;
  generatedAt: string;
  enableDynamic: boolean;
  signals: PricingSignals;
  recommendations: readonly OfferRecommendation[];
  summary: string;
};

export type PendingPayload = {
  v: 1;
  status: 'pending' | 'rejected';
  explanation: string;
  factors: readonly PricingFactor[];
  direction: PricingDirection;
  deltaPercent: number;
  requiresApproval: boolean;
  guardrail: PricingGuardrail;
  basePrice: number;
  currentPrice: number;
};

/** `GET …/recommendations/pending` */
export type PendingRecommendation = {
  id: string;
  eventId: string;
  offerId: string;
  adjustedPrice: number;
  priceMultiplier: number;
  createdAt: string;
  status: 'pending';
  reason: string;
  payload?: PendingPayload;
};

/** `GET …/revenue-estimate` */
export type RevenueEstimate = {
  eventId: string;
  title: string;
  totalCapacity: number;
  soldTickets: number;
  /** String con 2 decimales, escala 0–100. */
  occupancyPercent: string;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
  currency: string;
};

/** `GET /pricing/offers/:offerId/history` */
export type PriceHistoryEntry = {
  id: string;
  eventId: string;
  offerId: string;
  adjustedPrice: string | number;
  priceMultiplier: number;
  reason: string;
  activeFrom: string;
  activeTo: string;
  createdAt: string;
};

/** `POST …/recommendations/apply` */
export type ApplyResult = {
  applied: readonly string[];
  skipped: readonly string[];
  pendingCreated: readonly string[];
};

export type ReviewResult = {
  id: string;
  status: 'approved' | 'rejected';
};

/** `POST …/update-dynamic` */
export type UpdateDynamicResult = {
  message: string;
  applied: number;
  pendingApproval: number;
  held: number;
  summary: string;
  signals: PricingSignals;
};

export type ApplyInput = {
  offerIds?: readonly string[];
  /** `true` fuerza aplicación de deltas que exigen humano. */
  confirmApproval?: boolean;
};

/** Importes Decimal serializados. */
export function toAmount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * El backend cachea recomendaciones ~30 s; alineamos staleTime.
 */
const RECOMMENDATION_STALE_MS = 30_000;

export const pricingKeys = queryKeys.pricing;

export function useRecommendationBundle(eventId: string | null) {
  return useQuery({
    queryKey: pricingKeys.recommendations(eventId ?? ''),
    queryFn: ({ signal }) =>
      http<RecommendationBundle>(
        `/pricing/events/${eventId}/recommendations`,
        { signal },
      ),
    enabled: Boolean(eventId),
    staleTime: RECOMMENDATION_STALE_MS,
  });
}

export function usePendingRecommendations(eventId: string | null) {
  return useQuery({
    queryKey: pricingKeys.pending(eventId ?? ''),
    queryFn: ({ signal }) =>
      http<PendingRecommendation[]>(
        `/pricing/events/${eventId}/recommendations/pending`,
        { signal },
      ),
    enabled: Boolean(eventId),
    staleTime: RECOMMENDATION_STALE_MS,
  });
}

export function useRevenueEstimate(eventId: string | null) {
  return useQuery({
    queryKey: pricingKeys.revenue(eventId ?? ''),
    queryFn: ({ signal }) =>
      http<RevenueEstimate>(
        `/pricing/events/${eventId}/revenue-estimate`,
        { signal },
      ),
    enabled: Boolean(eventId),
    staleTime: RECOMMENDATION_STALE_MS,
  });
}

export function useOfferPriceHistory(offerId: string | null, limit = 20) {
  return useQuery({
    queryKey: pricingKeys.history(offerId ?? '', limit),
    queryFn: ({ signal }) =>
      http<PriceHistoryEntry[]>(
        `/pricing/offers/${offerId}/history?limit=${limit}`,
        { signal },
      ),
    enabled: Boolean(offerId),
  });
}

export function useApplyRecommendations(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyInput = {}) =>
      http<ApplyResult>(`/pricing/events/${eventId}/recommendations/apply`, {
        method: 'POST',
        body: {
          offerIds: input.offerIds ? [...input.offerIds] : undefined,
          confirmApproval: input.confirmApproval,
        },
      }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: pricingKeys.event(eventId) }),
  });
}

export function usePreviewRecommendations(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      http<RecommendationBundle>(
        `/pricing/events/${eventId}/recommendations/preview`,
        { method: 'POST' },
      ),
    onSuccess: (bundle) => {
      client.setQueryData(pricingKeys.recommendations(eventId), bundle);
    },
  });
}

export function useUpdateDynamicPrices(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      http<UpdateDynamicResult>(`/pricing/events/${eventId}/update-dynamic`, {
        method: 'POST',
      }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: pricingKeys.event(eventId) }),
  });
}

export function useReviewRecommendation(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      recommendationId: string;
      decision: 'approve' | 'reject';
      note?: string;
    }) =>
      http<ReviewResult>(
        `/pricing/recommendations/${input.recommendationId}/${input.decision}`,
        {
          method: 'POST',
          body:
            input.decision === 'approve'
              ? { note: input.note || undefined }
              : { reason: input.note || undefined },
        },
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: pricingKeys.event(eventId) }),
  });
}

export function invalidateEventPricing(
  client: ReturnType<typeof useQueryClient>,
  eventId: string,
): void {
  void client.invalidateQueries({ queryKey: pricingKeys.event(eventId) });
}
