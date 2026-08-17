import type { SchedulePreview } from '@/lib/scheduling-api';
import type { EventDraftForm, ScheduleBuilderValue, StepId } from './types';

export function stepIsValid(
  step: StepId,
  form: EventDraftForm,
  schedule: ScheduleBuilderValue,
  preview: SchedulePreview | null,
): boolean {
  switch (step) {
    case 'datos':
      return form.title.trim().length >= 3;
    case 'recinto':
      return Boolean(form.venueId) && form.capacity > 0 && form.basePrice >= 0;
    case 'programacion':
      return Boolean(
        schedule.rule.startLocal &&
          preview &&
          preview.totals.occurrences > 0,
      );
    case 'ventas':
      return true;
    case 'revisar':
      return (
        stepIsValid('datos', form, schedule, preview) &&
        stepIsValid('recinto', form, schedule, preview) &&
        stepIsValid('programacion', form, schedule, preview)
      );
  }
}

export function residencyFrequency(
  rule: ScheduleBuilderValue['rule'],
): 'daily' | 'weekly' | 'biweekly' | 'monthly' {
  if (rule.frequency === 'DAILY') return 'daily';
  if (rule.frequency === 'MONTHLY') return 'monthly';
  if ((rule.interval ?? 1) >= 2) return 'biweekly';
  return 'weekly';
}
