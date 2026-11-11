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
