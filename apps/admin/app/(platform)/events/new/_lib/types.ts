import type { RecurrenceRule } from '@boletera/shared';
import type { EventSeriesKind, PhaseTemplate, SalePhaseKind } from '@/lib/scheduling-api';
import type { ScheduleBuilderValue } from '@/components/ScheduleBuilder/ScheduleBuilder';

export const STEP_IDS = ['datos', 'recinto', 'programacion', 'ventas', 'revisar'] as const;
export type StepId = (typeof STEP_IDS)[number];

export const CATEGORIES = [
  'MUSIC',
  'SPORTS',
  'THEATER',
  'COMEDY',
  'CONFERENCE',
  'FESTIVAL',
  'FAMILY',
  'STANDUP',
  'OTHER',
] as const;
export type EventCategory = (typeof CATEGORIES)[number];

export type EventDraftForm = {
  title: string;
  description: string;
  category: EventCategory;
  seriesKind: EventSeriesKind;
  venueId: string;
  capacity: number;
  basePrice: number;
  zoneName: string;
  durationMinutes: number;
  doorsOffsetMinutes: number;
  announceOffsetDays: number | null;
  salesStartOffsetDays: number | null;
  salesEndOffsetHours: number | null;
  autoPublish: boolean;
  publishNow: boolean;
};

export type EventDraft = {
  version: 1;
  savedAt: string;
  form: EventDraftForm;
  schedule: ScheduleBuilderValue;
  phases: PhaseTemplate[];
  force: boolean;
};

export type { EventSeriesKind, PhaseTemplate, SalePhaseKind, RecurrenceRule, ScheduleBuilderValue };
