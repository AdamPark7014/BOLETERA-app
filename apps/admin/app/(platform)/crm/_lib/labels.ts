import type { BadgeTone } from '@boletera/ui';
import type { ChurnBand, CustomerSegment } from './types';

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  vip: 'VIP',
  recurrent: 'Recurrente',
  new: 'Nuevo',
  at_risk: 'En riesgo',
  inactive: 'Inactivo',
};

export const SEGMENT_TONE: Record<CustomerSegment, BadgeTone> = {
  vip: 'accent',
  recurrent: 'success',
  new: 'info',
  at_risk: 'warning',
  inactive: 'neutral',
};

export const SEGMENT_DESCRIPTION: Record<CustomerSegment, string> = {
  vip: 'Decil superior de gasto con compras repetidas',
  recurrent: 'Dos o más pedidos completados',
  new: 'Primera compra en el portafolio',
  at_risk: 'Sin actividad reciente (90–180 días)',
  inactive: 'Sin compras recientes o sin pedidos pagados',
};

export const CHURN_LABEL: Record<ChurnBand, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};

export const CHURN_TONE: Record<ChurnBand, BadgeTone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

export const AI_SEGMENT_LABEL: Record<string, string> = {
  champion: 'Campeón',
  loyal: 'Leal',
  promising: 'Prometedor',
  at_risk: 'En riesgo (AI)',
  hibernating: 'Hibernando',
  new: 'Nuevo (AI)',
  insufficient_history: 'Historial insuficiente',
};

export function aiSegmentLabel(segment: string | null): string {
  if (!segment) return '—';
  return AI_SEGMENT_LABEL[segment] ?? segment;
}

export function priorityTone(
  priority: 'low' | 'medium' | 'high' | 'urgent',
): BadgeTone {
  switch (priority) {
    case 'urgent':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    case 'low':
      return 'neutral';
  }
}

export function priorityLabel(
  priority: 'low' | 'medium' | 'high' | 'urgent',
): string {
  switch (priority) {
    case 'urgent':
      return 'Urgente';
    case 'high':
      return 'Alta';
    case 'medium':
      return 'Media';
    case 'low':
      return 'Baja';
  }
}
