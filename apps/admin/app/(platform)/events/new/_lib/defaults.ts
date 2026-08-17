import type { RecurrenceRule } from '@boletera/shared';
import type { EventDraft, EventDraftForm, ScheduleBuilderValue, StepId } from './types';
import { STEP_IDS } from './types';

export function defaultStartLocal(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  date.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultForm(): EventDraftForm {
  return {
    title: '',
    description: '',
    category: 'MUSIC',
    seriesKind: 'SERIES',
    venueId: '',
    capacity: 500,
    basePrice: 450,
    zoneName: 'General',
    durationMinutes: 180,
    doorsOffsetMinutes: 60,
    announceOffsetDays: 60,
    salesStartOffsetDays: 45,
    salesEndOffsetHours: 2,
    autoPublish: true,
    publishNow: false,
  };
}

export function defaultSchedule(): ScheduleBuilderValue {
  return {
    mode: 'single',
    rule: {
      frequency: 'WEEKLY',
      startLocal: defaultStartLocal(),
      timezone: 'America/Mexico_City',
      interval: 1,
      count: 8,
    } satisfies RecurrenceRule,
  };
}

export function emptyDraft(): EventDraft {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    form: defaultForm(),
    schedule: defaultSchedule(),
    phases: [],
    force: false,
  };
}

export function parseStep(value: string | null): StepId {
  if (value && (STEP_IDS as readonly string[]).includes(value)) {
    return value as StepId;
  }
  return 'datos';
}

export function stepIndex(step: StepId): number {
  return STEP_IDS.indexOf(step);
}
