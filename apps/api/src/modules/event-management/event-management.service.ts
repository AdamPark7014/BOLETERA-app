import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventStatus,
  Prisma,
  SalePhaseKind,
  SalePhaseStatus,
  SalesChannel,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { SaleWindowService } from './sale-window.service';

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

@Injectable()
export class EventManagementService {
  private logger = new Logger(EventManagementService.name);

  constructor(
    private prisma: PrismaService,
    private saleWindow: SaleWindowService,
  ) {}

  private slugify(text: string) {
    return `${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;
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
      imageUrl?: string;
      timezone?: string;
    },
  ) {
    const event = await this.prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        slug: this.slugify(data.title),
        organizationId: orgId,
        venueId: data.venueId,
        startsAt: new Date(data.startDate),
        endsAt: data.endDate ? new Date(data.endDate) : undefined,
        timezone: data.timezone ?? 'America/Mexico_City',
        status: EventStatus.DRAFT,
        image: data.imageUrl,
        totalCapacity: data.capacity,
        minPrice: new Decimal(data.basePrice),
        maxPrice: new Decimal(data.basePrice * 2.5),
        metadata: {
          eventKind: data.type,
          basePrice: data.basePrice,
          createdFrom: 'admin_panel',
        },
      },
      include: { venue: true, organization: true },
    });

    this.logger.log(`Event created: ${event.id} (${event.title})`);
    return event;
  }

  async createEventSeries(
    orgId: string,
    data: {
      seriesName: string;
      description: string;
      venueId: string;
      occurrences: Array<{
        date: Date;
        title?: string;
        capacity?: number;
        basePrice?: number;
      }>;
    },
  ) {
    const occurrences = [];

    for (let i = 0; i < data.occurrences.length; i++) {
      const occ = data.occurrences[i];
      const basePrice = occ.basePrice ?? 100;
      const event = await this.prisma.event.create({
        data: {
          title: occ.title || data.seriesName,
          description: data.description,
          slug: this.slugify(`${data.seriesName}-${occ.date.toISOString()}`),
          organizationId: orgId,
          venueId: data.venueId,
          startsAt: new Date(occ.date),
          timezone: 'America/Mexico_City',
          status: EventStatus.SCHEDULED,
          totalCapacity: occ.capacity ?? 5000,
          minPrice: new Decimal(basePrice),
          maxPrice: new Decimal(basePrice * 2.5),
          metadata: {
            eventKind: 'series',
            seriesName: data.seriesName,
            seriesOrder: i + 1,
          },
        },
      });
      occurrences.push(event);
    }

    this.logger.log(`Event series created: ${data.seriesName} (${occurrences.length})`);
    return { seriesName: data.seriesName, occurrences, totalEvents: occurrences.length };
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
    },
  ) {
    const events = [];
    let currentDate = new Date(data.startDate);
    const dayInMs = 24 * 60 * 60 * 1000;
    let created = 0;

    while (created < data.occurrenceCount) {
      if (data.exceptions?.some((d) => d.toDateString() === currentDate.toDateString())) {
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
      else if (data.frequency === 'weekly') currentDate = new Date(currentDate.getTime() + 7 * dayInMs);
      else if (data.frequency === 'biweekly') currentDate = new Date(currentDate.getTime() + 14 * dayInMs);
      else currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return { name: data.name, frequency: data.frequency, events };
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
    },
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
    data: { basePrice?: number; name?: string; isAvailable?: boolean },
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
    },
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
    },
  ) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');

    const presaleCode =
      data.type === 'presale' ? data.code || `PRESALE${Math.random().toString(36).substring(2, 8).toUpperCase()}` : data.code;

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

  async getEventCalendar(orgId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const events = await this.prisma.event.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: startDate, lte: endDate },
      },
      orderBy: { startsAt: 'asc' },
      include: { venue: true },
    });

    const calendar: Record<string, unknown[]> = {};
    events.forEach((event) => {
      const d = event.startsAt;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!calendar[dateKey]) calendar[dateKey] = [];
      calendar[dateKey].push({
        id: event.id,
        title: event.title,
        startTime: event.startsAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        venue: event.venue.name,
        capacity: event.totalCapacity,
        status: event.status,
        kind: (event.metadata as EventMetadata)?.eventKind ?? 'single',
      });
    });

    return { month, year, calendar, totalEvents: events.length };
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
    },
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
      return events.filter(
        (e) => (e.metadata as EventMetadata)?.eventKind === filters.type,
      );
    }
    return events;
  }

  // ==================== VENTANA DE VENTA (SalePhase) ====================

  /** El evento debe existir y ser del tenant que pide. */
  private async assertEventInOrg(eventId: string, orgId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: { id: true, title: true, startsAt: true, organizationId: true },
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
    context: { eventStartsAt: Date; current?: { startsAt: Date; endsAt: Date; kind: SalePhaseKind } },
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
        'La venta no puede cerrar después de que empiece el evento (solo la fase DOOR puede).',
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
    excludePhaseId?: string,
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
        `La suma de cupos por fase no puede pasar de 100% (quedaría en ${total}%).`,
      );
    }
  }

  async listSalePhases(eventId: string, orgId: string) {
    await this.assertEventInOrg(eventId, orgId);
    const phases = await this.prisma.salePhase.findMany({
      where: { eventId },
      orderBy: [{ startsAt: 'asc' }, { priority: 'asc' }],
    });
    // La decisión vigente viaja con la lista: es lo que el panel necesita para
    // pintar "vendiendo ahora" sin recalcular la regla por su cuenta.
    const window = await this.saleWindow.checkSaleWindow(eventId);
    return { eventId, phases, window };
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
          status: input.status ?? SalePhaseStatus.SCHEDULED,
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Ya existe una fase con ese nombre en el evento.');
      }
      throw error;
    }
  }

  async updateSalePhase(
    eventId: string,
    phaseId: string,
    orgId: string,
    patch: SalePhasePatch,
  ) {
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

    return this.prisma.salePhase.update({
      where: { id: phaseId },
      data: {
        ...(patch.name != null ? { name: patch.name.trim() } : {}),
        kind,
        startsAt,
        endsAt,
        ...(code !== undefined ? { code } : {}),
        ...(patch.status != null ? { status: patch.status } : {}),
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

    const saleWindow = await this.saleWindow.checkSaleWindow(eventId);

    return {
      event,
      inventory: {
        total: event.totalCapacity,
        sold,
        held,
        /** Retirado de la venta por bloqueo operativo (no caduca solo). */
        blocked,
        available: Math.max(0, event.totalCapacity - sold - held - blocked),
        occupancyPercent: event.totalCapacity
          ? Math.round((sold / event.totalCapacity) * 100)
          : 0,
      },
      channels: channelOrders,
      /** Ventana de venta vigente resuelta con las fases del evento. */
      saleWindow,
      metadata: event.metadata,
    };
  }
}


