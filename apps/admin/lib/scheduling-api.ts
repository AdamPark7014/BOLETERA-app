import type { RecurrenceRule, SaleState, ScheduleConflict, ScheduleOccurrence } from '@boletera/shared';
import { http } from './http';

export type SalePhaseKind = 'PRESALE' | 'MEMBERS' | 'PUBLIC' | 'LAST_MINUTE' | 'DOOR';
export type SalesChannelName = 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN';
export type EventSeriesKind = 'SERIES' | 'RESIDENCY' | 'TOUR' | 'SEASON' | 'FESTIVAL';
export type EventSeriesStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

export type SeriesTemplate = {
  capacity: number;
  basePrice: number;
  zoneName?: string;
  currency?: 'MXN' | 'USD';
  description?: string;
  imageUrl?: string;
  durationMinutes?: number;
  doorsOffsetMinutes?: number;
  announceOffsetDays?: number | null;
  publishOffsetDays?: number | null;
  salesStartOffsetDays?: number | null;
  salesEndOffsetHours?: number | null;
};

export type PhaseTemplate = {
  name: string;
  kind: SalePhaseKind;
  code?: string | null;
  startOffsetDays: number;
  endOffsetDays: number;
  channels?: SalesChannelName[];
  allocationPercent?: number | null;
  maxPerOrder?: number | null;
  discountPercent?: number | null;
  priority?: number;
};

export type OccurrencePreview = ScheduleOccurrence & {
  conflicts: ScheduleConflict[];
  blocking: boolean;
  doorsAt: string;
  endsAt: string;
  announceAt: string | null;
  publishAt: string | null;
  salesStartAt: string | null;
  salesEndAt: string | null;
};

export type SchedulePreview = {
  venue: { id: string; name: string; timezone: string };
  recurrence: RecurrenceRule & { summary: string };
  occurrences: OccurrencePreview[];
  totals: { occurrences: number; withConflicts: number; blocking: number; capacity: number };
  limits: { maxOccurrences: number };
};

export type SalePhase = {
  id: string;
  eventId: string;
  name: string;
  kind: SalePhaseKind;
  code: string | null;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  channels: SalesChannelName[];
  allocationPercent: number | null;
  maxPerOrder: number | null;
  discountPercent: number | null;
  priority: number;
  notes: string | null;
};

export type EventScheduleDetail = {
  event: {
    id: string;
    title: string;
    status: string;
    timezone: string;
    startsAt: string;
    endsAt: string | null;
    doorsAt: string | null;
    durationMinutes: number | null;
    announceAt: string | null;
    publishAt: string | null;
    salesStartAt: string | null;
    salesEndAt: string | null;
    publishedAt: string | null;
    rescheduledFrom: string | null;
    scheduleNote: string | null;
    seriesId: string | null;
    seriesOrder: number | null;
    venue: { id: string; name: string } | null;
  };
  sale: {
    state: SaleState;
    canPurchase: boolean;
    reason?: string;
    nextChangeAt?: string;
    gatedPhases: { id?: string; name?: string; code?: string | null }[];
  };
  phases: SalePhase[];
  conflicts: ScheduleConflict[];
};

export type SeriesRow = {
  id: string;
  name: string;
  slug: string;
  kind: EventSeriesKind;
  status: EventSeriesStatus;
  timezone: string;
  venue: { id: string; name: string } | null;
  summary: string | null;
  totals: { events: number; upcoming: number; cancelled: number; capacity: number };
  firstDate: string | null;
  lastDate: string | null;
  nextDate: string | null;
  createdAt: string;
};

export type SeriesDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: EventSeriesKind;
  status: EventSeriesStatus;
  category: string;
  timezone: string;
  venue: { id: string; name: string; timezone: string } | null;
  recurrence: (RecurrenceRule & { summary: string | null }) | null;
  template: SeriesTemplate | null;
  events: {
    id: string;
    title: string;
    slug: string;
    status: string;
    seriesOrder: number | null;
    startsAt: string;
    endsAt: string | null;
    doorsAt: string | null;
    localDate: string;
    totalCapacity: number;
    sale: { state: SaleState; canPurchase: boolean; nextChangeAt?: string };
    counts: { tickets: number; orders: number };
  }[];
};

export type CalendarEvent = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  doorsAt: string | null;
  localDate: string;
  localTime: string;
  timezone: string;
  venue: { id: string; name: string } | null;
  series: { id: string; name: string; kind: EventSeriesKind } | null;
  seriesOrder: number | null;
  capacity: number;
  orders: number;
  saleState: SaleState;
  canPurchase: boolean;
  nextChangeAt: string | null;
  phases: number;
  conflicts: ScheduleConflict[];
};

export type CalendarResponse = {
  range: { from: string; to: string };
  events: CalendarEvent[];
  days: Record<string, CalendarEvent[]>;
  blackouts: {
    id: string;
    reason: string;
    startsAt: string;
    endsAt: string;
    blocking: boolean;
    venue: { id: string; name: string } | null;
  }[];
  totals: { events: number; onSale: number; presale: number; draft: number; conflicts: number };
};

export type TransitionsResponse = {
  horizonHours: number;
  publishing: { eventId: string; title: string; at: string }[];
  onSale: { eventId: string; title: string; at: string }[];
  closing: { eventId: string; title: string; at: string }[];
  phases: {
    phaseId: string;
    eventId: string;
    title: string;
    name: string;
    kind: SalePhaseKind;
    opensAt: string;
    closesAt: string;
  }[];
};

export type VenueBlackout = {
  id: string;
  venueId: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  blocking: boolean;
};

const BASE = '/events/schedule';

export function previewSchedule(body: {
  rule: RecurrenceRule;
  venueId: string;
  template?: Partial<SeriesTemplate>;
  turnaroundMinutes?: number;
  excludeSeriesId?: string;
}) {
  return http<SchedulePreview>(`${BASE}/preview`, { method: 'POST', body });
}

export function createScheduledEvent(body: {
  title: string;
  description?: string;
  category?: string;
  venueId: string;
  startLocal: string;
  timezone?: string;
  template: SeriesTemplate;
  phases?: PhaseTemplate[];
  publish?: boolean;
  force?: boolean;
}) {
  return http<{ event: { id: string; title: string; startsAt: string } }>(`${BASE}/events`, {
    method: 'POST',
    body,
  });
}

export function createSeries(body: {
  name: string;
  description?: string;
  kind?: EventSeriesKind;
  category?: string;
  venueId: string;
  rule: RecurrenceRule;
  template: SeriesTemplate;
  phases?: PhaseTemplate[];
  publish?: boolean;
  force?: boolean;
  turnaroundMinutes?: number;
}) {
  return http<SeriesDetail>(`${BASE}/series`, { method: 'POST', body });
}

export function listSeries() {
  return http<SeriesRow[]>(`${BASE}/series`);
}

export function getSeries(seriesId: string) {
  return http<SeriesDetail>(`${BASE}/series/${seriesId}`);
}

export function updateSeries(
  seriesId: string,
  body: { name?: string; description?: string; status?: EventSeriesStatus },
) {
  return http<SeriesDetail>(`${BASE}/series/${seriesId}`, { method: 'PATCH', body });
}

export function extendSeries(
  seriesId: string,
  body: { count?: number; untilLocal?: string; publish?: boolean; force?: boolean },
) {
  return http<{ added: number; series: SeriesDetail }>(`${BASE}/series/${seriesId}/extend`, {
    method: 'POST',
    body,
  });
}

export function getEventSchedule(eventId: string) {
  return http<EventScheduleDetail>(`${BASE}/events/${eventId}`);
}

export function setSaleWindows(
  eventId: string,
  body: {
    announceAt?: string | null;
    publishAt?: string | null;
    salesStartAt?: string | null;
    salesEndAt?: string | null;
    doorsAt?: string | null;
    durationMinutes?: number | null;
  },
) {
  return http<EventScheduleDetail>(`${BASE}/events/${eventId}/windows`, { method: 'PUT', body });
}

export function rescheduleEvent(
  eventId: string,
  body: {
    startsAt: string;
    durationMinutes?: number;
    doorsAt?: string;
    reason: string;
    force?: boolean;
    keepStatus?: boolean;
  },
) {
  return http<{ conflicts: ScheduleConflict[] }>(`${BASE}/events/${eventId}/reschedule`, {
    method: 'PATCH',
    body,
  });
}

export function cancelEvent(eventId: string, reason: string) {
  return http<{ id: string; status: string }>(`${BASE}/events/${eventId}/cancel`, {
    method: 'PATCH',
    body: { reason },
  });
}

export function upsertSalePhase(
  eventId: string,
  body: {
    id?: string;
    name: string;
    kind: SalePhaseKind;
    code?: string | null;
    startsAt: string;
    endsAt: string;
    channels?: SalesChannelName[];
    allocationPercent?: number | null;
    maxPerOrder?: number | null;
    discountPercent?: number | null;
    priority?: number;
    notes?: string | null;
  },
) {
  return http<SalePhase>(`${BASE}/events/${eventId}/phases`, { method: 'PUT', body });
}

export function deleteSalePhase(eventId: string, phaseId: string) {
  return http<{ deleted: boolean }>(`${BASE}/events/${eventId}/phases/${phaseId}`, {
    method: 'DELETE',
  });
}

export function getScheduleCalendar(params: {
  from: string;
  to: string;
  venueId?: string;
  status?: string;
}) {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.venueId) query.set('venueId', params.venueId);
  if (params.status) query.set('status', params.status);
  return http<CalendarResponse>(`${BASE}/calendar?${query.toString()}`);
}

export function getUpcomingTransitions(hours = 72) {
  return http<TransitionsResponse>(`${BASE}/transitions?hours=${hours}`);
}

export function listBlackouts(venueId: string) {
  return http<VenueBlackout[]>(`${BASE}/venues/${venueId}/blackouts`);
}

export function createBlackout(
  venueId: string,
  body: { reason: string; startsAt: string; endsAt: string; blocking?: boolean },
) {
  return http<{ blackout: VenueBlackout; affectedEvents: number }>(
    `${BASE}/venues/${venueId}/blackouts`,
    { method: 'POST', body },
  );
}

export function deleteBlackout(venueId: string, blackoutId: string) {
  return http<{ deleted: boolean }>(`${BASE}/venues/${venueId}/blackouts/${blackoutId}`, {
    method: 'DELETE',
  });
}
