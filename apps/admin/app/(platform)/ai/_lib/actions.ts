import type {
  AiRecommendationKind,
  AiRecommendationPriority,
} from '@boletera/shared';

export type AiProposedActionStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'dismissed';

export type AiProposedAction = {
  id: string;
  recommendationId: string;
  title: string;
  action: string;
  rationale: string;
  priority: AiRecommendationPriority;
  kind: AiRecommendationKind;
  entityLabel?: string;
  estimatedImpactLabel?: string | null;
  status: AiProposedActionStatus;
  proposedAt: string;
  resolvedAt?: string;
  note?: string;
};

export function createProposedAction(input: {
  recommendationId: string;
  title: string;
  action: string;
  rationale: string;
  priority: AiRecommendationPriority;
  kind: AiRecommendationKind;
  entityLabel?: string;
  estimatedImpactLabel?: string | null;
}): AiProposedAction {
  return {
    id: `action-${input.recommendationId}-${Date.now()}`,
    recommendationId: input.recommendationId,
    title: input.title,
    action: input.action,
    rationale: input.rationale,
    priority: input.priority,
    kind: input.kind,
    entityLabel: input.entityLabel,
    estimatedImpactLabel: input.estimatedImpactLabel ?? null,
    status: 'pending_confirmation',
    proposedAt: new Date().toISOString(),
  };
}
