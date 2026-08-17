import type { RecurrenceRule, Weekday } from '@boletera/shared';
import type { EventSeriesKind, PhaseTemplate, SalePhaseKind } from '@/lib/scheduling-api';
import type { EventDraft, EventDraftForm, ScheduleBuilderValue } from './types';
import { CATEGORIES } from './types';
import { emptyDraft } from './defaults';

const DRAFT_KEY = 'boletera.admin.event-create-draft.v1';

const SERIES_KINDS: readonly EventSeriesKind[] = [
  'SERIES',
  'RESIDENCY',
  'TOUR',
  'SEASON',
  'FESTIVAL',
];

const PHASE_KINDS: readonly SalePhaseKind[] = [
  'PRESALE',
  'MEMBERS',
  'PUBLIC',
  'LAST_MINUTE',
  'DOOR',
];

const FREQUENCIES: readonly RecurrenceRule['frequency'][] = ['DAILY', 'WEEKLY', 'MONTHLY'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseForm(raw: unknown, fallback: EventDraftForm): EventDraftForm {
  if (!isRecord(raw)) return fallback;
  const category = asString(raw.category, fallback.category);
  const seriesKind = asString(raw.seriesKind, fallback.seriesKind);
  return {
    title: asString(raw.title, fallback.title),
    description: asString(raw.description, fallback.description),
    category: (CATEGORIES as readonly string[]).includes(category)
      ? (category as EventDraftForm['category'])
      : fallback.category,
    seriesKind: (SERIES_KINDS as readonly string[]).includes(seriesKind)
      ? (seriesKind as EventSeriesKind)
      : fallback.seriesKind,
    venueId: asString(raw.venueId, fallback.venueId),
    capacity: Math.max(1, asNumber(raw.capacity, fallback.capacity)),
    basePrice: Math.max(0, asNumber(raw.basePrice, fallback.basePrice)),
    zoneName: asString(raw.zoneName, fallback.zoneName),
    durationMinutes: Math.max(30, asNumber(raw.durationMinutes, fallback.durationMinutes)),
    doorsOffsetMinutes: Math.max(0, asNumber(raw.doorsOffsetMinutes, fallback.doorsOffsetMinutes)),
    announceOffsetDays: asNullableNumber(raw.announceOffsetDays),
    salesStartOffsetDays: asNullableNumber(raw.salesStartOffsetDays),
    salesEndOffsetHours: asNullableNumber(raw.salesEndOffsetHours),
    autoPublish: asBoolean(raw.autoPublish, fallback.autoPublish),
    publishNow: asBoolean(raw.publishNow, fallback.publishNow),
  };
}

function parseRule(raw: unknown, fallback: RecurrenceRule): RecurrenceRule {
  if (!isRecord(raw)) return fallback;
  const frequency = asString(raw.frequency, fallback.frequency);
  return {
    frequency: (FREQUENCIES as readonly string[]).includes(frequency)
      ? (frequency as RecurrenceRule['frequency'])
      : fallback.frequency,
    startLocal: asString(raw.startLocal, fallback.startLocal),
    timezone: asString(raw.timezone, fallback.timezone),
    interval: asNumber(raw.interval, fallback.interval ?? 1),
    count: typeof raw.count === 'number' ? raw.count : fallback.count,
    untilLocal: typeof raw.untilLocal === 'string' ? raw.untilLocal : fallback.untilLocal,
    byWeekday: Array.isArray(raw.byWeekday)
      ? raw.byWeekday.filter(
          (d): d is Weekday =>
            typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
        )
      : fallback.byWeekday,
    exceptions: Array.isArray(raw.exceptions)
      ? raw.exceptions.filter((d): d is string => typeof d === 'string')
      : fallback.exceptions,
    monthlyMode:
      raw.monthlyMode === 'DAY_OF_MONTH' || raw.monthlyMode === 'NTH_WEEKDAY'
        ? raw.monthlyMode
        : fallback.monthlyMode,
    nth:
      typeof raw.nth === 'number' && [-1, 1, 2, 3, 4].includes(raw.nth)
        ? (raw.nth as RecurrenceRule['nth'])
        : fallback.nth,
  };
}

function parseSchedule(raw: unknown, fallback: ScheduleBuilderValue): ScheduleBuilderValue {
  if (!isRecord(raw)) return fallback;
  const mode = raw.mode === 'recurring' ? 'recurring' : 'single';
  return {
    mode,
    rule: parseRule(raw.rule, fallback.rule),
  };
}

function parsePhase(raw: unknown): PhaseTemplate | null {
  if (!isRecord(raw)) return null;
  const kind = asString(raw.kind, 'PUBLIC');
  if (!(PHASE_KINDS as readonly string[]).includes(kind)) return null;
  return {
    name: asString(raw.name, 'Fase'),
    kind: kind as SalePhaseKind,
    code: typeof raw.code === 'string' || raw.code === null ? raw.code : null,
    startOffsetDays: Math.max(0, asNumber(raw.startOffsetDays, 0)),
    endOffsetDays: Math.max(0, asNumber(raw.endOffsetDays, 0)),
    discountPercent: asNullableNumber(raw.discountPercent),
    maxPerOrder: asNullableNumber(raw.maxPerOrder) ?? 4,
  };
}

function parsePhases(raw: unknown): PhaseTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parsePhase).filter((phase): phase is PhaseTemplate => phase !== null);
}

export function loadDraft(): EventDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    const base = emptyDraft();
    return {
      version: 1,
      savedAt: asString(parsed.savedAt, base.savedAt),
      form: parseForm(parsed.form, base.form),
      schedule: parseSchedule(parsed.schedule, base.schedule),
      phases: parsePhases(parsed.phases),
      force: asBoolean(parsed.force, false),
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Omit<EventDraft, 'savedAt' | 'version'>): EventDraft {
  const next: EventDraft = {
    version: 1,
    savedAt: new Date().toISOString(),
    form: draft.form,
    schedule: draft.schedule,
    phases: draft.phases,
    force: draft.force,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      // Quota or private mode: keep in-memory only.
    }
  }
  return next;
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}
