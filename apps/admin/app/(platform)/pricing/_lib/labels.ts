import type { BadgeTone, StatusTone } from '@boletera/ui';
import type {
  PricingConfidence,
  PricingDirection,
  PricingFactorCode,
} from './types';

const FACTOR_LABELS: Record<PricingFactorCode, string> = {
  sales_pace: 'Ritmo de venta',
  occupancy: 'Ocupación',
  time: 'Tiempo al evento',
  inventory: 'Inventario',
  price_band: 'Banda de precio',
  segment: 'Segmento',
  promotion: 'Promoción',
};

function isFactorCode(code: string): code is PricingFactorCode {
  return Object.prototype.hasOwnProperty.call(FACTOR_LABELS, code);
}

export function factorLabel(code: PricingFactorCode | string): string {
  return isFactorCode(code) ? FACTOR_LABELS[code] : code;
}

const DIRECTION_LABELS: Record<PricingDirection, string> = {
  increase: 'Subir',
  decrease: 'Bajar',
  hold: 'Mantener',
};

export function directionLabel(direction: PricingDirection): string {
  return DIRECTION_LABELS[direction];
}

export function directionTone(direction: PricingDirection): BadgeTone {
  if (direction === 'increase') return 'success';
  if (direction === 'decrease') return 'warning';
  return 'neutral';
}

const CONFIDENCE_LABELS: Record<PricingConfidence, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

export function confidenceLabel(confidence: PricingConfidence): string {
  return CONFIDENCE_LABELS[confidence];
}

export function confidenceTone(confidence: PricingConfidence): BadgeTone {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'info';
  return 'warning';
}

/** >1 sube precio, <1 baja, =1 neutro. */
export function contributionTone(contribution: number): StatusTone {
  if (contribution > 1) return 'success';
  if (contribution < 1) return 'warning';
  return 'neutral';
}

/**
 * Prefijos de `DynamicPrice.reason`. Nunca se muestra el JSON crudo.
 */
export function describeHistoryReason(reason: string): {
  label: string;
  tone: BadgeTone;
  detail: string;
} {
  if (reason.startsWith('applied_recommendation|')) {
    return {
      label: 'Aplicada',
      tone: 'success',
      detail: reason.slice('applied_recommendation|'.length),
    };
  }
  if (reason.startsWith('pending_approval|')) {
    return { label: 'Pendiente', tone: 'warning', detail: '' };
  }
  if (reason.startsWith('rejected_recommendation|')) {
    return { label: 'Rechazada', tone: 'danger', detail: '' };
  }
  if (!reason.trim()) {
    return { label: 'Sin motivo', tone: 'neutral', detail: '' };
  }
  return { label: 'Ajuste', tone: 'neutral', detail: reason.slice(0, 160) };
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
