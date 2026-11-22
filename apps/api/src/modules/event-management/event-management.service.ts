import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventSeriesKind,
  EventCategory,
  EventSeriesStatus,
  EventStatus,
  Prisma,
  SalePhaseKind,
  SalePhaseStatus,
  SalesChannel,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { SaleWindowService } from './sale-window.service';
import { SalePhaseQuotaService, type PhaseQuotaUsage } from './sale-phase-quota.service';
import { resolvePhaseStatus, withResolvedStatus } from './sale-phase-status';
import { storedRule, storedTemplate } from './event-series.service';

type EventMetadata = Record<string, unknown>;

/** Alta/edición de una fase de venta. En edición todo es opcional. */
export type SalePhaseInput = {
  name: string;
  kind?: SalePhaseKind;
  code?: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
  status?: SalePhaseStatus;
  channels?: SalesChannel[];
  allocationPercent?: number | null;
  maxPerOrder?: number | null;
  discountPercent?: number | null;
  priority?: number;
  notes?: string | null;
};

export type SalePhasePatch = Partial<SalePhaseInput>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EVENT_TIME_ZONE = 'America/Mexico_City';

/** AAAA-MM-DD del instante en la zona dada. */
export function localDateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

@Injectable()
export class EventManagementService {
  private logger = new Logger(EventManagementService.name);

  constructor(
    private prisma: PrismaService,
    private saleWindow: SaleWindowService,
    private phaseQuota: SalePhaseQuotaService
  ) {}

  private slugify(text: string) {
    // Sin quitar acentos, "Límite" daba "l-mite" y "Año" daba "a-o" en la URL.
    return `${text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;
  }

  private async mergeMetadata(eventId: string, patch: EventMetadata) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');
    const current = (event.metadata as EventMetadata) ?? {};
    return this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: { ...current, ...patch } as Prisma.InputJsonValue },
      include: { venue: true, organization: true },
    });
  }

  async createEvent(
    orgId: string,
    data: {
      title: string;
      description: string;
      type: 'single' | 'series' | 'residency';
      startDate: Date;
      endDate?: Date;
      venueId: string;
      capacity: number;
      basePrice: number;
      /** Zona de precio. El alta ya la pide; sin ella no hay Offer. */
      zoneName?: string;
      imageUrl?: string;
      timezone?: string;
      /**
       * Ventana de venta. El asistente de alta ya la pedía y la validaba, pero
       * no llegaba hasta aquí: el operador configuraba un horario que se
       * descartaba en silencio. `SaleWindowService` lee estos dos campos.
       */
      salesStartAt?: Date | string;
      salesEndAt?: Date | string;
    }
  ) {
    const salesStartAt = data.salesStartAt ? new Date(data.salesStartAt) : null;
    const salesEndAt = data.salesEndAt ? new Date(data.salesEndAt) : null;
    const startsAt = new Date(data.startDate);

    if (salesStartAt && Number.isNaN(salesStartAt.getTime())) {
      throw new BadRequestException('salesStartAt inválido');
    }
    if (salesEndAt && Number.isNaN(salesEndAt.getTime())) {
      throw new BadRequestException('salesEndAt inválido');
    }
    if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
      throw new BadRequestException('La venta no puede cerrar antes de abrir');
    }
    // Vender después de que el evento empezó no tiene sentido salvo en puerta,
    // que se modela con una fase DOOR, no con la ventana suelta del evento.
    if (salesEndAt && salesEndAt > startsAt) {
      throw new BadRequestException(
        'La venta no puede cerrar después de que empiece el evento; usa una fase de venta en puerta'
      );
    }

    const zone = typeof data.zoneName === 'string' ? data.zoneName.trim() : '';
    const endsAt = data.endDate ? new Date(data.endDate) : null;
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('endDate inválido');
    }
    if (zone) {
      if (!Number.isFinite(data.basePrice) || data.basePrice <= 0) {
        throw new BadRequestException('El precio tiene que ser mayor que $0.00.');
      }
      if (!Number.isInteger(data.capacity) || data.capacity <= 0) {
        throw new BadRequestException('El cupo tiene que ser mayor que cero.');
      }
    }

    const price = new Decimal(data.basePrice);
    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          title: data.title,
          description: data.description,
          slug: this.slugify(data.title),
          organizationId: orgId,
          venueId: data.venueId,
          startsAt,
          endsAt: endsAt ?? undefined,
          salesStartAt,
          salesEndAt,
          timezone: data.timezone ?? 'America/Mexico_City',
          status: EventStatus.DRAFT,
          image: data.imageUrl,
          totalCapacity: data.capacity,
          currency: 'MXN',
          minPrice: price,
          maxPrice: price,
          metadata: {
            eventKind: data.type,
            basePrice: data.basePrice,
            createdFrom: 'admin_panel',
          },
        },
        include: { venue: true, organization: true },
      });

      if (!zone) return created;

      const offer = await tx.offer.create({
        data: {
          eventId: created.id,
          name: zone,
          zone,
          basePrice: price,
          currency: 'MXN',
          totalQuantity: data.capacity,
          remainingQuantity: data.capacity,
          startDate: startsAt,
          endDate: endsAt ?? startsAt,
        },
      });

      return { ...created, offers: [offer] };
    });

    this.logger.log(`Event created: ${event.id} (${event.title})`);
    return event;
  }

  /**
   * Minutos del apartado (`holdExpiration`, en segundos).
   * El próximo `SeatHold.expiresAt` usa este número.
   */
  async updateAnnouncedHold(orgId: string, eventId: string, minutes: number) {
    if (!orgId) throw new BadRequestException('organizationId requerido');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
      throw new BadRequestException('La duración del apartado va de 1 a 1440 min.');
    }
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    return this.prisma.event.update({
      where: { id: eventId },
      data: { holdExpiration: minutes * 60 },
      select: { id: true, holdExpiration: true },
    });
  }

  async updateEventMedia(
    orgId: string,
    eventId: string,
    data: { imageUrl?: string; bannerImageUrl?: string }
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const patch: { image?: string; bannerImage?: string } = {};
    if (data.imageUrl !== undefined) patch.image = data.imageUrl.trim() || null;
    if (data.bannerImageUrl !== undefined) patch.bannerImage = data.bannerImageUrl.trim() || null;
    if (!Object.keys(patch).length) {
      throw new BadRequestException('Indica imageUrl y/o bannerImageUrl');
    }

    return await this.prisma.event.update({
      where: { id: eventId },
      data: patch,
      include: { venue: true },
    });
  }

  async createEventSeries(
    orgId: string,
    data: {
      seriesName: string;
      description: string;
      venueId: string;
      occurrences: Array<{
        date: Date | string;
        title?: string;
        capacity?: number;
        basePrice?: number;
      }>;
      /** Regla que generó las fechas (ScheduleBuilder). Se guarda para mostrarla y extender. */
      recurrence?: unknown;
      /** Plantilla de cada fecha (aforo, precio…). Se guarda para extender. */
      template?: unknown;
    }
  ) {
    if (!orgId) throw new BadRequestException('Tu usuario no tiene organización');
    if (!data.seriesName?.trim()) throw new BadRequestException('Falta el nombre de la serie');
    if (!Array.isArray(data.occurrences) || !data.occurrences.length) {
      throw new BadRequestException('La serie necesita al menos una fecha');
    }
    // Del JSON llega texto, no Date: antes `occ.date.toISOString()` reventaba.
    const dates = data.occurrences.map((occ) => new Date(occ.date));
    if (dates.some((d) => Number.isNaN(d.getTime()))) {
      throw new BadRequestException('Hay una fecha inválida en la serie');
    }
    const rule = storedRule(data.recurrence as Prisma.JsonValue);
    const template = storedTemplate(data.template as Prisma.JsonValue);
    const first = data.occurrences[0];
    const savedTemplate = template ?? {
      capacity: first.capacity ?? 5000,
      basePrice: first.basePrice ?? 100,
    };
    const timezone = rule?.timezone ?? 'America/Mexico_City';

    const { series, occurrences } = await this.prisma.$transaction(
      async (tx) => {
        // La fila EventSeries es lo que lee el catálogo (events/schedule/series).
        const series = await tx.eventSeries.create({
          data: {
            organizationId: orgId,
            venueId: data.venueId,
            name: data.seriesName.trim(),
            slug: this.slugify(data.seriesName),
            description: data.description?.trim() || null,
            kind: EventSeriesKind.SERIES,
            // Las fechas nacen SCHEDULED, así que la serie ya está activa.
            status: EventSeriesStatus.ACTIVE,
            timezone,
            recurrence: rule
              ? (JSON.parse(JSON.stringify(rule)) as Prisma.InputJsonValue)
              : Prisma.DbNull,
            template: JSON.parse(JSON.stringify(savedTemplate)) as Prisma.InputJsonValue,
          },
        });

        const occurrences = [];
        for (let i = 0; i < data.occurrences.length; i++) {
          const occ = data.occurrences[i];
          const basePrice = occ.basePrice ?? 100;
          const event = await tx.event.create({
            data: {
              title: occ.title || data.seriesName,
              description: data.description,
              slug: this.slugify(`${data.seriesName}-${dates[i].toISOString()}`),
              organizationId: orgId,
              venueId: data.venueId,
              startsAt: dates[i],
              timezone,
              status: EventStatus.SCHEDULED,
              totalCapacity: occ.capacity ?? 5000,
              minPrice: new Decimal(basePrice),
              maxPrice: new Decimal(basePrice * 2.5),
              seriesId: series.id,
              seriesOrder: i + 1,
              metadata: {
                eventKind: 'series',
                seriesName: data.seriesName,
                seriesOrder: i + 1,
              },
            },
          });
          occurrences.push(event);
        }
        return { series, occurrences };
      },
      { timeout: 60_000 }
    );

    this.logger.log(`Event series created: ${data.seriesName} (${occurrences.length})`);
    return {
      seriesId: series.id,
      seriesName: data.seriesName,
      occurrences,
      totalEvents: occurrences.length,
    };
  }

  async createResidency(
    orgId: string,
    data: {
      name: string;
      venueId: string;
      startDate: Date;
      frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
      occurrenceCount: number;
      capacity: number;
      basePrice: number;
      exceptions?: Date[];
    }
  ) {
    if (!orgId) throw new BadRequestException('Tu usuario no tiene organización');
    const events = [];
    let currentDate = new Date(data.startDate);
    const dayInMs = 24 * 60 * 60 * 1000;
    let created = 0;

    // Fila EventSeries para que la residencia aparezca en el catálogo de series.
    const series = await this.prisma.eventSeries.create({
      data: {
        organizationId: orgId,
        venueId: data.venueId,
        name: data.name,
        slug: this.slugify(data.name),
        description: `Residencia: ${data.name}`,
        kind: EventSeriesKind.RESIDENCY,
        status: EventSeriesStatus.ACTIVE,
        template: { capacity: data.capacity, basePrice: data.basePrice },
      },
    });

    while (created < data.occurrenceCount) {
      // Del JSON llegan textos: se convierten antes de comparar.
      if (data.exceptions?.some((d) => new Date(d).toDateString() === currentDate.toDateString())) {
        currentDate = new Date(currentDate.getTime() + dayInMs);
        continue;
      }

      const event = await this.prisma.event.create({
        data: {
          title: `${data.name} — ${currentDate.toLocaleDateString('es-MX')}`,
          description: `Residencia: ${data.name}`,
          slug: this.slugify(`${data.name}-${currentDate.toISOString()}`),
          organizationId: orgId,
          venueId: data.venueId,
          startsAt: new Date(currentDate),
          timezone: 'America/Mexico_City',
          status: EventStatus.SCHEDULED,
          totalCapacity: data.capacity,
          minPrice: new Decimal(data.basePrice),
          maxPrice: new Decimal(data.basePrice * 2),
          seriesId: series.id,
          seriesOrder: created + 1,
          metadata: {
            eventKind: 'residency',
            residencyName: data.name,
            frequency: data.frequency,
            occurrenceNumber: created + 1,
          },
        },
      });
      events.push(event);
      created++;

      if (data.frequency === 'daily') currentDate = new Date(currentDate.getTime() + dayInMs);
      else if (data.frequency === 'weekly')
        currentDate = new Date(currentDate.getTime() + 7 * dayInMs);
      else if (data.frequency === 'biweekly')
        currentDate = new Date(currentDate.getTime() + 14 * dayInMs);
      else currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return {
      seriesId: series.id,
      name: data.name,
      frequency: data.frequency,
      events,
      totalEvents: events.length,
    };
  }

  async setPricingRules(
    eventId: string,
    data: {
      basePrice: number;
      dynamicPricingEnabled: boolean;
      surgeTiers?: Array<{ occupancy: number; multiplier: number }>;
      timeBasedRules?: Array<{ daysUntilEvent: number; multiplier: number }>;
      segmentPricing?: Record<string, number>;
      customZonePricing?: Record<string, number>;
    }
  ) {
    const event = await this.mergeMetadata(eventId, {
      pricingRules: data,
      basePrice: data.basePrice,
    });

    if (data.dynamicPricingEnabled) {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { enableDynamic: true },
      });
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        minPrice: new Decimal(data.basePrice),
        maxPrice: new Decimal(data.basePrice * 3),
      },
    });

    return event;
  }

  async updateOffer(
    eventId: string,
    offerId: string,
    data: { basePrice?: number; name?: string; isAvailable?: boolean }
  ) {
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, eventId } });
    if (!offer) throw new BadRequestException('Offer not found');

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.basePrice != null ? { basePrice: new Decimal(data.basePrice) } : {}),
        ...(data.isAvailable != null ? { isAvailable: data.isAvailable } : {}),
      },
    });

    if (data.basePrice != null) {
      const min = await this.prisma.offer.aggregate({
        where: { eventId, isAvailable: true },
        _min: { basePrice: true },
      });
      if (min._min.basePrice) {
        await this.prisma.event.update({
          where: { id: eventId },
          data: { minPrice: min._min.basePrice },
        });
      }
    }

    return updated;
  }

  async allocateChannels(
    eventId: string,
    data: {
      web: { enabled: boolean; allocation: number; discount?: number };
      taquilla: { enabled: boolean; allocation: number; locations?: string[] };
      api: { enabled: boolean; allocation: number; partners?: string[] };
      phone?: { enabled: boolean; allocation: number };
    }
  ) {
    const total =
      (data.web?.allocation || 0) +
      (data.taquilla?.allocation || 0) +
      (data.api?.allocation || 0) +
      (data.phone?.allocation || 0);

    if (total !== 100) {
      throw new BadRequestException(`Channel allocation must equal 100%, got ${total}%`);
    }

    return this.mergeMetadata(eventId, {
      channelAllocation: { ...data, strategy: 'fixed', lastUpdated: new Date().toISOString() },
    });
  }

  async createCampaign(
    eventId: string,
    data: {
      name: string;
      type: 'presale' | 'early_bird' | 'vip' | 'group' | 'loyalty';
      startDate: Date;
      endDate: Date;
      code?: string;
      allocation: number;
      discountType: 'percentage' | 'fixed';
      discountValue: number;
      quantityPerUser?: number;
      requiresApproval?: boolean;
    }
  ) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');

    const presaleCode =
      data.type === 'presale'
        ? data.code || `PRESALE${Math.random().toString(36).substring(2, 8).toUpperCase()}`
        : data.code;

    const campaigns = ((event.metadata as EventMetadata)?.campaigns as unknown[]) ?? [];
    const campaign = {
      id: `camp_${Date.now()}`,
      eventId,
      name: data.name,
      type: data.type,
      startsAt: data.startDate,
      endsAt: data.endDate,
      code: presaleCode,
      allocation: data.allocation,
      discountType: data.discountType,
      discountValue: data.discountValue,
      quantityPerUser: data.quantityPerUser ?? 4,
      status: 'DRAFT',
      requiresApproval: data.requiresApproval ?? false,
      redemptions: 0,
    };

    campaigns.push(campaign);

    await this.mergeMetadata(eventId, { campaigns });
    this.logger.log(`Campaign created for event ${eventId}: ${data.type}`);
    return campaign;
  }

  /**
   * Calendario mensual en la zona de cada evento. Antes las horas y el día se
   * calculaban en la zona del servidor (UTC): una función de las 14:00 en
   * México salía a las 20:00 y las posteriores a las 18:00 caían al día
   * siguiente.
   */
  async getEventCalendar(orgId: string, month: number, year: number) {
    // Margen de un día a cada lado: el filtro fino es por la fecha local.
    const startDate = new Date(Date.UTC(year, month - 1, 1) - DAY_MS);
    const endDate = new Date(Date.UTC(year, month, 1) + DAY_MS);
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;

    const events = await this.prisma.event.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: startDate, lt: endDate },
      },
      orderBy: { startsAt: 'asc' },
      include: { venue: true },
    });

    const calendar: Record<string, unknown[]> = {};
    let total = 0;
    events.forEach((event) => {
      const timeZone = event.timezone || DEFAULT_EVENT_TIME_ZONE;
      const dateKey = localDateKey(event.startsAt, timeZone);
      if (!dateKey.startsWith(monthPrefix)) return;
      total += 1;
      if (!calendar[dateKey]) calendar[dateKey] = [];
      calendar[dateKey].push({
        id: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        timezone: timeZone,
        startTime: event.startsAt.toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone,
        }),
        venue: event.venue.name,
        capacity: event.totalCapacity,
        status: event.status,
        kind: (event.metadata as EventMetadata)?.eventKind ?? 'single',
      });
    });

    return { month, year, calendar, totalEvents: total };
  }

  async bulkUpdatePricing(eventIds: string[], priceMultiplier: number) {
    for (const id of eventIds) {
      const event = await this.prisma.event.findUnique({ where: { id } });
      if (!event) continue;
      const base = Number(event.minPrice) * priceMultiplier;
      await this.prisma.event.update({
        where: { id },
        data: {
          minPrice: new Decimal(base),
          maxPrice: new Decimal(base * 2.5),
          metadata: {
            ...((event.metadata as EventMetadata) ?? {}),
            priceMultiplier,
          },
        },
      });
    }
    return { updated: eventIds.length };
  }

  async searchEvents(
    orgId: string,
    filters: {
      dateRange?: { start: Date; end: Date };
      venueId?: string;
      type?: string;
      status?: string;
      minCapacity?: number;
      maxCapacity?: number;
    }
  ) {
    const whereClause: Prisma.EventWhereInput = {
      organizationId: orgId,
      ...(filters.dateRange && {
        startsAt: { gte: filters.dateRange.start, lte: filters.dateRange.end },
      }),
      ...(filters.venueId && { venueId: filters.venueId }),
      ...(filters.status && { status: filters.status as EventStatus }),
      ...(filters.minCapacity && { totalCapacity: { gte: filters.minCapacity } }),
      ...(filters.maxCapacity && { totalCapacity: { lte: filters.maxCapacity } }),
    };

    const events = await this.prisma.event.findMany({
      where: whereClause,
      include: {
        venue: true,
        _count: { select: { tickets: true, orders: true } },
      },
      orderBy: { startsAt: 'desc' },
    });

    if (filters.type) {
      return events.filter((e) => (e.metadata as EventMetadata)?.eventKind === filters.type);
    }
    return events;
  }

  // ==================== VENTANA DE VENTA (SalePhase) ====================

  /** El evento debe existir y ser del tenant que pide. */
  private async assertEventInOrg(eventId: string, orgId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        // Denominador del cupo por fase: `allocationPercent` es un % del aforo.
        totalCapacity: true,
        organizationId: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  /**
   * Reglas de negocio de una fase de venta.
   *
   * La importante es la que el asistente de alta ya validaba en pantalla: la
   * venta no puede cerrar después de que empiece el evento. La excepción es la
   * venta en puerta (DOOR), que por definición ocurre con el evento en marcha.
   */
  private normalizeSalePhase(
    input: SalePhasePatch,
    context: {
      eventStartsAt: Date;
      current?: { startsAt: Date; endsAt: Date; kind: SalePhaseKind };
    }
  ) {
    const startsAt = input.startsAt ? new Date(input.startsAt) : context.current?.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : context.current?.endsAt;
    const kind = input.kind ?? context.current?.kind ?? SalePhaseKind.PUBLIC;

    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt inválido');
    }
    if (!endsAt || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('endsAt inválido');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('La fase debe cerrar después de abrir.');
    }
    if (kind !== SalePhaseKind.DOOR && endsAt > context.eventStartsAt) {
      throw new BadRequestException(
        'La venta no puede cerrar después de que empiece el evento (solo la fase DOOR puede).'
      );
    }
    if (
      input.allocationPercent != null &&
      (input.allocationPercent < 1 || input.allocationPercent > 100)
    ) {
      throw new BadRequestException('allocationPercent debe estar entre 1 y 100');
    }
    if (
      input.discountPercent != null &&
      (input.discountPercent < 0 || input.discountPercent > 100)
    ) {
      throw new BadRequestException('discountPercent debe estar entre 0 y 100');
    }
    if (input.maxPerOrder != null && input.maxPerOrder < 1) {
      throw new BadRequestException('maxPerOrder debe ser al menos 1');
    }

    // El código viaja normalizado para que la comprobación en la venta no dependa
    // de cómo lo escribió el comprador.
    const code = input.code === undefined ? undefined : input.code?.trim().toUpperCase() || null;

    return { startsAt, endsAt, kind, code };
  }

  /**
   * La suma de cupos reservados no puede pasar del 100% del aforo: dos fases
   * pidiendo el 70% cada una es una promesa que el inventario no puede cumplir.
   */
  private async assertAllocationFits(
    eventId: string,
    allocationPercent: number | null | undefined,
    excludePhaseId?: string
  ) {
    if (allocationPercent == null) return;
    const others = await this.prisma.salePhase.aggregate({
      where: {
        eventId,
        status: { not: SalePhaseStatus.CANCELLED },
        ...(excludePhaseId ? { id: { not: excludePhaseId } } : {}),
      },
      _sum: { allocationPercent: true },
    });
    const total = (others._sum.allocationPercent ?? 0) + allocationPercent;
    if (total > 100) {
      throw new BadRequestException(
        `La suma de cupos por fase no puede pasar de 100% (quedaría en ${total}%).`
      );
    }
  }

  async listSalePhases(eventId: string, orgId: string) {
    const event = await this.assertEventInOrg(eventId, orgId);
    const at = new Date();
    const rows = await this.prisma.salePhase.findMany({
      where: { eventId },
      orderBy: [{ startsAt: 'asc' }, { priority: 'asc' }],
    });

    // Se persiste aquí de forma síncrona —es una pantalla de backoffice, no el
    // camino caliente— pero lo que se devuelve se deriva igualmente del reloj:
    // si la escritura fallara, el operador seguiría viendo el estado correcto.
    await this.saleWindow.syncPhaseStatuses(eventId, rows, at).catch((error: Error) => {
      this.logger.warn(
        `No se pudo persistir el estado de las fases de ${eventId}: ${error.message}`
      );
    });

    const phases = await Promise.all(
      rows.map(async (phase) => ({
        ...withResolvedStatus(phase, at),
        // Cuánto lleva consumido el cupo: sin esto `allocationPercent` es una
        // promesa que el operador no puede vigilar hasta que ya se agotó.
        quota: await this.phaseQuotaUsage(eventId, phase, event.totalCapacity),
      }))
    );

    // La decisión vigente viaja con la lista: es lo que el panel necesita para
    // pintar "vendiendo ahora" sin recalcular la regla por su cuenta.
    const window = await this.saleWindow.checkSaleWindow(eventId);
    return { eventId, phases, window };
  }

  private async phaseQuotaUsage(
    eventId: string,
    phase: {
      id: string;
      name: string;
      startsAt: Date;
      endsAt: Date;
      allocationPercent: number | null;
    },
    capacity: number
  ): Promise<PhaseQuotaUsage | null> {
    if (phase.allocationPercent == null) return null;
    return this.phaseQuota.getUsage(
      {
        id: phase.id,
        eventId,
        name: phase.name,
        startsAt: phase.startsAt,
        endsAt: phase.endsAt,
        allocationPercent: phase.allocationPercent,
      },
      capacity
    );
  }

  async createSalePhase(eventId: string, orgId: string, input: SalePhaseInput) {
    const event = await this.assertEventInOrg(eventId, orgId);
    if (!input.name?.trim()) throw new BadRequestException('name es obligatorio');

    const { startsAt, endsAt, kind, code } = this.normalizeSalePhase(input, {
      eventStartsAt: event.startsAt,
    });
    await this.assertAllocationFits(eventId, input.allocationPercent);

    try {
      const phase = await this.prisma.salePhase.create({
        data: {
          eventId,
          name: input.name.trim(),
          kind,
          code: code ?? null,
          startsAt,
          endsAt,
          // Una fase creada con sus fechas ya en curso nace ACTIVE, no
          // SCHEDULED: nacer mintiendo es el mismo defecto que no avanzar.
          status:
            input.status ??
            resolvePhaseStatus({ status: SalePhaseStatus.SCHEDULED, startsAt, endsAt }),
          channels: input.channels ?? [],
          allocationPercent: input.allocationPercent ?? null,
          maxPerOrder: input.maxPerOrder ?? null,
          discountPercent: input.discountPercent ?? null,
          priority: input.priority ?? 100,
          notes: input.notes ?? null,
        },
      });
      this.logger.log(`Sale phase creada en ${eventId}: ${phase.name} (${phase.kind})`);
      return phase;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Ya existe una fase con ese nombre en el evento.');
      }
      throw error;
    }
  }

  async updateSalePhase(eventId: string, phaseId: string, orgId: string, patch: SalePhasePatch) {
    const event = await this.assertEventInOrg(eventId, orgId);
    const current = await this.prisma.salePhase.findFirst({ where: { id: phaseId, eventId } });
    if (!current) throw new NotFoundException('Sale phase not found');

    const { startsAt, endsAt, kind, code } = this.normalizeSalePhase(patch, {
      eventStartsAt: event.startsAt,
      current,
    });
    if (patch.allocationPercent !== undefined) {
      await this.assertAllocationFits(eventId, patch.allocationPercent, phaseId);
    }

    // Mover las fechas de una fase ya terminada tiene que revivirla. `ENDED` es
    // pegajoso (cerrar antes de hora es una decisión del promotor) y además
    // `checkSaleWindow` excluye esas fases por ESTADO, no por reloj: sin este
    // recálculo, alargar una fase la dejaría cerrada para siempre.
    const datesMoved =
      startsAt.getTime() !== current.startsAt.getTime() ||
      endsAt.getTime() !== current.endsAt.getTime();
    const rebornStatus =
      patch.status == null && datesMoved && current.status !== SalePhaseStatus.CANCELLED
        ? resolvePhaseStatus({ status: SalePhaseStatus.SCHEDULED, startsAt, endsAt })
        : null;

    return this.prisma.salePhase.update({
      where: { id: phaseId },
      data: {
        ...(patch.name != null ? { name: patch.name.trim() } : {}),
        kind,
        startsAt,
        endsAt,
        ...(code !== undefined ? { code } : {}),
        ...(patch.status != null ? { status: patch.status } : {}),
        ...(rebornStatus ? { status: rebornStatus } : {}),
        ...(patch.channels != null ? { channels: patch.channels } : {}),
        ...(patch.allocationPercent !== undefined
          ? { allocationPercent: patch.allocationPercent }
          : {}),
        ...(patch.maxPerOrder !== undefined ? { maxPerOrder: patch.maxPerOrder } : {}),
        ...(patch.discountPercent !== undefined ? { discountPercent: patch.discountPercent } : {}),
        ...(patch.priority != null ? { priority: patch.priority } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
    });
  }

  /**
   * Cancelar en vez de borrar cuando la fase ya abrió: hay órdenes que se
   * vendieron bajo sus condiciones y el reporte tiene que poder explicarlas.
   */
  async removeSalePhase(eventId: string, phaseId: string, orgId: string) {
    await this.assertEventInOrg(eventId, orgId);
    const phase = await this.prisma.salePhase.findFirst({ where: { id: phaseId, eventId } });
    if (!phase) throw new NotFoundException('Sale phase not found');

    if (phase.startsAt <= new Date()) {
      const cancelled = await this.prisma.salePhase.update({
        where: { id: phaseId },
        data: { status: SalePhaseStatus.CANCELLED },
      });
      return { deleted: false, cancelled: true, phase: cancelled };
    }

    await this.prisma.salePhase.delete({ where: { id: phaseId } });
    return { deleted: true, cancelled: false, phase };
  }

  async getEventHub(eventId: string, orgId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      include: {
        venue: { select: { id: true, name: true, slug: true } },
        offers: true,
        seatMap: true,
        salePhases: { orderBy: [{ startsAt: 'asc' }, { priority: 'asc' }] },
        _count: { select: { tickets: true, orders: true } },
      },
    });
    if (!event) throw new BadRequestException('Event not found');

    const sold = await this.prisma.ticket.count({
      where: { eventId, status: 'SOLD' },
    });
    const held = await this.prisma.ticket.count({
      where: { eventId, status: 'HELD' },
    });
    const blocked = await this.prisma.ticket.count({
      where: { eventId, status: 'BLOCKED' },
    });

    const channelOrders = await this.prisma.order.groupBy({
      by: ['channel'],
      where: { eventId, status: 'COMPLETED' },
      _sum: { totalAmount: true },
      _count: true,
    });

    // `checkSaleWindow` ya dispara la persistencia del estado; aquí basta con
    // derivarlo para que el hub no pinte una fase «programada» que ya vende.
    const saleWindow = await this.saleWindow.checkSaleWindow(eventId);
    const at = new Date();

    return {
      event: {
        ...event,
        salePhases: event.salePhases.map((phase) => withResolvedStatus(phase, at)),
      },
      inventory: {
        total: event.totalCapacity,
        sold,
        held,
        /** Retirado de la venta por bloqueo operativo (no caduca solo). */
        blocked,
        available: Math.max(0, event.totalCapacity - sold - held - blocked),
        occupancyPercent: event.totalCapacity ? Math.round((sold / event.totalCapacity) * 100) : 0,
      },
      channels: channelOrders,
      /** Ventana de venta vigente resuelta con las fases del evento. */
      saleWindow,
      metadata: event.metadata,
    };
  }
  // ==================== EDIT / DUPLICATE / SYNC CAPACITY (micro A) ====================

  /**
   * Actualiza el evento por sección. Políticas extra (tope %, fechas límite) viven
   * en metadata.eventPolicies hasta que exista la migración dedicada.
   */
  async updateEvent(
    orgId: string,
    eventId: string,
    patch: {
      title?: string;
      description?: string | null;
      imageUrl?: string | null;
      bannerImageUrl?: string | null;
      startDate?: Date | string;
      endDate?: Date | string | null;
      doorsAt?: Date | string | null;
      venueId?: string;
      category?: string;
      rating?: string | null;
      salesStartAt?: Date | string | null;
      salesEndAt?: Date | string | null;
      totalCapacity?: number;
      allowResale?: boolean;
      transferAllowed?: boolean;
      refundable?: boolean;
      policies?: {
        resaleMaxPercent?: number | null;
        resaleDeadline?: string | null;
        refundDeadline?: string | null;
        transferDeadline?: string | null;
      };
      capacityExplanation?: string | null;
    }
  ) {
    if (!orgId) throw new BadRequestException('Tu usuario no tiene organización');
    const current = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
    });
    if (!current) throw new NotFoundException('Evento no encontrado');

    const startsAt = patch.startDate !== undefined ? new Date(patch.startDate) : current.startsAt;
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('La fecha de inicio no es válida.');
    }

    const endsAt =
      patch.endDate === undefined
        ? current.endsAt
        : patch.endDate === null || patch.endDate === ''
          ? null
          : new Date(patch.endDate);
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('La fecha de fin no es válida.');
    }
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException('El fin es anterior o igual al inicio.');
    }

    const doorsAt =
      patch.doorsAt === undefined
        ? current.doorsAt
        : patch.doorsAt === null || patch.doorsAt === ''
          ? null
          : new Date(patch.doorsAt);
    if (doorsAt && Number.isNaN(doorsAt.getTime())) {
      throw new BadRequestException('La hora de puertas no es válida.');
    }

    const salesStartAt =
      patch.salesStartAt === undefined
        ? current.salesStartAt
        : patch.salesStartAt === null || patch.salesStartAt === ''
          ? null
          : new Date(patch.salesStartAt);
    const salesEndAt =
      patch.salesEndAt === undefined
        ? current.salesEndAt
        : patch.salesEndAt === null || patch.salesEndAt === ''
          ? null
          : new Date(patch.salesEndAt);
    if (salesStartAt && Number.isNaN(salesStartAt.getTime())) {
      throw new BadRequestException('La apertura de venta no es válida.');
    }
    if (salesEndAt && Number.isNaN(salesEndAt.getTime())) {
      throw new BadRequestException('El cierre de venta no es válido.');
    }
    if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
      throw new BadRequestException('La venta no puede cerrar antes de abrir');
    }
    if (salesEndAt && salesEndAt > startsAt) {
      throw new BadRequestException(
        'La venta no puede cerrar después de que empiece el evento; usa una fase de venta en puerta'
      );
    }

    if (patch.totalCapacity !== undefined) {
      if (!Number.isInteger(patch.totalCapacity) || patch.totalCapacity <= 0) {
        throw new BadRequestException('El cupo tiene que ser mayor que cero.');
      }
    }

    if (patch.venueId) {
      const venue = await this.prisma.venue.findFirst({
        where: { id: patch.venueId, organizationId: orgId },
        select: { id: true },
      });
      if (!venue) throw new BadRequestException('El recinto no pertenece a tu organización.');
    }

    const categories = Object.values(EventCategory) as string[];
    if (patch.category !== undefined && !categories.includes(patch.category)) {
      throw new BadRequestException('Categoría no válida.');
    }

    const meta = { ...((current.metadata as EventMetadata) ?? {}) };
    if (patch.policies) {
      const prev =
        meta.eventPolicies && typeof meta.eventPolicies === 'object'
          ? (meta.eventPolicies as Record<string, unknown>)
          : {};
      meta.eventPolicies = { ...prev, ...patch.policies };
    }
    if (patch.capacityExplanation !== undefined) {
      const text =
        typeof patch.capacityExplanation === 'string' ? patch.capacityExplanation.trim() : '';
      if (text === '') {
        delete meta.capacityExplanation;
      } else if (text.length < 20) {
        throw new BadRequestException('La explicación del cupo necesita al menos 20 caracteres.');
      } else {
        meta.capacityExplanation = text;
      }
    }

    const data: Prisma.EventUpdateInput = {
      metadata: meta as Prisma.InputJsonValue,
    };
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length < 3)
        throw new BadRequestException('El título necesita al menos 3 caracteres.');
      data.title = title;
    }
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.imageUrl !== undefined) data.image = patch.imageUrl?.trim() || null;
    if (patch.bannerImageUrl !== undefined) {
      data.bannerImage = patch.bannerImageUrl?.trim() || null;
    }
    if (patch.startDate !== undefined) data.startsAt = startsAt;
    if (patch.endDate !== undefined) data.endsAt = endsAt;
    if (patch.doorsAt !== undefined) data.doorsAt = doorsAt;
    if (patch.venueId !== undefined) {
      data.venue = { connect: { id: patch.venueId } };
    }
    if (patch.category !== undefined) data.category = patch.category as EventCategory;
    if (patch.rating !== undefined) data.rating = patch.rating;
    if (patch.salesStartAt !== undefined) data.salesStartAt = salesStartAt;
    if (patch.salesEndAt !== undefined) data.salesEndAt = salesEndAt;
    if (patch.totalCapacity !== undefined) data.totalCapacity = patch.totalCapacity;
    if (patch.allowResale !== undefined) data.allowResale = patch.allowResale;
    if (patch.transferAllowed !== undefined) data.transferAllowed = patch.transferAllowed;
    if (patch.refundable !== undefined) data.refundable = patch.refundable;

    return this.prisma.event.update({
      where: { id: eventId },
      data,
      include: { venue: true, offers: true, salePhases: true },
    });
  }

  /**
   * Clona el evento a un borrador con fecha nueva: zonas (offers), fases y políticas.
   * No copia boletos ni mapa publicado.
   */
  async duplicateEvent(
    orgId: string,
    eventId: string,
    data: { startDate: Date | string; title?: string; doorsAt?: Date | string | null }
  ) {
    if (!orgId) throw new BadRequestException('Tu usuario no tiene organización');
    const source = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      include: { offers: true, salePhases: true },
    });
    if (!source) throw new NotFoundException('Evento no encontrado');

    const newStart = new Date(data.startDate);
    if (Number.isNaN(newStart.getTime())) {
      throw new BadRequestException('La nueva fecha de inicio no es válida.');
    }
    const deltaMs = newStart.getTime() - source.startsAt.getTime();
    const shift = (d: Date | null | undefined) => (d ? new Date(d.getTime() + deltaMs) : null);

    const title = (data.title?.trim() || `${source.title} (copia)`).trim();
    if (title.length < 3)
      throw new BadRequestException('El título necesita al menos 3 caracteres.');

    const doorsAt =
      data.doorsAt !== undefined
        ? data.doorsAt
          ? new Date(data.doorsAt)
          : null
        : shift(source.doorsAt);

    const meta = { ...((source.metadata as EventMetadata) ?? {}) };
    meta.clonedFrom = source.id;
    delete meta.capacityExplanation;

    const cloned = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          title,
          description: source.description,
          slug: this.slugify(title),
          organizationId: orgId,
          venueId: source.venueId,
          startsAt: newStart,
          endsAt: shift(source.endsAt) ?? undefined,
          doorsAt: doorsAt ?? undefined,
          salesStartAt: shift(source.salesStartAt),
          salesEndAt: shift(source.salesEndAt),
          timezone: source.timezone,
          status: EventStatus.DRAFT,
          image: source.image,
          bannerImage: source.bannerImage,
          category: source.category,
          genre: source.genre,
          rating: source.rating,
          totalCapacity: source.totalCapacity,
          currency: source.currency,
          minPrice: source.minPrice,
          maxPrice: source.maxPrice,
          allowResale: source.allowResale,
          transferAllowed: source.transferAllowed,
          refundable: source.refundable,
          nonTransferable: source.nonTransferable,
          holdExpiration: source.holdExpiration,
          enableDynamic: source.enableDynamic,
          surgeThreshold: source.surgeThreshold,
          surgePriceMultiplier: source.surgePriceMultiplier,
          metadata: meta as Prisma.InputJsonValue,
        },
      });

      for (const offer of source.offers) {
        await tx.offer.create({
          data: {
            eventId: created.id,
            name: offer.name,
            zone: offer.zone,
            description: offer.description,
            basePrice: offer.basePrice,
            fees: offer.fees,
            currency: offer.currency,
            totalQuantity: offer.totalQuantity,
            remainingQuantity: offer.totalQuantity,
            soldQuantity: 0,
            holdQuantity: 0,
            minPerOrder: offer.minPerOrder,
            maxPerOrder: offer.maxPerOrder,
            minAge: offer.minAge,
            restrictedCards: offer.restrictedCards,
            startDate: shift(offer.startDate) ?? newStart,
            endDate: shift(offer.endDate) ?? newStart,
            isAvailable: offer.isAvailable,
          },
        });
      }

      for (const phase of source.salePhases) {
        if (phase.status === SalePhaseStatus.CANCELLED) continue;
        await tx.salePhase.create({
          data: {
            eventId: created.id,
            name: phase.name,
            kind: phase.kind,
            code: phase.code,
            startsAt: shift(phase.startsAt) ?? newStart,
            endsAt: shift(phase.endsAt) ?? newStart,
            status: SalePhaseStatus.SCHEDULED,
            channels: phase.channels,
            allocationPercent: phase.allocationPercent,
            maxPerOrder: phase.maxPerOrder,
            discountPercent: phase.discountPercent,
            priority: phase.priority,
            notes: phase.notes,
          },
        });
      }

      return created;
    });

    this.logger.log(`Event duplicated: ${source.id} → ${cloned.id}`);
    return this.prisma.event.findFirst({
      where: { id: cloned.id },
      include: { venue: true, offers: true, salePhases: true },
    });
  }

  /** Iguala totalCapacity a las butacas del mapa activo del recinto. */
  async syncCapacityFromMap(orgId: string, eventId: string) {
    if (!orgId) throw new BadRequestException('Tu usuario no tiene organización');
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: { id: true, venueId: true, metadata: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const mapSeats = await this.prisma.seat.count({
      where: {
        section: { layout: { venueId: event.venueId, isActive: true } },
      },
    });
    if (mapSeats <= 0) {
      throw new BadRequestException(
        'El recinto no tiene butacas en el mapa activo. Completa el plano antes de igualar el cupo.'
      );
    }

    const meta = { ...((event.metadata as EventMetadata) ?? {}) };
    delete meta.capacityExplanation;

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        totalCapacity: mapSeats,
        metadata: meta as Prisma.InputJsonValue,
      },
      select: { id: true, totalCapacity: true },
    });

    return { ...updated, mapSeats, synced: true };
  }
}
