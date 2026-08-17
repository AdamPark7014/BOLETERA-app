/**
 * Event scheduling engine: timezone-aware recurrence expansion, sale-window
 * state resolution and venue conflict detection.
 *
 * Shared on purpose: the API generates/validates schedules with it, the admin
 * previews them with it and the storefront derives sale badges from it, so all
 * three always agree on what "on sale" means.
 */

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** 0 = Sunday … 6 = Saturday (matches Date#getUTCDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type MonthlyMode = 'DAY_OF_MONTH' | 'NTH_WEEKDAY';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Local wall-clock start: `YYYY-MM-DDTHH:mm`. */
  startLocal: string;
  /** IANA timezone the wall-clock times are expressed in. */
  timezone: string;
  /** Repeat every N periods. Default 1. */
  interval?: number;
  /** Stop after N occurrences (mutually exclusive with `untilLocal`). */
  count?: number;
  /** Inclusive last local date `YYYY-MM-DD`. */
  untilLocal?: string;
  /** WEEKLY only: which weekdays fire inside each active week. */
  byWeekday?: Weekday[];
  /** MONTHLY only. Default `DAY_OF_MONTH`. */
  monthlyMode?: MonthlyMode;
  /** MONTHLY + NTH_WEEKDAY: 1..4 for first..fourth, -1 for last. */
  nth?: 1 | 2 | 3 | 4 | -1;
  /** MONTHLY + NTH_WEEKDAY: which weekday. Defaults to the start date weekday. */
  nthWeekday?: Weekday;
  /** Local dates (`YYYY-MM-DD`) to skip. */
  exceptions?: string[];
  /** Extra one-off local datetimes (`YYYY-MM-DDTHH:mm`) merged into the series. */
  extraDates?: string[];
}

export interface ScheduleOccurrence {
  index: number;
  /** Absolute instant, ISO-8601 in UTC. */
  startsAt: string;
  /** Wall clock as seen at the venue. */
  localDate: string;
  localTime: string;
  weekday: Weekday;
  utcOffsetMinutes: number;
  source: 'RULE' | 'EXTRA';
  /** True when the requested day-of-month had to be clamped (e.g. 31 → 28 Feb). */
  clamped?: boolean;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** Hard ceiling so a bad rule can never spam the database. */
export const MAX_OCCURRENCES = 366;
export const DEFAULT_OCCURRENCE_COUNT = 12;
/** Minutes of load-out/load-in kept free between two shows in the same venue. */
export const DEFAULT_TURNAROUND_MINUTES = 90;
export const DEFAULT_EVENT_DURATION_MINUTES = 180;

const WEEKDAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ORDINAL_LABELS: Record<string, string> = {
  '1': 'primer',
  '2': 'segundo',
  '3': 'tercer',
  '4': 'cuarto',
  '-1': 'último',
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    zoneFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `date` as displayed in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): Required<DateParts> {
  const parts = zoneFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some ICU builds emit hour 24 for midnight with hour12:false.
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` at `date`, in minutes east of UTC (Mexico City → -360). */
export function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const whole = date.getTime() - date.getMilliseconds();
  return Math.round((asIfUtc - whole) / 60_000);
}

function partsMatch(
  actual: Required<DateParts>,
  expected: DateParts,
  second: number,
): boolean {
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === second
  );
}

/**
 * Convert a wall-clock time in `timeZone` to the absolute instant.
 *
 * DST is resolved by fixed-point iteration on the zone offset, then verified by
 * projecting the candidate back to local parts. Wall-clock times that do not
 * exist (spring-forward gap) resolve using the post-transition offset (the first
 * valid instant after the jump). Ambiguous times (fall-back) prefer the earlier
 * (pre-transition / "daylight") occurrence — the usual convention for shows.
 *
 * Mexico City abolished DST in Oct 2022 (permanent UTC-6). The algorithm still
 * handles zones that observe DST so the same code works for venues abroad and
 * for historical Mexico City dates that still carry ICU transition data.
 */
export function zonedTimeToUtc(parts: DateParts, timeZone: string): Date {
  const second = parts.second ?? 0;
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    second,
  );

  let offset = getTimezoneOffsetMinutes(new Date(naive), timeZone);
  let instant = naive - offset * 60_000;
  for (let i = 0; i < 3; i += 1) {
    const settled = getTimezoneOffsetMinutes(new Date(instant), timeZone);
    if (settled === offset) break;
    offset = settled;
    instant = naive - offset * 60_000;
  }

  const projected = getZonedParts(new Date(instant), timeZone);
  if (partsMatch(projected, parts, second)) {
    // Ambiguity: the hour one hour earlier may also project to the same wall clock.
    const earlier = new Date(instant - 3_600_000);
    if (partsMatch(getZonedParts(earlier, timeZone), parts, second)) {
      return earlier;
    }
    return new Date(instant);
  }

  // Gap: requested wall clock does not exist. Recompute with the offset observed
  // two hours later, which sits safely after a one-hour spring-forward jump.
  const postOffset = getTimezoneOffsetMinutes(new Date(naive + 2 * 3_600_000), timeZone);
  return new Date(naive - postOffset * 60_000);
}

/**
 * True when `America/Mexico_City` (or any IANA zone) observes a DST transition
 * on the civil day of `date`. Useful for operator warnings about ambiguous
 * show times around historical Mexico DST changes.
 */
export function zoneObservesDstOnDate(date: Date, timeZone: string): boolean {
  const local = getZonedParts(date, timeZone);
  const noon = zonedTimeToUtc(
    {
      year: local.year,
      month: local.month,
      day: local.day,
      hour: 12,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
  const before = new Date(noon.getTime() - 12 * 3_600_000);
  const after = new Date(noon.getTime() + 12 * 3_600_000);
  return getTimezoneOffsetMinutes(before, timeZone) !== getTimezoneOffsetMinutes(after, timeZone);
}

export function parseLocalDateTime(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  if (!match) throw new Error(`Invalid local datetime: "${value}"`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? '0'),
    minute: Number(match[5] ?? '0'),
    second: Number(match[6] ?? '0'),
  };
}

/** Render an instant as the `YYYY-MM-DDTHH:mm` a venue operator would read. */
export function formatLocalDateTime(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatLocalDate(date: Date, timeZone: string): string {
  return formatLocalDateTime(date, timeZone).slice(0, 10);
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Civil (timezone-free) day arithmetic done on a UTC-anchored date. */
function civilDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addCivilDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function civilKey(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Monday-anchored start of the civil week containing `date`. */
function startOfCivilWeek(date: Date): Date {
  const day = date.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return addCivilDays(date, -back);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: Weekday, nth: number): Date | null {
  if (nth === -1) {
    const last = civilDate(year, month, daysInMonth(year, month));
    const delta = (last.getUTCDay() - weekday + 7) % 7;
    return addCivilDays(last, -delta);
  }
  const first = civilDate(year, month, 1);
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  if (day > daysInMonth(year, month)) return null;
  return civilDate(year, month, day);
}

export interface ExpandOptions {
  /** Cap the number of returned occurrences (still bounded by MAX_OCCURRENCES). */
  limit?: number;
}

/**
 * Expand a recurrence rule into concrete occurrences.
 *
 * Dates are walked on the civil calendar and only then projected onto UTC with
 * the venue timezone, so a 20:00 show stays at 20:00 local across DST changes.
 */
export function expandRecurrence(rule: RecurrenceRule, options: ExpandOptions = {}): ScheduleOccurrence[] {
  if (!isValidTimezone(rule.timezone)) {
    throw new Error(`Unknown timezone: "${rule.timezone}"`);
  }

  const start = parseLocalDateTime(rule.startLocal);
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  const hardLimit = Math.min(options.limit ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const count = rule.untilLocal
    ? hardLimit
    : Math.min(Math.max(1, Math.floor(rule.count ?? DEFAULT_OCCURRENCE_COUNT)), hardLimit);

  const untilKey = rule.untilLocal ? parseLocalDateTime(rule.untilLocal) : null;
  const untilCivil = untilKey ? civilKey(civilDate(untilKey.year, untilKey.month, untilKey.day)) : null;
  const skip = new Set((rule.exceptions ?? []).map((value) => value.slice(0, 10)));

  const startCivil = civilDate(start.year, start.month, start.day);
  const timeOfDay = { hour: start.hour, minute: start.minute, second: start.second ?? 0 };

  const collected: { civil: Date; clamped?: boolean }[] = [];
  const push = (civil: Date, clamped?: boolean) => {
    if (untilCivil && civilKey(civil) > untilCivil) return false;
    if (skip.has(civilKey(civil))) return true;
    collected.push({ civil, clamped });
    return collected.length < count;
  };

  if (rule.frequency === 'DAILY') {
    let cursor = startCivil;
    let guard = 0;
    while (collected.length < count && guard++ < MAX_OCCURRENCES * 4) {
      if (!push(cursor)) break;
      cursor = addCivilDays(cursor, interval);
    }
  } else if (rule.frequency === 'WEEKLY') {
    const weekdays = (rule.byWeekday?.length ? [...rule.byWeekday] : [startCivil.getUTCDay() as Weekday])
      .filter((d, i, arr) => arr.indexOf(d) === i)
      // Monday-first ordering so the preview reads like a calendar week.
      .sort((a, b) => ((a === 0 ? 7 : a) - (b === 0 ? 7 : b)));
    let weekStart = startOfCivilWeek(startCivil);
    let guard = 0;
    outer: while (collected.length < count && guard++ < MAX_OCCURRENCES * 4) {
      for (const weekday of weekdays) {
        const offset = (weekday === 0 ? 7 : weekday) - 1;
        const civil = addCivilDays(weekStart, offset);
        if (civilKey(civil) < civilKey(startCivil)) continue;
        if (!push(civil)) break outer;
      }
      weekStart = addCivilDays(weekStart, 7 * interval);
    }
  } else {
    const mode: MonthlyMode = rule.monthlyMode ?? 'DAY_OF_MONTH';
    const weekday = (rule.nthWeekday ?? (startCivil.getUTCDay() as Weekday)) as Weekday;
    const nth = rule.nth ?? 1;
    let year = start.year;
    let month = start.month;
    let guard = 0;
    while (collected.length < count && guard++ < MAX_OCCURRENCES * 4) {
      let civil: Date | null = null;
      let clamped = false;
      if (mode === 'DAY_OF_MONTH') {
        const max = daysInMonth(year, month);
        const day = Math.min(start.day, max);
        clamped = day !== start.day;
        civil = civilDate(year, month, day);
      } else {
        civil = nthWeekdayOfMonth(year, month, weekday, nth);
      }
      if (civil && civilKey(civil) >= civilKey(startCivil)) {
        if (!push(civil, clamped || undefined)) break;
      }
      month += interval;
      while (month > 12) {
        month -= 12;
        year += 1;
      }
    }
  }

  const occurrences = collected.map(({ civil, clamped }) => {
    const parts: DateParts = {
      year: civil.getUTCFullYear(),
      month: civil.getUTCMonth() + 1,
      day: civil.getUTCDate(),
      ...timeOfDay,
    };
    return buildOccurrence(parts, rule.timezone, 'RULE', clamped);
  });

  for (const extra of rule.extraDates ?? []) {
    occurrences.push(buildOccurrence(parseLocalDateTime(extra), rule.timezone, 'EXTRA'));
  }

  const unique = new Map<string, ScheduleOccurrence>();
  for (const occurrence of occurrences) {
    if (!unique.has(occurrence.startsAt)) unique.set(occurrence.startsAt, occurrence);
  }

  return [...unique.values()]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, hardLimit)
    .map((occurrence, index) => ({ ...occurrence, index }));
}

function buildOccurrence(
  parts: DateParts,
  timeZone: string,
  source: ScheduleOccurrence['source'],
  clamped?: boolean,
): ScheduleOccurrence {
  const instant = zonedTimeToUtc(parts, timeZone);
  const local = getZonedParts(instant, timeZone);
  return {
    index: 0,
    startsAt: instant.toISOString(),
    localDate: `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`,
    localTime: `${pad(local.hour)}:${pad(local.minute)}`,
    weekday: new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() as Weekday,
    utcOffsetMinutes: getTimezoneOffsetMinutes(instant, timeZone),
    source,
    ...(clamped ? { clamped: true } : {}),
  };
}

/** Human summary in Spanish, used in the wizard and in series listings. */
export function describeRecurrence(rule: RecurrenceRule): string {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  const start = parseLocalDateTime(rule.startLocal);
  const time = `${pad(start.hour)}:${pad(start.minute)}`;
  let base: string;

  if (rule.frequency === 'DAILY') {
    base = interval === 1 ? 'Todos los días' : `Cada ${interval} días`;
  } else if (rule.frequency === 'WEEKLY') {
    const weekdays = rule.byWeekday?.length
      ? rule.byWeekday
      : [civilDate(start.year, start.month, start.day).getUTCDay() as Weekday];
    const names = weekdays
      .slice()
      .sort((a, b) => ((a === 0 ? 7 : a) - (b === 0 ? 7 : b)))
      .map((d) => WEEKDAY_LABELS[d]);
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0];
    base = interval === 1 ? `Cada ${list}` : `Cada ${interval} semanas los ${list}`;
  } else if ((rule.monthlyMode ?? 'DAY_OF_MONTH') === 'DAY_OF_MONTH') {
    base =
      interval === 1
        ? `El día ${start.day} de cada mes`
        : `El día ${start.day} cada ${interval} meses`;
  } else {
    const weekday =
      WEEKDAY_LABELS[
        rule.nthWeekday ?? (civilDate(start.year, start.month, start.day).getUTCDay() as Weekday)
      ];
    const ordinal = ORDINAL_LABELS[String(rule.nth ?? 1)] ?? 'primer';
    base =
      interval === 1
        ? `El ${ordinal} ${weekday} de cada mes`
        : `El ${ordinal} ${weekday} cada ${interval} meses`;
  }

  const end = rule.untilLocal
    ? ` hasta el ${rule.untilLocal.slice(0, 10)}`
    : ` · ${rule.count ?? DEFAULT_OCCURRENCE_COUNT} fechas`;
  const skipped = rule.exceptions?.length ? ` (${rule.exceptions.length} excepción(es))` : '';

  return `${base} a las ${time}${end}${skipped}`;
}

// ---------------------------------------------------------------------------
// Sale windows
// ---------------------------------------------------------------------------

export type SalePhaseKind = 'PRESALE' | 'MEMBERS' | 'PUBLIC' | 'LAST_MINUTE' | 'DOOR';

export type SaleState =
  | 'DRAFT'
  | 'ANNOUNCED'
  | 'PRESALE'
  | 'ON_SALE'
  | 'PAUSED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'PAST';

export interface SalePhaseWindow {
  id?: string;
  name?: string;
  kind: SalePhaseKind;
  startsAt: string | Date;
  endsAt: string | Date;
  code?: string | null;
  active?: boolean;
}

export interface SaleWindowInput {
  status: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED';
  startsAt: string | Date;
  endsAt?: string | Date | null;
  /** When the event becomes visible in the storefront. */
  announceAt?: string | Date | null;
  /** When DRAFT flips to SCHEDULED automatically. */
  publishAt?: string | Date | null;
  /** General on-sale window. */
  salesStartAt?: string | Date | null;
  salesEndAt?: string | Date | null;
  phases?: SalePhaseWindow[];
}

export interface SaleStatus {
  state: SaleState;
  canPurchase: boolean;
  /** Machine-readable reason when `canPurchase` is false. */
  reason?:
    | 'DRAFT'
    | 'NOT_YET_ON_SALE'
    | 'SALES_CLOSED'
    | 'EVENT_CANCELLED'
    | 'EVENT_FINISHED';
  activePhase?: SalePhaseWindow;
  /** Next scheduled state change, useful for countdowns. */
  nextChangeAt?: string;
  /** Phases whose code unlocks purchasing right now. */
  gatedPhases: SalePhaseWindow[];
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve what a buyer can do with an event right now.
 *
 * Precedence: cancelled → finished → draft/not published → explicit sale
 * windows → phases. A phase with a code never opens general sales; it is
 * reported in `gatedPhases` so the caller can validate the code.
 */
export function resolveSaleStatus(input: SaleWindowInput, now: Date = new Date()): SaleStatus {
  const startsAt = toDate(input.startsAt);
  const endsAt = toDate(input.endsAt) ?? (startsAt ? new Date(startsAt.getTime() + 6 * 3_600_000) : null);
  const announceAt = toDate(input.announceAt);
  const publishAt = toDate(input.publishAt);
  const salesStartAt = toDate(input.salesStartAt);
  const salesEndAt = toDate(input.salesEndAt);

  if (input.status === 'CANCELLED') {
    return { state: 'CANCELLED', canPurchase: false, reason: 'EVENT_CANCELLED', gatedPhases: [] };
  }
  if (endsAt && endsAt.getTime() < now.getTime()) {
    return { state: 'PAST', canPurchase: false, reason: 'EVENT_FINISHED', gatedPhases: [] };
  }
  if (input.status === 'COMPLETED') {
    return { state: 'PAST', canPurchase: false, reason: 'EVENT_FINISHED', gatedPhases: [] };
  }

  const phases = (input.phases ?? []).filter((phase) => phase.active !== false);
  const openPhases = phases.filter((phase) => {
    const from = toDate(phase.startsAt);
    const to = toDate(phase.endsAt);
    return !!from && !!to && from.getTime() <= now.getTime() && to.getTime() > now.getTime();
  });
  const gatedPhases = openPhases.filter((phase) => !!phase.code);
  const openPublicPhase = openPhases.find((phase) => !phase.code);

  const upcoming = [publishAt, announceAt, salesStartAt, salesEndAt, ...phases.flatMap((p) => [toDate(p.startsAt), toDate(p.endsAt)])]
    .filter((date): date is Date => !!date && date.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const nextChangeAt = upcoming ? upcoming.toISOString() : undefined;

  const notPublished =
    input.status === 'DRAFT' && (!publishAt || publishAt.getTime() > now.getTime());
  if (notPublished) {
    return { state: 'DRAFT', canPurchase: false, reason: 'DRAFT', nextChangeAt, gatedPhases: [] };
  }

  if (announceAt && announceAt.getTime() > now.getTime()) {
    return { state: 'DRAFT', canPurchase: false, reason: 'DRAFT', nextChangeAt, gatedPhases: [] };
  }

  if (salesEndAt && salesEndAt.getTime() <= now.getTime()) {
    return { state: 'CLOSED', canPurchase: false, reason: 'SALES_CLOSED', nextChangeAt, gatedPhases: [] };
  }

  if (openPublicPhase) {
    return {
      state: openPublicPhase.kind === 'PUBLIC' ? 'ON_SALE' : 'PRESALE',
      canPurchase: true,
      activePhase: openPublicPhase,
      nextChangeAt,
      gatedPhases,
    };
  }

  const generalOpen = !salesStartAt || salesStartAt.getTime() <= now.getTime();
  if (generalOpen) {
    return { state: 'ON_SALE', canPurchase: true, nextChangeAt, gatedPhases };
  }

  if (gatedPhases.length) {
    return {
      state: 'PRESALE',
      canPurchase: false,
      reason: 'NOT_YET_ON_SALE',
      activePhase: gatedPhases[0],
      nextChangeAt,
      gatedPhases,
    };
  }

  return { state: 'ANNOUNCED', canPurchase: false, reason: 'NOT_YET_ON_SALE', nextChangeAt, gatedPhases };
}

export const SALE_STATE_LABELS: Record<SaleState, string> = {
  DRAFT: 'Borrador',
  ANNOUNCED: 'Anunciado',
  PRESALE: 'Preventa',
  ON_SALE: 'En venta',
  PAUSED: 'Pausado',
  CLOSED: 'Venta cerrada',
  CANCELLED: 'Cancelado',
  PAST: 'Finalizado',
};

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

export type ScheduleConflictKind = 'VENUE_OVERLAP' | 'TURNAROUND' | 'BLACKOUT' | 'DUPLICATE';

export interface ScheduleSlot {
  id?: string;
  title?: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  durationMinutes?: number | null;
}

export interface ScheduleConflict {
  kind: ScheduleConflictKind;
  message: string;
  withId?: string;
  withTitle?: string;
  startsAt: string;
}

export interface ConflictOptions {
  turnaroundMinutes?: number;
  defaultDurationMinutes?: number;
  blackouts?: ScheduleSlot[];
}

function slotWindow(slot: ScheduleSlot, defaultDurationMinutes: number) {
  const start = toDate(slot.startsAt)!;
  const explicitEnd = toDate(slot.endsAt);
  const minutes = slot.durationMinutes ?? defaultDurationMinutes;
  const end = explicitEnd ?? new Date(start.getTime() + minutes * 60_000);
  return { start, end };
}

/**
 * Compare candidate slots against what the venue already has booked.
 *
 * Returns one entry per (candidate, conflict) pair, ordered by candidate. The
 * caller decides whether a conflict blocks the operation or is only a warning.
 */
export function detectScheduleConflicts(
  candidates: ScheduleSlot[],
  booked: ScheduleSlot[],
  options: ConflictOptions = {},
): Map<number, ScheduleConflict[]> {
  const turnaround = Math.max(0, options.turnaroundMinutes ?? DEFAULT_TURNAROUND_MINUTES);
  const duration = options.defaultDurationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES;
  const result = new Map<number, ScheduleConflict[]>();

  candidates.forEach((candidate, index) => {
    const conflicts: ScheduleConflict[] = [];
    const { start, end } = slotWindow(candidate, duration);

    for (const other of booked) {
      if (other.id && candidate.id && other.id === candidate.id) continue;
      const window = slotWindow(other, duration);
      const overlaps = start < window.end && window.start < end;
      if (overlaps) {
        conflicts.push({
          kind: start.getTime() === window.start.getTime() ? 'DUPLICATE' : 'VENUE_OVERLAP',
          message:
            start.getTime() === window.start.getTime()
              ? `Ya existe un evento a la misma hora: ${other.title ?? other.id ?? 'evento'}`
              : `Se traslapa con ${other.title ?? other.id ?? 'otro evento'}`,
          withId: other.id,
          withTitle: other.title,
          startsAt: window.start.toISOString(),
        });
        continue;
      }
      const gapMinutes =
        (start >= window.end
          ? start.getTime() - window.end.getTime()
          : window.start.getTime() - end.getTime()) / 60_000;
      if (turnaround > 0 && gapMinutes < turnaround) {
        conflicts.push({
          kind: 'TURNAROUND',
          message: `Solo ${Math.round(gapMinutes)} min de margen con ${other.title ?? 'otro evento'} (mínimo ${turnaround} min)`,
          withId: other.id,
          withTitle: other.title,
          startsAt: window.start.toISOString(),
        });
      }
    }

    for (const blackout of options.blackouts ?? []) {
      const window = slotWindow(blackout, duration);
      if (start < window.end && window.start < end) {
        conflicts.push({
          kind: 'BLACKOUT',
          message: `El recinto está bloqueado: ${blackout.title ?? 'sin disponibilidad'}`,
          withId: blackout.id,
          withTitle: blackout.title,
          startsAt: window.start.toISOString(),
        });
      }
    }

    // Candidates conflicting with each other (same batch).
    candidates.forEach((peer, peerIndex) => {
      if (peerIndex >= index) return;
      const window = slotWindow(peer, duration);
      if (start < window.end && window.start < end) {
        conflicts.push({
          kind: 'DUPLICATE',
          message: 'Dos fechas de la misma serie se traslapan',
          startsAt: window.start.toISOString(),
        });
      }
    });

    if (conflicts.length) result.set(index, conflicts);
  });

  return result;
}
