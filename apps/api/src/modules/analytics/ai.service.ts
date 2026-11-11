import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FraudStatus, OrderStatus, Prisma, RefundStatus } from '@prisma/client';
import type {
  AiAnomaliesResponse,
  AiAnomalyMetric,
  AiAnomalyPoint,
  AiExecutiveNarrativeResponse,
  AiFraudRiskResponse,
  AiMethodMeta,
  AiRecommendationsResponse,
  AiSalesForecastResponse,
  AiSegmentationResponse,
  MetricsDateRange,
} from '@boletera/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_REASONS,
  AI_TIMEZONE,
  ANOMALY_WINDOW,
  DEFAULT_Z_THRESHOLD,
  aggregateSales,
  anomalySufficiency,
  buildExecutiveNarrative,
  buildRecommendations,
  dailySeries,
  dayKeysBetween,
  detectAnomalies,
  forecastEvent,
  fraudSummary,
  scoreFraudSubjects,
  segmentCustomers,
  type CustomerHistory,
  type FlagRow,
  type RefundRow,
  type SaleRow,
  type UpcomingEventSignal,
} from './ai-insights';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

/** Órdenes que cuentan como venta: completadas, aunque luego se reembolsaran en parte. */
const SOLD_STATUSES: OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED];
const OPEN_FLAG_STATUSES: FraudStatus[] = [FraudStatus.FLAGGED, FraudStatus.INVESTIGATING];
const SUPPORTED_ANOMALY_METRICS: AiAnomalyMetric[] = [
  'tickets_sold',
  'gross_revenue',
  'refund_amount',
];

/** Respuesta del contrato + motivo de vacío cuando no hay fuente real. */
type WithReason<T> = T & { reason?: string };

export interface AiQuery {
  from?: string;
  to?: string;
  eventId?: string;
  limit?: string | number;
  metric?: string;
  zThreshold?: string | number;
}

interface Range {
  from: Date;
  to: Date;
}

const METHODS = {
  narrative: {
    id: 'plantilla_kpis_v1',
    name: 'Plantilla sobre KPIs',
    rationale:
      'Texto armado con plantillas fijas a partir de órdenes completadas, boletos y reembolsos del periodo contra el periodo anterior de igual duración. Sin modelo de lenguaje.',
  },
  anomalies: {
    id: 'zscore_media_movil_7d',
    name: 'Puntaje z contra media móvil de 7 días',
    rationale:
      'Cada día se compara con la media y desviación de los 7 días previos (zona America/Mexico_City). Días con base plana no se evalúan. Aprobación de pagos y accesos no se calculan aquí.',
  },
  fraud: {
    id: 'fraud_flags_max',
    name: 'Señales de fraude registradas',
    rationale:
      'Agrupa las señales abiertas (FLAGGED/INVESTIGATING) por orden o usuario; el puntaje es el de la señal más alta y la banda usa los umbrales de FraudService (50/75/90).',
  },
  segmentation: {
    id: 'rfm_reglas_fijas',
    name: 'RFM por reglas fijas',
    rationale:
      'Clientes con órdenes completadas en el periodo; recencia, frecuencia y monto sobre todo su historial hasta el fin del periodo. Sin modelo de abandono: la probabilidad queda sin dato.',
  },
  forecast: {
    id: 'ritmo_lineal_14d',
    name: 'Ritmo lineal',
    rationale:
      'Recta de mínimos cuadrados sobre el acumulado diario de boletos (últimos 14 días con historial) extendida hasta la fecha del evento, intervalo del 80 % recortado al aforo. Sin eventos comparables.',
  },
  recommendations: {
    id: 'reglas_operativas_v1',
    name: 'Reglas operativas',
    rationale:
      'Reglas fijas sobre pronóstico de ritmo, anomalías alerta/crítica y señales de fraude alto/crítico. El impacto no se estima.',
  },
} satisfies Record<string, AiMethodMeta>;

/**
 * Motor determinista detrás de `/ai/*`. Todas las consultas filtran por la
 * organización resuelta por `OrgAccessGuard`.
 */
@Injectable()
export class AiService {
  constructor(private prisma: PrismaService) {}

  // ==================== Utilidades de entrada ====================

  parseRange(query: AiQuery, now = new Date()): Range {
    const to = query.to ? new Date(query.to) : now;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) {
      throw new BadRequestException('Fechas inválidas: usa ISO-8601 en from y to.');
    }
    if (from > to) throw new BadRequestException('El inicio del periodo es posterior al fin.');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(`El periodo no puede pasar de ${MAX_RANGE_DAYS} días.`);
    }
    return { from, to };
  }

  private parseLimit(value: AiQuery['limit'], fallback: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.floor(n), max);
  }

  private requireOrg(organizationId: string | null | undefined): string {
    if (!organizationId) {
      throw new BadRequestException('Indica organizationId: la IA trabaja por organización.');
    }
    return organizationId;
  }

  /** 404 si el evento no es de la organización (no revela eventos ajenos). */
  private async assertEvent(organizationId: string, eventId?: string) {
    if (!eventId) return null;
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true, title: true, startsAt: true, totalCapacity: true, createdAt: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    return event;
  }

  private dateRange(range: Range): MetricsDateRange {
    return { from: range.from.toISOString(), to: range.to.toISOString() };
  }

  // ==================== Lecturas ====================

  private async loadSales(
    organizationId: string,
    range: Range,
    eventId?: string
  ): Promise<SaleRow[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: { in: SOLD_STATUSES },
        ...(eventId ? { eventId } : {}),
        OR: [
          { completedAt: { gte: range.from, lte: range.to } },
          { completedAt: null, createdAt: { gte: range.from, lte: range.to } },
        ],
      },
      select: {
        id: true,
        eventId: true,
        userId: true,
        buyerEmail: true,
        channel: true,
        totalAmount: true,
        completedAt: true,
        createdAt: true,
        event: { select: { title: true } },
        items: { select: { quantity: true } },
      },
    });
    return orders.map((o) => ({
      orderId: o.id,
      eventId: o.eventId,
      eventTitle: o.event?.title ?? o.eventId,
      userId: o.userId,
      email: o.buyerEmail,
      channel: String(o.channel),
      amount: Number(o.totalAmount),
      tickets: o.items.reduce((sum, item) => sum + item.quantity, 0),
      soldAt: o.completedAt ?? o.createdAt,
    }));
  }

  private async loadRefunds(
    organizationId: string,
    range: Range,
    eventId?: string
  ): Promise<RefundRow[]> {
    const refunds = await this.prisma.refund.findMany({
      where: {
        status: RefundStatus.COMPLETED,
        processedAt: { gte: range.from, lte: range.to },
        order: { organizationId, ...(eventId ? { eventId } : {}) },
      },
      select: { amount: true, processedAt: true },
    });
    return refunds.map((r) => ({ amount: Number(r.amount), processedAt: r.processedAt as Date }));
  }

  private async loadOpenFlags(
    organizationId: string,
    range: Range,
    eventId?: string
  ): Promise<FlagRow[]> {
    const where: Prisma.FraudFlagWhereInput = {
      status: { in: OPEN_FLAG_STATUSES },
      createdAt: { gte: range.from, lte: range.to },
      // Mismo criterio de inquilino que FraudService: por evento o por orden.
      OR: [{ event: { organizationId } }, { order: { organizationId } }],
      ...(eventId ? { AND: [{ OR: [{ eventId }, { order: { eventId } }] }] } : {}),
    };
    const flags = await this.prisma.fraudFlag.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        type: true,
        severity: true,
        score: true,
        reason: true,
        orderId: true,
        userId: true,
        eventId: true,
      },
    });
    return flags.map((f) => ({ ...f, type: String(f.type), severity: String(f.severity) }));
  }

  // ==================== Endpoints ====================

  async executiveSummary(
    orgId: string | null,
    query: AiQuery
  ): Promise<WithReason<AiExecutiveNarrativeResponse>> {
    const organizationId = this.requireOrg(orgId);
    await this.assertEvent(organizationId, query.eventId);
    const range = this.parseRange(query);
    const span = range.to.getTime() - range.from.getTime();
    const previous: Range = {
      from: new Date(range.from.getTime() - span),
      to: new Date(range.from.getTime() - 1),
    };

    const [sales, prevSales, refunds, prevRefunds, flags] = await Promise.all([
      this.loadSales(organizationId, range, query.eventId),
      this.loadSales(organizationId, previous, query.eventId),
      this.loadRefunds(organizationId, range, query.eventId),
      this.loadRefunds(organizationId, previous, query.eventId),
      this.loadOpenFlags(organizationId, range, query.eventId),
    ]);
    const out = buildExecutiveNarrative(
      aggregateSales(sales, refunds),
      aggregateSales(prevSales, prevRefunds),
      {
        openFraudFlags: flags.length,
      }
    );
    return {
      organizationId,
      dateRange: this.dateRange(range),
      comparisonRange: this.dateRange(previous),
      language: 'es-MX',
      timezone: AI_TIMEZONE,
      currency: 'MXN',
      method: METHODS.narrative,
      narrative: out.narrative,
      highlights: out.highlights,
      watchouts: out.watchouts,
      kpisCited: out.kpisCited,
      generatedAt: new Date().toISOString(),
      ...(out.reason ? { reason: out.reason } : {}),
    };
  }

  private async computeAnomalies(organizationId: string, range: Range, query: AiQuery) {
    const threshold = Number(query.zThreshold);
    const zThreshold =
      Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_Z_THRESHOLD;
    const metrics = query.metric
      ? SUPPORTED_ANOMALY_METRICS.filter((m) => m === query.metric)
      : SUPPORTED_ANOMALY_METRICS;
    // La base de los primeros días del periodo son los 7 días anteriores.
    const extended: Range = {
      from: new Date(range.from.getTime() - ANOMALY_WINDOW * DAY_MS),
      to: range.to,
    };
    const [sales, refunds] = await Promise.all([
      this.loadSales(organizationId, extended, query.eventId),
      this.loadRefunds(organizationId, extended, query.eventId),
    ]);
    const evalDays = dayKeysBetween(range.from, range.to);
    const firstEval = evalDays[0];
    const allDays = dayKeysBetween(extended.from, range.to);
    const startIndex = Math.max(0, allDays.indexOf(firstEval) - ANOMALY_WINDOW);
    const days = allDays.slice(startIndex);

    const anomalies: AiAnomalyPoint[] = [];
    let evaluated = 0;
    for (const metric of metrics) {
      const series =
        metric === 'refund_amount'
          ? dailySeries(refunds, days, (r) => ({ at: r.processedAt, value: r.amount }))
          : dailySeries(sales, days, (s) => ({
              at: s.soldAt,
              value: metric === 'tickets_sold' ? s.tickets : s.amount,
            }));
      const result = detectAnomalies(metric, series, zThreshold);
      anomalies.push(...result.anomalies);
      evaluated += result.evaluated;
    }
    const inRange = sales.filter((s) => s.soldAt >= range.from).length;
    let reason: string | undefined;
    if (sales.length === 0 && refunds.length === 0) reason = AI_REASONS.noSales;
    else if (evaluated === 0) reason = AI_REASONS.noBaseline;
    return { anomalies, evaluated, zThreshold, sampleSize: inRange, reason, metrics };
  }

  async anomalies(orgId: string | null, query: AiQuery): Promise<WithReason<AiAnomaliesResponse>> {
    const organizationId = this.requireOrg(orgId);
    await this.assertEvent(organizationId, query.eventId);
    const range = this.parseRange(query);
    const result = await this.computeAnomalies(organizationId, range, query);
    return {
      organizationId,
      dateRange: this.dateRange(range),
      method: METHODS.anomalies,
      zThreshold: result.zThreshold,
      anomalies: result.anomalies,
      baselineWindows: result.evaluated,
      sufficiency: anomalySufficiency(result.evaluated),
      sampleSize: result.sampleSize,
      generatedAt: new Date().toISOString(),
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }

  async fraudRisk(orgId: string | null, query: AiQuery): Promise<WithReason<AiFraudRiskResponse>> {
    const organizationId = this.requireOrg(orgId);
    await this.assertEvent(organizationId, query.eventId);
    const range = this.parseRange(query);
    const limit = this.parseLimit(query.limit, 50, 200);
    const all = scoreFraudSubjects(await this.loadOpenFlags(organizationId, range, query.eventId));
    return {
      organizationId,
      dateRange: this.dateRange(range),
      method: METHODS.fraud,
      scores: all.slice(0, limit),
      summary: fraudSummary(all),
      generatedAt: new Date().toISOString(),
      ...(all.length === 0 ? { reason: AI_REASONS.noFlags } : {}),
    };
  }

  async segmentation(
    orgId: string | null,
    query: AiQuery
  ): Promise<WithReason<AiSegmentationResponse>> {
    const organizationId = this.requireOrg(orgId);
    await this.assertEvent(organizationId, query.eventId);
    const range = this.parseRange(query);
    const limit = this.parseLimit(query.limit, 100, 500);

    const inRange = await this.loadSales(organizationId, range, query.eventId);
    const userIds = [...new Set(inRange.map((s) => s.userId))];
    const history = userIds.length
      ? await this.prisma.order.findMany({
          where: {
            organizationId,
            userId: { in: userIds },
            status: { in: SOLD_STATUSES },
            ...(query.eventId ? { eventId: query.eventId } : {}),
            OR: [
              { completedAt: { lte: range.to } },
              { completedAt: null, createdAt: { lte: range.to } },
            ],
          },
          select: {
            userId: true,
            buyerEmail: true,
            totalAmount: true,
            completedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const byUser = new Map<string, CustomerHistory>();
    for (const o of history) {
      const c = byUser.get(o.userId) ?? { userId: o.userId, email: o.buyerEmail, orders: [] };
      c.email = o.buyerEmail; // el más reciente gana
      c.orders.push({ amount: Number(o.totalAmount), soldAt: o.completedAt ?? o.createdAt });
      byUser.set(o.userId, c);
    }
    const { rows, segments, sufficiency } = segmentCustomers([...byUser.values()], range.to);
    return {
      organizationId,
      dateRange: this.dateRange(range),
      method: METHODS.segmentation,
      sufficiency,
      sampleSize: rows.length,
      segments,
      customers: rows.slice(0, limit),
      generatedAt: new Date().toISOString(),
      ...(rows.length === 0 ? { reason: AI_REASONS.noCustomers } : {}),
    };
  }

  /** Serie diaria de boletos del evento desde la primera venta hasta hoy (o su inicio). */
  private async eventPace(eventId: string, startsAt: Date, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: { eventId, status: { in: SOLD_STATUSES } },
      select: {
        totalAmount: true,
        completedAt: true,
        createdAt: true,
        items: { select: { quantity: true } },
      },
    });
    const rows = orders.map((o) => ({
      at: o.completedAt ?? o.createdAt,
      tickets: o.items.reduce((s, i) => s + i.quantity, 0),
      amount: Number(o.totalAmount),
    }));
    const revenue = rows.reduce((s, r) => s + r.amount, 0);
    if (rows.length === 0) return { daily: [], revenue: 0, orders: 0 };
    const first = new Date(Math.min(...rows.map((r) => r.at.getTime())));
    const end = startsAt < now ? startsAt : now;
    const days = dayKeysBetween(first, end > first ? end : first);
    return {
      daily: dailySeries(rows, days, (r) => ({ at: r.at, value: r.tickets })),
      revenue,
      orders: rows.length,
    };
  }

  private daysUntil(startsAt: Date, now: Date): number {
    return Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / DAY_MS));
  }

  async forecast(
    orgId: string | null,
    eventId: string
  ): Promise<WithReason<AiSalesForecastResponse>> {
    const organizationId = this.requireOrg(orgId);
    const event = await this.assertEvent(organizationId, eventId);
    const now = new Date();
    const pace = await this.eventPace(event.id, event.startsAt, now);
    const daysUntilEvent = this.daysUntil(event.startsAt, now);
    const lineItemsMissing = pace.orders > 0 && pace.daily.every((d) => d.value === 0);
    const out = forecastEvent({
      capacity: event.totalCapacity,
      daily: pace.daily,
      revenue: pace.revenue,
      daysUntilEvent,
    });
    return {
      organizationId,
      eventId: event.id,
      eventTitle: event.title,
      startsAt: event.startsAt.toISOString(),
      daysUntilEvent,
      totalCapacity: event.totalCapacity,
      ticketsSold: out.ticketsSold,
      grossRevenue: Math.round(pace.revenue * 100) / 100,
      occupancyPercent:
        event.totalCapacity > 0
          ? Math.round((out.ticketsSold / event.totalCapacity) * 1000) / 10
          : 0,
      currency: 'MXN',
      timezone: AI_TIMEZONE,
      method: {
        ...METHODS.forecast,
        rationale: `${METHODS.forecast.rationale} ${
          lineItemsMissing
            ? 'Hay órdenes completadas sin partidas de boletos: el ritmo en boletos no se puede medir.'
            : out.rationale
        }`,
      },
      projectedTicketsSold: out.projectedTickets,
      projectedOccupancyPercent: out.projectedOccupancy,
      projectedGrossRevenue: out.projectedRevenue,
      comparables: [],
      observedPace: out.observedPace,
      generatedAt: now.toISOString(),
      ...(out.reason ? { reason: lineItemsMissing ? AI_REASONS.noLineItems : out.reason } : {}),
    };
  }

  async recommendations(
    orgId: string | null,
    query: AiQuery
  ): Promise<WithReason<AiRecommendationsResponse>> {
    const organizationId = this.requireOrg(orgId);
    await this.assertEvent(organizationId, query.eventId);
    const range = this.parseRange(query);
    const limit = this.parseLimit(query.limit, 25, 100);
    const now = new Date();

    // Eventos próximos (90 días) en venta; máx. 20 para acotar consultas.
    const upcoming = await this.prisma.event.findMany({
      where: {
        organizationId,
        ...(query.eventId ? { id: query.eventId } : {}),
        status: { in: ['SCHEDULED', 'LIVE'] },
        startsAt: { gt: now, lte: new Date(now.getTime() + 90 * DAY_MS) },
      },
      select: { id: true, title: true, startsAt: true, totalCapacity: true },
      orderBy: { startsAt: 'asc' },
      take: 20,
    });
    const events: UpcomingEventSignal[] = [];
    for (const ev of upcoming) {
      const pace = await this.eventPace(ev.id, ev.startsAt, now);
      // Órdenes sin partidas de boletos: no hay ritmo medible y tampoco es
      // «sin ventas»; el evento no entra a las reglas.
      if (pace.orders > 0 && pace.daily.every((d) => d.value === 0)) continue;
      const daysUntilEvent = this.daysUntil(ev.startsAt, now);
      const f = forecastEvent({
        capacity: ev.totalCapacity,
        daily: pace.daily,
        revenue: pace.revenue,
        daysUntilEvent,
      });
      events.push({
        eventId: ev.id,
        title: ev.title,
        daysUntilEvent,
        capacity: ev.totalCapacity,
        ticketsSold: f.ticketsSold,
        projectedOccupancy: f.projectedOccupancy.point,
        sufficiency: f.projectedOccupancy.sufficiency,
        confidence: f.projectedOccupancy.level,
        sampleSize: f.projectedOccupancy.sampleSize,
      });
    }
    const [anom, flags] = await Promise.all([
      this.computeAnomalies(organizationId, range, { ...query, metric: undefined }),
      this.loadOpenFlags(organizationId, range, query.eventId),
    ]);
    const recs = buildRecommendations({
      events,
      anomalies: anom.anomalies,
      fraud: scoreFraudSubjects(flags),
    });
    return {
      organizationId,
      dateRange: this.dateRange(range),
      method: METHODS.recommendations,
      recommendations: recs.slice(0, limit),
      generatedAt: now.toISOString(),
      ...(recs.length === 0 ? { reason: AI_REASONS.noRecommendations } : {}),
    };
  }
}
