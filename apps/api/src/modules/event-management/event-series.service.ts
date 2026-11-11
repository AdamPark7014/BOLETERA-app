import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventSeriesStatus, EventStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DEFAULT_EVENT_DURATION_MINUTES,
  DEFAULT_TURNAROUND_MINUTES,
  MAX_OCCURRENCES,
  describeRecurrence,
  detectScheduleConflicts,
  expandRecurrence,
  isValidTimezone,
  resolveSaleStatus,
  type RecurrenceRule,
  type SaleWindowInput,
  type ScheduleConflict,
  type ScheduleOccurrence,
  type ScheduleSlot,
} from '@boletera/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Valores por omisión que se copian a cada fecha generada de una serie. Es la
 * misma forma que manda el panel (`SeriesTemplate` en apps/admin/lib/scheduling-api).
 */
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

export type PreviewInput = {
  rule?: unknown;
  venueId?: string;
  template?: Partial<SeriesTemplate>;
  turnaroundMinutes?: number;
  excludeSeriesId?: string;
};

export type SeriesPatch = { name?: string; description?: string | null; status?: string };
export type ExtendInput = {
  count?: number;
  untilLocal?: string;
  publish?: boolean;
  force?: boolean;
};

const FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY']);
const SERIES_STATUSES = new Set<string>(Object.values(EventSeriesStatus));
/** Conflictos que impiden crear fechas sin `force`; el margen corto solo avisa. */
const BLOCKING_KINDS = new Set(['VENUE_OVERLAP', 'DUPLICATE']);
const DAY_MS = 86_400_000;

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Valida la regla que manda el panel. No la reescribe: solo comprueba que
 * `expandRecurrence` la pueda leer y devuelve mensajes en español.
 */
export function parseRecurrenceRule(raw: unknown): RecurrenceRule {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException('Falta la regla de recurrencia');
  }
  const rule = raw as Record<string, unknown>;
  if (typeof rule.frequency !== 'string' || !FREQUENCIES.has(rule.frequency)) {
    throw new BadRequestException('La frecuencia debe ser DAILY, WEEKLY o MONTHLY');
  }
  if (
    typeof rule.startLocal !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rule.startLocal)
  ) {
    throw new BadRequestException('La fecha de inicio debe venir como AAAA-MM-DDTHH:mm');
  }
  if (typeof rule.timezone !== 'string' || !isValidTimezone(rule.timezone)) {
    throw new BadRequestException('Zona horaria desconocida');
  }
  if (
    rule.interval !== undefined &&
    (!Number.isInteger(rule.interval) || (rule.interval as number) < 1)
  ) {
    throw new BadRequestException('El intervalo debe ser un entero mayor que cero');
  }
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || (rule.count as number) < 1)) {
    throw new BadRequestException('El número de fechas debe ser un entero mayor que cero');
  }
  if (
    rule.untilLocal !== undefined &&
    (typeof rule.untilLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(rule.untilLocal))
  ) {
    throw new BadRequestException('La fecha final debe venir como AAAA-MM-DD');
  }
  if (rule.byWeekday !== undefined) {
    const days = rule.byWeekday;
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new BadRequestException('Los días de la semana van de 0 (domingo) a 6 (sábado)');
    }
  }
  for (const key of ['exceptions', 'extraDates'] as const) {
    const list = rule[key];
    if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== 'string'))) {
      throw new BadRequestException(`${key} debe ser una lista de fechas`);
    }
  }
  try {
    expandRecurrence(rule as unknown as RecurrenceRule, { limit: 1 });
  } catch (error) {
    throw new BadRequestException(
      `Regla de recurrencia inválida: ${error instanceof Error ? error.message : 'sin detalle'}`
    );
  }
  return rule as unknown as RecurrenceRule;
}

function safeSummary(rule: RecurrenceRule): string | null {
  try {
    return describeRecurrence(rule);
  } catch {
    return null;
  }
}

/** Lee la regla guardada en `EventSeries.recurrence`; si no es válida devuelve null. */
export function storedRule(value: Prisma.JsonValue | null | undefined): RecurrenceRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return parseRecurrenceRule(value);
  } catch {
    return null;
  }
}

export function storedTemplate(value: Prisma.JsonValue | null | undefined): SeriesTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const capacity = finiteOrNull(raw.capacity);
  const basePrice = finiteOrNull(raw.basePrice);
  if (capacity === null || basePrice === null) return null;
  return { ...(raw as unknown as SeriesTemplate), capacity, basePrice };
}

/** Horarios derivados de una fecha con los desfases de la plantilla (todo antes del inicio). */
export function occurrenceWindows(startsAtIso: string, template: Partial<SeriesTemplate> = {}) {
  const start = new Date(startsAtIso).getTime();
  const duration = finiteOrNull(template.durationMinutes) ?? DEFAULT_EVENT_DURATION_MINUTES;
  const doors = Math.max(0, finiteOrNull(template.doorsOffsetMinutes) ?? 0);
  const daysBefore = (value: unknown) => {
    const n = finiteOrNull(value);
    return n === null ? null : new Date(start - n * DAY_MS).toISOString();
  };
  const salesEndHours = finiteOrNull(template.salesEndOffsetHours);
  return {
    durationMinutes: duration,
    doorsAt: new Date(start - doors * 60_000).toISOString(),
    endsAt: new Date(start + duration * 60_000).toISOString(),
    announceAt: daysBefore(template.announceOffsetDays),
    publishAt: daysBefore(template.publishOffsetDays),
    salesStartAt: daysBefore(template.salesStartOffsetDays),
    salesEndAt:
      salesEndHours === null ? null : new Date(start - salesEndHours * 3_600_000).toISOString(),
  };
}

/**
 * Fechas de la regla más las que el operador excluyó (marcadas por `localDate`
 * en `exceptions`), para que el panel pueda volver a incluirlas. Las excluidas
 * no cuentan en totales. Es puro: misma regla, mismas fechas.
 */
export function expandWithExcluded(rule: RecurrenceRule): {
  active: ScheduleOccurrence[];
  excluded: ScheduleOccurrence[];
} {
  const active = expandRecurrence(rule);
  const exceptions = new Set((rule.exceptions ?? []).map((value) => value.slice(0, 10)));
  if (!exceptions.size) return { active, excluded: [] };
  const widened = expandRecurrence({
    ...rule,
    exceptions: [],
    extraDates: [],
    ...(rule.untilLocal
      ? {}
      : { count: Math.min((rule.count ?? active.length) + exceptions.size, MAX_OCCURRENCES) }),
  });
  const last = active.length ? active[active.length - 1].startsAt : null;
  const excluded = widened.filter(
    (item) => exceptions.has(item.localDate) && (!last || item.startsAt <= last || rule.untilLocal)
  );
  return { active, excluded };
}

type BookedEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  durationMinutes: number | null;
};
type Blackout = { id: string; reason: string; startsAt: Date; endsAt: Date; blocking: boolean };

/** Marca conflictos y si bloquean. Puro: recibe lo agendado ya leído. */
export function annotateConflicts(
  occurrences: ScheduleOccurrence[],
  template: Partial<SeriesTemplate>,
  booked: BookedEvent[],
  blackouts: Blackout[],
  turnaroundMinutes: number
) {
  const windows = occurrences.map((item) => occurrenceWindows(item.startsAt, template));
  const slots: ScheduleSlot[] = occurrences.map((item, index) => ({
    startsAt: item.startsAt,
    endsAt: windows[index].endsAt,
  }));
  const found = detectScheduleConflicts(
    slots,
    booked.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      durationMinutes: event.durationMinutes,
    })),
    {
      turnaroundMinutes,
      blackouts: blackouts.map((b) => ({
        id: b.id,
        title: b.reason,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
      })),
    }
  );
  const hardBlackouts = new Set(blackouts.filter((b) => b.blocking).map((b) => b.id));
  return occurrences.map((item, index) => {
    const conflicts: ScheduleConflict[] = found.get(index) ?? [];
    const blocking = conflicts.some(
      (c) =>
        BLOCKING_KINDS.has(c.kind) ||
        (c.kind === 'BLACKOUT' && !!c.withId && hardBlackouts.has(c.withId))
    );
    return { ...item, ...windows[index], conflicts, blocking };
  });
}

@Injectable()
export class EventSeriesService {
  private logger = new Logger(EventSeriesService.name);

  constructor(private prisma: PrismaService) {}

  private requireOrg(orgId: string | undefined): string {
    if (!orgId) throw new BadRequestException('Tu usuario no tiene organización');
    return orgId;
  }

  // ==================== LISTA ====================

  async listSeries(orgId: string, now: Date = new Date()) {
    const organizationId = this.requireOrg(orgId);
    const rows = await this.prisma.eventSeries.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        status: true,
        timezone: true,
        recurrence: true,
        createdAt: true,
        venue: { select: { id: true, name: true } },
        events: { select: { startsAt: true, status: true, totalCapacity: true } },
      },
    });

    return rows.map((row) => {
      const live = row.events.filter((e) => e.status !== EventStatus.CANCELLED);
      const dates = row.events.map((e) => e.startsAt.getTime()).sort((a, b) => a - b);
      const upcoming = live
        .map((e) => e.startsAt.getTime())
        .filter((t) => t > now.getTime())
        .sort((a, b) => a - b);
      const rule = storedRule(row.recurrence);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        kind: row.kind,
        status: row.status,
        timezone: row.timezone,
        venue: row.venue,
        summary: rule ? safeSummary(rule) : null,
        totals: {
          events: row.events.length,
          upcoming: upcoming.length,
          cancelled: row.events.length - live.length,
          capacity: live.reduce((sum, e) => sum + e.totalCapacity, 0),
        },
        firstDate: dates.length ? new Date(dates[0]).toISOString() : null,
        lastDate: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null,
        nextDate: upcoming.length ? new Date(upcoming[0]).toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ==================== DETALLE ====================

  async getSeries(orgId: string, seriesId: string, now: Date = new Date()) {
    const organizationId = this.requireOrg(orgId);
    const series = await this.prisma.eventSeries.findFirst({
      where: { id: seriesId, organizationId },
      include: {
        venue: { select: { id: true, name: true, timezone: true } },
        events: {
          orderBy: [{ startsAt: 'asc' }],
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            seriesOrder: true,
            startsAt: true,
            endsAt: true,
            doorsAt: true,
            timezone: true,
            announceAt: true,
            publishAt: true,
            salesStartAt: true,
            salesEndAt: true,
            totalCapacity: true,
            salePhases: {
              select: {
                id: true,
                name: true,
                kind: true,
                code: true,
                startsAt: true,
                endsAt: true,
                status: true,
              },
            },
            _count: { select: { tickets: true, orders: true } },
          },
        },
      },
    });
    // Otra organización y no existe dan lo mismo: no se filtra qué ids hay.
    if (!series) throw new NotFoundException('Serie no encontrada');

    const rule = storedRule(series.recurrence);
    return {
      id: series.id,
      name: series.name,
      slug: series.slug,
      description: series.description,
      kind: series.kind,
      status: series.status,
      category: series.category,
      timezone: series.timezone,
      venue: series.venue,
      recurrence: rule ? { ...rule, summary: safeSummary(rule) } : null,
      template: storedTemplate(series.template),
      events: series.events.map((event) => {
        const sale = resolveSaleStatus(
          {
            status: event.status as SaleWindowInput['status'],
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            announceAt: event.announceAt,
            publishAt: event.publishAt,
            salesStartAt: event.salesStartAt,
            salesEndAt: event.salesEndAt,
            phases: event.salePhases.map((phase) => ({
              id: phase.id,
              name: phase.name,
              kind: phase.kind,
              code: phase.code,
              startsAt: phase.startsAt,
              endsAt: phase.endsAt,
              active: phase.status !== 'CANCELLED',
            })),
          },
          now
        );
        return {
          id: event.id,
          title: event.title,
          slug: event.slug,
          status: event.status,
          seriesOrder: event.seriesOrder,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt?.toISOString() ?? null,
          doorsAt: event.doorsAt?.toISOString() ?? null,
          localDate: localDate(event.startsAt, event.timezone || series.timezone),
          totalCapacity: event.totalCapacity,
          sale: {
            state: sale.state,
            canPurchase: sale.canPurchase,
            ...(sale.nextChangeAt ? { nextChangeAt: sale.nextChangeAt } : {}),
          },
          counts: { tickets: event._count.tickets, orders: event._count.orders },
        };
      }),
    };
  }

  // ==================== EDICIÓN ====================

  async updateSeries(orgId: string, seriesId: string, patch: SeriesPatch) {
    const organizationId = this.requireOrg(orgId);
    const existing = await this.prisma.eventSeries.findFirst({
      where: { id: seriesId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Serie no encontrada');

    const data: Prisma.EventSeriesUpdateInput = {};
    if (patch?.name !== undefined) {
      const name = String(patch.name).trim();
      if (name.length < 3)
        throw new BadRequestException('El nombre necesita al menos 3 caracteres');
      data.name = name;
    }
    if (patch?.description !== undefined) {
      data.description =
        patch.description === null ? null : String(patch.description).trim() || null;
    }
    if (patch?.status !== undefined) {
      if (!SERIES_STATUSES.has(patch.status)) {
        throw new BadRequestException('Estado inválido: DRAFT, ACTIVE, COMPLETED o ARCHIVED');
      }
      data.status = patch.status as EventSeriesStatus;
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nada que actualizar');

    await this.prisma.eventSeries.update({ where: { id: seriesId }, data });
    return this.getSeries(organizationId, seriesId);
  }

  // ==================== VISTA PREVIA ====================

  /** Calcula fechas y conflictos sin escribir nada. */
  async previewSchedule(orgId: string, input: PreviewInput) {
    const organizationId = this.requireOrg(orgId);
    const rule = parseRecurrenceRule(input?.rule);
    if (!input?.venueId) throw new BadRequestException('Falta el recinto');
    const venue = await this.prisma.venue.findFirst({
      where: { id: input.venueId, organizationId },
      select: { id: true, name: true, timezone: true },
    });
    if (!venue) throw new NotFoundException('Recinto no encontrado');

    const template = input.template ?? {};
    const turnaround = Math.max(
      0,
      finiteOrNull(input.turnaroundMinutes) ?? DEFAULT_TURNAROUND_MINUTES
    );
    const { active, excluded } = expandWithExcluded(rule);
    const { booked, blackouts } = await this.loadVenueCalendar(
      venue.id,
      active,
      input.excludeSeriesId
    );
    const annotated = annotateConflicts(active, template, booked, blackouts, turnaround);
    const excludedRows = excluded.map((item) => ({
      ...item,
      ...occurrenceWindows(item.startsAt, template),
      conflicts: [] as ScheduleConflict[],
      blocking: false,
    }));
    const occurrences = [...annotated, ...excludedRows]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(({ durationMinutes: _duration, ...item }) => item);
    const capacity = Math.max(0, finiteOrNull(template.capacity) ?? 0);

    return {
      venue,
      recurrence: { ...rule, summary: safeSummary(rule) ?? '' },
      occurrences,
      totals: {
        occurrences: annotated.length,
        withConflicts: annotated.filter((item) => item.conflicts.length > 0).length,
        blocking: annotated.filter((item) => item.blocking).length,
        capacity: capacity * annotated.length,
      },
      limits: { maxOccurrences: MAX_OCCURRENCES },
    };
  }

  private async loadVenueCalendar(
    venueId: string,
    occurrences: ScheduleOccurrence[],
    excludeSeriesId?: string
  ) {
    if (!occurrences.length) return { booked: [] as BookedEvent[], blackouts: [] as Blackout[] };
    const from = new Date(new Date(occurrences[0].startsAt).getTime() - 2 * DAY_MS);
    const to = new Date(
      new Date(occurrences[occurrences.length - 1].startsAt).getTime() + 2 * DAY_MS
    );
    const [booked, blackouts] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          venueId,
          status: { not: EventStatus.CANCELLED },
          startsAt: { gte: from, lte: to },
          ...(excludeSeriesId
            ? { OR: [{ seriesId: null }, { seriesId: { not: excludeSeriesId } }] }
            : {}),
        },
        select: { id: true, title: true, startsAt: true, endsAt: true, durationMinutes: true },
      }),
      this.prisma.venueBlackout.findMany({
        where: { venueId, startsAt: { lte: to }, endsAt: { gte: from } },
        select: { id: true, reason: true, startsAt: true, endsAt: true, blocking: true },
      }),
    ]);
    return { booked, blackouts };
  }

  // ==================== EXTENDER ====================

  /**
   * Agrega fechas siguiendo la regla guardada, después de la última fecha de la
   * serie. Usa la plantilla guardada; sin regla o sin plantilla no se puede.
   */
  async extendSeries(orgId: string, seriesId: string, input: ExtendInput) {
    const organizationId = this.requireOrg(orgId);
    const series = await this.prisma.eventSeries.findFirst({
      where: { id: seriesId, organizationId },
      include: { events: { select: { startsAt: true, seriesOrder: true } } },
    });
    if (!series) throw new NotFoundException('Serie no encontrada');
    const rule = storedRule(series.recurrence);
    const template = storedTemplate(series.template);
    if (!rule || !template) {
      throw new BadRequestException(
        'La serie no tiene regla ni plantilla guardadas: no se puede extender'
      );
    }
    if (!series.venueId) throw new BadRequestException('La serie no tiene recinto');

    const count = input?.count === undefined ? undefined : Number(input.count);
    const untilLocal = input?.untilLocal;
    if (count === undefined && !untilLocal)
      throw new BadRequestException('Indica cuántas fechas o hasta cuándo');
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES)) {
      throw new BadRequestException(`Se agregan de 1 a ${MAX_OCCURRENCES} fechas`);
    }
    if (untilLocal !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(String(untilLocal))) {
      throw new BadRequestException('La fecha final debe venir como AAAA-MM-DD');
    }

    const lastExisting = series.events.reduce((max, e) => Math.max(max, e.startsAt.getTime()), 0);
    const widened = expandRecurrence({
      ...rule,
      extraDates: [],
      ...(untilLocal
        ? { untilLocal, count: undefined }
        : { untilLocal: undefined, count: MAX_OCCURRENCES }),
    });
    let fresh = widened.filter((item) => new Date(item.startsAt).getTime() > lastExisting);
    if (count !== undefined) fresh = fresh.slice(0, count);
    if (!fresh.length) {
      throw new BadRequestException(
        `La regla no da más fechas después de la última (límite de ${MAX_OCCURRENCES} desde el inicio)`
      );
    }
    if (series.events.length + fresh.length > MAX_OCCURRENCES) {
      throw new BadRequestException(`Una serie admite hasta ${MAX_OCCURRENCES} fechas`);
    }

    const { booked, blackouts } = await this.loadVenueCalendar(series.venueId, fresh, series.id);
    const annotated = annotateConflicts(
      fresh,
      template,
      booked,
      blackouts,
      DEFAULT_TURNAROUND_MINUTES
    );
    const blocking = annotated.filter((item) => item.blocking);
    if (blocking.length && !input?.force) {
      throw new ConflictException(
        `${blocking.length} fecha(s) chocan con otros eventos o bloqueos del recinto (primera: ${blocking[0].localDate} ${blocking[0].localTime})`
      );
    }

    const startOrder = series.events.reduce((max, e) => Math.max(max, e.seriesOrder ?? 0), 0);
    const price = new Decimal(template.basePrice);
    const zone = template.zoneName?.trim();
    const status = input?.publish ? EventStatus.SCHEDULED : EventStatus.DRAFT;

    await this.prisma.$transaction(
      async (tx) => {
        for (const [i, item] of annotated.entries()) {
          const created = await tx.event.create({
            data: {
              title: series.name,
              description: template.description ?? series.description ?? series.name,
              slug: `${slugBase(series.name)}-${item.localDate}-${Date.now().toString(36)}${i}`,
              organizationId,
              venueId: series.venueId!,
              category: series.category,
              startsAt: new Date(item.startsAt),
              endsAt: new Date(item.endsAt),
              doorsAt: new Date(item.doorsAt),
              durationMinutes: item.durationMinutes,
              announceAt: item.announceAt ? new Date(item.announceAt) : null,
              publishAt: item.publishAt ? new Date(item.publishAt) : null,
              salesStartAt: item.salesStartAt ? new Date(item.salesStartAt) : null,
              salesEndAt: item.salesEndAt ? new Date(item.salesEndAt) : null,
              timezone: rule.timezone,
              status,
              image: template.imageUrl,
              totalCapacity: template.capacity,
              currency: template.currency ?? 'MXN',
              minPrice: price,
              maxPrice: price,
              seriesId: series.id,
              seriesOrder: startOrder + i + 1,
              metadata: {
                eventKind: 'series',
                createdFrom: 'series_extend',
                basePrice: template.basePrice,
              },
            },
          });
          if (zone) {
            await tx.offer.create({
              data: {
                eventId: created.id,
                name: zone,
                zone,
                basePrice: price,
                currency: template.currency ?? 'MXN',
                totalQuantity: template.capacity,
                remainingQuantity: template.capacity,
                startDate: created.startsAt,
                endDate: created.endsAt ?? created.startsAt,
              },
            });
          }
        }
        // La regla guardada refleja ahora el total generado por regla.
        const nextRule: RecurrenceRule = untilLocal
          ? { ...rule, untilLocal, count: undefined }
          : { ...rule, count: (rule.count ?? 0) + annotated.length };
        await tx.eventSeries.update({
          where: { id: series.id },
          data: { recurrence: JSON.parse(JSON.stringify(nextRule)) as Prisma.InputJsonValue },
        });
      },
      { timeout: 60_000 }
    );

    this.logger.log(`Serie ${series.id} extendida con ${annotated.length} fecha(s)`);
    return { added: annotated.length, series: await this.getSeries(organizationId, series.id) };
  }
}

function slugBase(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'serie'
  );
}

function localDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
