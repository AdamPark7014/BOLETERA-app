import type { BadgeTone } from '@boletera/ui';
import type { EventSeriesKind, EventSeriesStatus } from '@/lib/scheduling-api';

export const KIND_LABELS: Record<EventSeriesKind, string> = {
  SERIES: 'Serie',
  RESIDENCY: 'Residencia',
  TOUR: 'Gira',
  SEASON: 'Temporada',
  FESTIVAL: 'Festival',
};

export const STATUS_LABELS: Record<EventSeriesStatus, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
  ARCHIVED: 'Archivada',
};

export function kindTone(kind: EventSeriesKind): BadgeTone {
  switch (kind) {
    case 'RESIDENCY':
      return 'accent';
    case 'TOUR':
      return 'info';
    case 'SEASON':
      return 'success';
    case 'FESTIVAL':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function statusTone(status: EventSeriesStatus): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'COMPLETED':
      return 'info';
    case 'ARCHIVED':
      return 'neutral';
    case 'DRAFT':
    default:
      return 'warning';
  }
}

export function saleStateTone(state: string): BadgeTone {
  switch (state) {
    case 'ON_SALE':
      return 'success';
    case 'PRESALE':
    case 'ANNOUNCED':
      return 'info';
    case 'CLOSED':
    case 'PAST':
      return 'neutral';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'warning';
  }
}
