import type {
  AiAnomalyDirection,
  AiAnomalyMetric,
  AiConfidenceLevel,
  AiCustomerSegment,
  AiDataSufficiency,
  AiFraudRiskBand,
  AiRecommendationKind,
  AiRecommendationPriority,
} from '@boletera/shared';
import type { BadgeTone } from '@boletera/ui';

export type AiAnomalySeverity = 'watch' | 'alert' | 'critical';
export type AiImpactMetric =
  | 'tickets'
  | 'revenue_mxn'
  | 'occupancy_pp'
  | 'risk_reduction';

function assertNever(value: never): never {
  throw new Error(`Valor AI no contemplado: ${String(value)}`);
}

const CONFIDENCE_LABELS = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  none: 'Sin base',
} as const satisfies Record<AiConfidenceLevel, string>;

const CONFIDENCE_TONES = {
  high: 'success',
  medium: 'info',
  low: 'warning',
  none: 'neutral',
} as const satisfies Record<AiConfidenceLevel, BadgeTone>;

const SUFFICIENCY_LABELS = {
  sufficient: 'Datos suficientes',
  limited: 'Datos limitados',
  insufficient: 'Datos insuficientes',
} as const satisfies Record<AiDataSufficiency, string>;

const SUFFICIENCY_TONES = {
  sufficient: 'success',
  limited: 'warning',
  insufficient: 'danger',
} as const satisfies Record<AiDataSufficiency, BadgeTone>;

const ANOMALY_METRIC_LABELS = {
  tickets_sold: 'Boletos vendidos',
  gross_revenue: 'Ingreso bruto',
  refund_amount: 'Monto de reembolsos',
  payment_approval_rate: 'Tasa de aprobación',
  access_traffic: 'Tráfico de acceso',
} as const satisfies Record<AiAnomalyMetric, string>;

const ANOMALY_SEVERITY_TONES = {
  critical: 'danger',
  alert: 'warning',
  watch: 'info',
} as const satisfies Record<AiAnomalySeverity, BadgeTone>;

const ANOMALY_SEVERITY_RANKS = {
  critical: 0,
  alert: 1,
  watch: 2,
} as const satisfies Record<AiAnomalySeverity, number>;

const PRIORITY_LABELS = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
} as const satisfies Record<AiRecommendationPriority, string>;

const PRIORITY_TONES = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
} as const satisfies Record<AiRecommendationPriority, BadgeTone>;

const PRIORITY_RANKS = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const satisfies Record<AiRecommendationPriority, number>;

const RECOMMENDATION_KIND_LABELS = {
  boost_sales_pace: 'Acelerar ritmo de venta',
  clear_inventory_zone: 'Liberar inventario por zona',
  improve_campaign: 'Mejorar campaña',
  review_pricing: 'Revisar pricing',
  investigate_anomaly: 'Investigar anomalía',
  mitigate_fraud: 'Mitigar fraude',
} as const satisfies Record<AiRecommendationKind, string>;

const IMPACT_METRIC_LABELS = {
  tickets: 'boletos',
  revenue_mxn: 'MXN',
  occupancy_pp: 'pp ocupación',
  risk_reduction: 'reducción de riesgo',
} as const satisfies Record<AiImpactMetric, string>;

const FRAUD_BAND_LABELS = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
} as const satisfies Record<AiFraudRiskBand, string>;

const FRAUD_BAND_TONES = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'success',
} as const satisfies Record<AiFraudRiskBand, BadgeTone>;

const FRAUD_BAND_RANKS = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const satisfies Record<AiFraudRiskBand, number>;

const SEGMENT_LABELS = {
  champion: 'Campeones',
  loyal: 'Leales',
  promising: 'Prometedores',
  at_risk: 'En riesgo',
  hibernating: 'Hibernando',
  new: 'Nuevos',
  insufficient_history: 'Sin historial',
} as const satisfies Record<AiCustomerSegment, string>;

export function confidenceLabel(level: AiConfidenceLevel): string {
  return CONFIDENCE_LABELS[level];
}

export function confidenceTone(level: AiConfidenceLevel): BadgeTone {
  return CONFIDENCE_TONES[level];
}

export function sufficiencyLabel(value: AiDataSufficiency): string {
  return SUFFICIENCY_LABELS[value];
}

export function sufficiencyTone(value: AiDataSufficiency): BadgeTone {
  return SUFFICIENCY_TONES[value];
}

export function anomalyMetricLabel(metric: AiAnomalyMetric): string {
  return ANOMALY_METRIC_LABELS[metric];
}

export function anomalyDirectionLabel(direction: AiAnomalyDirection): string {
  switch (direction) {
    case 'spike':
      return 'Pico';
    case 'drop':
      return 'Caída';
    default:
      return assertNever(direction);
  }
}

export function anomalySeverityTone(severity: AiAnomalySeverity): BadgeTone {
  return ANOMALY_SEVERITY_TONES[severity];
}

export function anomalySeverityRank(severity: AiAnomalySeverity): number {
  return ANOMALY_SEVERITY_RANKS[severity];
}

export function priorityLabel(priority: AiRecommendationPriority): string {
  return PRIORITY_LABELS[priority];
}

export function priorityTone(priority: AiRecommendationPriority): BadgeTone {
  return PRIORITY_TONES[priority];
}

export function priorityRank(priority: AiRecommendationPriority): number {
  return PRIORITY_RANKS[priority];
}

export function recommendationKindLabel(kind: AiRecommendationKind): string {
  return RECOMMENDATION_KIND_LABELS[kind];
}

export function impactMetricLabel(metric: AiImpactMetric): string {
  return IMPACT_METRIC_LABELS[metric];
}

export function fraudBandLabel(band: AiFraudRiskBand): string {
  return FRAUD_BAND_LABELS[band];
}

export function fraudBandTone(band: AiFraudRiskBand): BadgeTone {
  return FRAUD_BAND_TONES[band];
}

export function fraudBandRank(band: AiFraudRiskBand): number {
  return FRAUD_BAND_RANKS[band];
}

export function segmentLabel(segment: AiCustomerSegment): string {
  return SEGMENT_LABELS[segment];
}
