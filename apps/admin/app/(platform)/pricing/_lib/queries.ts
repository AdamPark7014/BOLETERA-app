'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import type {
  ApplyResult,
  PendingRecommendation,
  PriceHistoryEntry,
  RecommendationBundle,
  RevenueEstimate,
  ReviewResult,
  UpdateDynamicResult,
} from './types';

/**
 * El backend cachea el paquete de recomendaciones 30 s; replicamos ese
 * `staleTime` para no volver a pedir algo que llegaría idéntico.
 */
const RECOMMENDATION_STALE_MS = 30_000;

/**
 * Las claves cuelgan del evento (`['pricing', eventId, …]`) para que una
 * aprobación invalide de golpe recomendaciones, cola y estimación de ingreso.
 */
export const pricingKeys = {
  all: ['pricing'] as const,
  event: (eventId: string) => ['pricing', eventId] as const,
  recommendations: (eventId: string) =>
    ['pricing', eventId, 'recommendations'] as const,
  pending: (eventId: string) => ['pricing', eventId, 'pending'] as const,
  revenue: (eventId: string) => ['pricing', eventId, 'revenue'] as const,
  history: (offerId: string, limit: number) =>
    ['pricing', 'offers', offerId, 'history', limit] as const,
};

export function useRecommendationBundle(eventId: string) {
  return useQuery({
    queryKey: pricingKeys.recommendations(eventId),
    queryFn: ({ signal }) =>
      http<RecommendationBundle>(`/pricing/events/${eventId}/recommendations`, {
        signal,
      }),
    enabled: Boolean(eventId),
    staleTime: RECOMMENDATION_STALE_MS,
  });
}

export function usePendingRecommendations(eventId: string) {
  return useQuery({
    queryKey: pricingKeys.pending(eventId),
    queryFn: ({ signal }) =>
      http<PendingRecommendation[]>(
        `/pricing/events/${eventId}/recommendations/pending`,
        { signal },
      ),
    enabled: Boolean(eventId),
    staleTime: RECOMMENDATION_STALE_MS,
  });
}

export function useRevenueEstimate(eventId: string) {
  return useQuery({
    queryKey: pricingKeys.revenue(eventId),
    queryFn: ({ signal }) =>
      http<RevenueEstimate>(`/pricing/events/${eventId}/revenue-estimate`, {
        signal,
      }),
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

export type ApplyInput = {
  offerIds: readonly string[];
  /** `true` aplica también las ofertas que exigen aprobación humana. */
  confirmApproval: boolean;
};

export function useApplyRecommendations(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyInput) =>
      http<ApplyResult>(`/pricing/events/${eventId}/recommendations/apply`, {
        method: 'POST',
        body: {
          offerIds: [...input.offerIds],
          confirmApproval: input.confirmApproval,
        },
      }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: pricingKeys.event(eventId) }),
  });
}

/**
 * Calcula el paquete sin escribir filas de DynamicPrice. Sustituye el cache
 * local del GET para que la UI muestre el preview de inmediato.
 */
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

/**
 * Genera recomendaciones, auto-aplica deltas seguros y encola el resto.
 * Equivale al endpoint legacy `update-dynamic`.
 */
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

export type ReviewInput = {
  recommendationId: string;
  decision: 'approve' | 'reject';
  /** Nota de aprobación o motivo de rechazo; la API la guarda en auditoría. */
  note: string;
};

export function useReviewRecommendation(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewInput) =>
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
