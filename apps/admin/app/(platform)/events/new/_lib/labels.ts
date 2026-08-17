import type { BadgeTone } from '@boletera/ui';
import type { EventSeriesKind, SalePhaseKind } from '@/lib/scheduling-api';
import type { EventCategory, StepId } from './types';

export const STEP_LABELS: Record<StepId, string> = {
  datos: 'Datos',
  recinto: 'Recinto y aforo',
  programacion: 'Programación',
  ventas: 'Ventas',
  revisar: 'Revisar',
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  MUSIC: 'Música',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  CONFERENCE: 'Conferencia',
  FESTIVAL: 'Festival',
  FAMILY: 'Familiar',
  STANDUP: 'Stand-up',
  OTHER: 'Otro',
};

export const SERIES_KIND_OPTIONS: { value: EventSeriesKind; label: string }[] = [
  { value: 'SERIES', label: 'Serie de funciones' },
  { value: 'RESIDENCY', label: 'Residencia' },
  { value: 'TOUR', label: 'Gira (misma plaza)' },
  { value: 'SEASON', label: 'Temporada' },
  { value: 'FESTIVAL', label: 'Festival' },
];

export const PHASE_KIND_OPTIONS: { value: SalePhaseKind; label: string }[] = [
  { value: 'PRESALE', label: 'Preventa con código' },
  { value: 'MEMBERS', label: 'Miembros / fan club' },
  { value: 'PUBLIC', label: 'Venta pública' },
  { value: 'LAST_MINUTE', label: 'Última hora' },
  { value: 'DOOR', label: 'Puerta / taquilla' },
];

export function seriesKindLabel(kind: EventSeriesKind): string {
  return SERIES_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? kind;
}

export function categoryTone(category: EventCategory): BadgeTone {
  switch (category) {
    case 'MUSIC':
    case 'FESTIVAL':
      return 'accent';
    case 'SPORTS':
      return 'info';
    case 'THEATER':
    case 'COMEDY':
    case 'STANDUP':
      return 'warning';
    case 'FAMILY':
      return 'success';
    default:
      return 'neutral';
  }
}
