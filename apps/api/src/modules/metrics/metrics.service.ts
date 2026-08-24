import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  AccessAttendanceMetrics,
  CampaignFunnelMetrics,
  EventSalesPaceMetrics,
  ExecutiveSummaryMetrics,
  FraudSignalsMetrics,
  InventoryMetrics,
  MetricsAlert,
  MetricsAlertsResponse,
  MetricsGranularity,
  MetricsTimeSeriesResponse,
  OrdersPaymentsMetrics,
  ResaleMetrics,
  SettlementsMetrics,
  WaitlistMetrics,
} from '@boletera/shared';
import { EventStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  METRICS_TIMEZONE,
  aggregateTimeSeries,
  buildBreakdown,
  buildKpi,
  parseMetricsRange,
  sumOrderRevenue,
} from './metrics.helpers';

type RangeParams = {
  organizationId: string;
  from?: string;
  to?: string;
  eventId?: string;
};

const COMPLETED: OrderStatus = 'COMPLETED';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  private orderWhere(orgId: string, range: { from: Date; to: Date }, eventId?: string): Prisma.OrderWhereInput {
    return {
      organizationId: orgId,
      ...(eventId ? { eventId } : {}),
      createdAt: { gte: range.from, lte: range.to },
    };
  }

  private async orgCommissionRate(orgId: string): Promise<number> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { commissionRate: true },
    });
    return Number(org?.commissionRate ?? 0);
  }

  private async completedOrders(orgId: string, from: Date, to: Date, eventId?: string) {
    return this.prisma.order.findMany({
      where: { ...this.orderWhere(orgId, { from, to }, eventId), status: COMPLETED },
      select: {
        totalAmount: true,
        channel: true,
        completedAt: true,
        createdAt: true,
        items: { select: { quantity: true } },
      },
    });
  }

  async executive(params: RangeParams): Promise<ExecutiveSummaryMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const [current, previous, commissionRate] = await Promise.all([
      this.completedOrders(params.organizationId, range.from, range.to, params.eventId),
      this.completedOrders(params.organizationId, range.comparisonFrom, range.comparisonTo, params.eventId),
      this.orgCommissionRate(params.organizationId),
    ]);

    const cur = sumOrderRevenue(current);
    const prev = sumOrderRevenue(previous);
    const netCur = cur.revenue * (1 - commissionRate);
    const netPrev = prev.revenue * (1 - commissionRate);
    const avgCur = cur.tickets > 0 ? cur.revenue / cur.tickets : 0;
    const avgPrev = prev.tickets > 0 ? prev.revenue / prev.tickets : 0;

    const [completedCur, completedPrev, failedCur] = await Promise.all([
      this.prisma.order.count({
        where: { ...this.orderWhere(params.organizationId, range, params.eventId), status: COMPLETED },
      }),
      this.prisma.order.count({
        where: {
          ...this.orderWhere(params.organizationId, {
            from: range.comparisonFrom,
            to: range.comparisonTo,
          }, params.eventId),
          status: COMPLETED,
        },
      }),
      this.prisma.order.count({
        where: { ...this.orderWhere(params.organizationId, range, params.eventId), status: 'FAILED' },
      }),
    ]);
    const conversionCur =
      completedCur + failedCur > 0 ? completedCur / (completedCur + failedCur) : 0;
    const conversionPrev = completedPrev > 0 ? completedPrev / (completedPrev + 1) : 0;

    const channelMap = new Map<string, number>();
    for (const order of current) {
      channelMap.set(order.channel, (channelMap.get(order.channel) ?? 0) + Number(order.totalAmount));
    }

    const revenueSeries = aggregateTimeSeries(
      current.map((o) => ({
        at: o.completedAt ?? o.createdAt,
        value: Number(o.totalAmount),
      })),
      range.daysInPeriod <= 2 ? 'hour' : range.daysInPeriod <= 31 ? 'day' : 'week',
      'revenue',
      'Ingresos',
      'mxn',
    );

    const paceFactor = range.daysElapsed / range.daysInPeriod;

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      comparisonRange: range.comparisonRange,
      currency: 'MXN',
      timezone: METRICS_TIMEZONE,
      kpis: {
        grossRevenue: buildKpi('grossRevenue', 'Ingresos brutos', cur.revenue, prev.revenue, 'mxn'),
        netRevenue: buildKpi('netRevenue', 'Ingresos netos', netCur, netPrev, 'mxn'),
        ticketsSold: buildKpi('ticketsSold', 'Boletos vendidos', cur.tickets, prev.tickets, 'count'),
        averageTicketPrice: buildKpi('averageTicketPrice', 'Ticket promedio', avgCur, avgPrev, 'mxn'),
        conversionRate: buildKpi(
          'conversionRate',
          'Tasa de conversión',
          Number((conversionCur * 100).toFixed(2)),
          Number((conversionPrev * 100).toFixed(2)),
          'percent',
        ),
        ordersCompleted: buildKpi(
          'ordersCompleted',
          'Órdenes completadas',
          completedCur,
          completedPrev,
          'count',
        ),
      },
      revenueByChannel: buildBreakdown(
        'channel',
        'Ingresos por canal',
        Array.from(channelMap.entries()).map(([key, value]) => ({
          key,
          label: key,
          value,
        })),
      ),
      projection: {
        projectedGrossRevenue: paceFactor > 0 ? cur.revenue / paceFactor : cur.revenue,
        projectedTicketsSold: paceFactor > 0 ? Math.round(cur.tickets / paceFactor) : cur.tickets,
        method: 'linear_pace',
        daysElapsed: range.daysElapsed,
        daysInPeriod: range.daysInPeriod,
      },
      series: [revenueSeries],
      generatedAt: new Date().toISOString(),
    };
  }

  async salesPace(params: RangeParams): Promise<EventSalesPaceMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const now = new Date();
    const events = await this.prisma.event.findMany({
      where: {
        organizationId: params.organizationId,
        status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE, EventStatus.COMPLETED] },
        startsAt: { gte: range.from },
      },
      include: {
        offers: { select: { totalQuantity: true, remainingQuantity: true } },
        orders: {
          where: { status: COMPLETED },
          select: { totalAmount: true, items: { select: { quantity: true } } },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 50,
    });

    const rows = events.map((event) => {
      const totalCapacity = event.offers.reduce((sum, o) => sum + o.totalQuantity, 0);
      const remainingCapacity = event.offers.reduce((sum, o) => sum + o.remainingQuantity, 0);
      const ticketsSold = Math.max(0, totalCapacity - remainingCapacity);
      const grossRevenue = event.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
      const daysUntilEvent = Math.max(
        0,
        Math.ceil((event.startsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const salesWindowDays = Math.max(
        1,
        Math.ceil((event.startsAt.getTime() - event.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const elapsedDays = Math.max(0, salesWindowDays - daysUntilEvent);
      const actualPace = totalCapacity > 0 ? ticketsSold / totalCapacity : 0;
      const expectedPace = salesWindowDays > 0 ? elapsedDays / salesWindowDays : 0;
      const paceDelta = actualPace - expectedPace;
      const occupancyPercent = totalCapacity > 0 ? (ticketsSold / totalCapacity) * 100 : 0;

      let riskLevel: EventSalesPaceMetrics['events'][number]['riskLevel'] = 'on_track';
      if (paceDelta < -0.25) riskLevel = 'critical';
      else if (paceDelta < -0.15) riskLevel = 'at_risk';
      else if (paceDelta < -0.05) riskLevel = 'watch';

      return {
        eventId: event.id,
        title: event.title,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        daysUntilEvent,
        totalCapacity,
        ticketsSold,
        occupancyPercent: Number(occupancyPercent.toFixed(2)),
        remainingCapacity,
        grossRevenue,
        actualPace: Number(actualPace.toFixed(4)),
        expectedPace: Number(expectedPace.toFixed(4)),
        paceDelta: Number(paceDelta.toFixed(4)),
        riskLevel,
      };
    });

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      events: rows,
      atRisk: rows.filter((r) => r.riskLevel === 'at_risk' || r.riskLevel === 'critical'),
      topPerformers: [...rows].sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5),
      generatedAt: new Date().toISOString(),
    };
  }

  async inventory(params: RangeParams): Promise<InventoryMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const offers = await this.prisma.offer.findMany({
      where: {
        event: {
          organizationId: params.organizationId,
          ...(params.eventId ? { id: params.eventId } : {}),
        },
      },
      include: {
        event: { select: { id: true, title: true, createdAt: true } },
      },
    });

    let totalCapacity = 0;
    let available = 0;
    let held = 0;
    let sold = 0;

    const byZone = offers.map((offer) => {
      const soldQuantity = offer.totalQuantity - offer.remainingQuantity;
      totalCapacity += offer.totalQuantity;
      available += offer.remainingQuantity;
      held += offer.holdQuantity;
      sold += soldQuantity;
      const daysSince = Math.max(
        1,
        (Date.now() - offer.event.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      const velocity = soldQuantity / daysSince;
      const daysToSellOut =
        velocity > 0 && offer.remainingQuantity > 0
          ? Math.ceil(offer.remainingQuantity / velocity)
          : null;

      return {
        eventId: offer.event.id,
        eventTitle: offer.event.title,
        offerId: offer.id,
        zone: offer.zone,
        tierName: offer.name,
        totalQuantity: offer.totalQuantity,
        remainingQuantity: offer.remainingQuantity,
        soldQuantity,
        holdQuantity: offer.holdQuantity,
        availabilityPercent:
          offer.totalQuantity > 0
            ? Number(((offer.remainingQuantity / offer.totalQuantity) * 100).toFixed(2))
            : 0,
        sellThroughVelocity: Number(velocity.toFixed(2)),
        daysToSellOut,
      };
    });

    const activeHolds = await this.prisma.seatHold.count({
      where: {
        expiresAt: { gt: new Date() },
        status: 'ACTIVE',
        event: { organizationId: params.organizationId },
      },
    });

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      summary: {
        totalCapacity,
        available,
        held,
        sold,
        blocked: 0,
        activeHolds,
      },
      byZone,
      statusBreakdown: buildBreakdown('status', 'Estado del inventario', [
        { key: 'available', label: 'Disponible', value: available },
        { key: 'held', label: 'En hold', value: held },
        { key: 'sold', label: 'Vendido', value: sold },
      ]),
      generatedAt: new Date().toISOString(),
    };
  }

  async orders(params: RangeParams): Promise<OrdersPaymentsMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const base = this.orderWhere(params.organizationId, range, params.eventId);
    const prevBase = this.orderWhere(
      params.organizationId,
      { from: range.comparisonFrom, to: range.comparisonTo },
      params.eventId,
    );

    const [statusGroups, completedCur, completedPrev, refunds, grossCur, grossPrev, paidOrders] =
      await Promise.all([
        this.prisma.order.groupBy({
          by: ['status'],
          where: base,
          _count: true,
        }),
        this.prisma.order.count({ where: { ...base, status: COMPLETED } }),
        this.prisma.order.count({ where: { ...prevBase, status: COMPLETED } }),
        this.prisma.refund.count({
          where: {
            requestedAt: { gte: range.from, lte: range.to },
            order: { organizationId: params.organizationId },
          },
        }),
        this.completedOrders(params.organizationId, range.from, range.to, params.eventId),
        this.completedOrders(
          params.organizationId,
          range.comparisonFrom,
          range.comparisonTo,
          params.eventId,
        ),
        this.prisma.order.findMany({
          where: { ...base, status: COMPLETED, paymentId: { not: null } },
          select: { payment: { select: { method: true } } },
        }),
      ]);

    const methodMap = new Map<string, number>();
    for (const row of paidOrders) {
      const method = row.payment?.method ?? 'UNKNOWN';
      methodMap.set(method, (methodMap.get(method) ?? 0) + 1);
    }

    const grossCurrent = sumOrderRevenue(grossCur).revenue;
    const grossPrevious = sumOrderRevenue(grossPrev).revenue;
    const totalOrders = statusGroups.reduce((sum, g) => sum + g._count, 0);
    const approvalRate = totalOrders > 0 ? completedCur / totalOrders : 0;

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      comparisonRange: range.comparisonRange,
      volumeByStatus: buildBreakdown(
        'status',
        'Órdenes por estado',
        statusGroups.map((g) => ({ key: g.status, label: g.status, value: g._count })),
      ),
      paymentMethodBreakdown: buildBreakdown(
        'method',
        'Métodos de pago',
        Array.from(methodMap.entries()).map(([key, value]) => ({
          key,
          label: key,
          value,
        })),
      ),
      kpis: {
        approvalRate: buildKpi(
          'approvalRate',
          'Tasa de aprobación',
          Number((approvalRate * 100).toFixed(2)),
          Number((approvalRate * 100).toFixed(2)),
          'percent',
        ),
        refundRate: buildKpi(
          'refundRate',
          'Reembolsos',
          refunds,
          0,
          'count',
        ),
        chargebackCount: buildKpi('chargebackCount', 'Contracargos', 0, 0, 'count'),
        completedOrders: buildKpi('completedOrders', 'Completadas', completedCur, completedPrev, 'count'),
        grossRevenue: buildKpi('grossRevenue', 'Ingresos', grossCurrent, grossPrevious, 'mxn'),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async access(params: RangeParams): Promise<AccessAttendanceMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const eventFilter: Prisma.TicketScanWhereInput = {
      scannedAt: { gte: range.from, lte: range.to },
      ticket: {
        event: {
          organizationId: params.organizationId,
          ...(params.eventId ? { id: params.eventId } : {}),
        },
      },
    };

    const [scans, ticketsSold] = await Promise.all([
      this.prisma.ticketScan.findMany({
        where: eventFilter,
        select: { scannedAt: true, success: true, zoneId: true, zone: { select: { name: true } } },
      }),
      this.prisma.ticket.count({
        where: {
          event: {
            organizationId: params.organizationId,
            ...(params.eventId ? { id: params.eventId } : {}),
          },
          status: 'SOLD',
        },
      }),
    ]);

    const ticketsCheckedIn = scans.filter((s) => s.success).length;
    const checkInByHour = aggregateTimeSeries(
      scans.filter((s) => s.success).map((s) => ({ at: s.scannedAt, value: 1 })),
      range.daysInPeriod <= 2 ? 'hour' : 'day',
      'checkins',
      'Check-ins',
      'count',
    );

    const zoneMap = new Map<string, number>();
    for (const scan of scans.filter((s) => s.success)) {
      const key = scan.zone?.name ?? scan.zoneId ?? 'general';
      zoneMap.set(key, (zoneMap.get(key) ?? 0) + 1);
    }

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      eventId: params.eventId,
      checkInByHour,
      noShowRate:
        ticketsSold > 0
          ? Number((((ticketsSold - ticketsCheckedIn) / ticketsSold) * 100).toFixed(2))
          : 0,
      ticketsSold,
      ticketsCheckedIn,
      ticketsNoShow: Math.max(0, ticketsSold - ticketsCheckedIn),
      trafficByAccessPoint: buildBreakdown(
        'zone',
        'Tráfico por punto de acceso',
        Array.from(zoneMap.entries()).map(([key, value]) => ({ key, label: key, value })),
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  async resale(params: RangeParams): Promise<ResaleMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const listings = await this.prisma.resaleListing.findMany({
      where: {
        listedAt: { gte: range.from, lte: range.to },
        ticket: { event: { organizationId: params.organizationId } },
      },
      select: { status: true, askingPrice: true, fee: true, listedAt: true, soldAt: true },
    });

    const active = listings.filter((l) => l.status === 'ACTIVE').length;
    const sold = listings.filter((l) => l.status === 'SOLD');
    const cancelled = listings.filter((l) => l.status === 'CANCELLED' || l.status === 'DELISTED');
    const grossGmv = sold.reduce((sum, l) => sum + Number(l.askingPrice), 0);
    const platformFees = sold.reduce((sum, l) => sum + Number(l.fee), 0);

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      summary: {
        activeListings: active,
        soldListings: sold.length,
        cancelledListings: cancelled.length,
        grossGmv,
        platformFees,
        averageAskingPrice:
          listings.length > 0
            ? listings.reduce((s, l) => s + Number(l.askingPrice), 0) / listings.length
            : 0,
        averageSoldPrice: sold.length > 0 ? grossGmv / sold.length : 0,
      },
      statusBreakdown: buildBreakdown('status', 'Estado de reventa', [
        { key: 'ACTIVE', label: 'Activos', value: active },
        { key: 'SOLD', label: 'Vendidos', value: sold.length },
        { key: 'CANCELLED', label: 'Cancelados', value: cancelled.length },
      ]),
      series: [
        aggregateTimeSeries(
          sold.map((l) => ({ at: l.soldAt ?? l.listedAt, value: Number(l.askingPrice) })),
          'day',
          'gmv',
          'GMV reventa',
          'mxn',
        ),
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  async waitlist(params: RangeParams): Promise<WaitlistMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        event: { organizationId: params.organizationId },
      },
      include: { event: { select: { title: true } } },
    });

    const summary = {
      pending: entries.filter((e) => e.status === 'PENDING').length,
      notified: entries.filter((e) => e.status === 'NOTIFIED').length,
      converted: entries.filter((e) => e.status === 'CONVERTED').length,
      expired: entries.filter((e) => e.status === 'EXPIRED').length,
      cancelled: entries.filter((e) => e.status === 'CANCELLED').length,
      conversionRate: 0,
    };
    const total = entries.length;
    summary.conversionRate =
      total > 0 ? Number(((summary.converted / total) * 100).toFixed(2)) : 0;

    const eventMap = new Map<string, { label: string; value: number }>();
    for (const entry of entries) {
      const row = eventMap.get(entry.eventId) ?? { label: entry.event.title, value: 0 };
      row.value += 1;
      eventMap.set(entry.eventId, row);
    }

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      summary,
      byEvent: Array.from(eventMap.entries()).map(([key, row]) => ({
        key,
        label: row.label,
        value: row.value,
      })),
      funnel: {
        key: 'waitlist',
        label: 'Embudo lista de espera',
        stages: [
          { key: 'pending', label: 'Pendientes', count: summary.pending, conversionFromPrevious: null, conversionFromTop: 100 },
          { key: 'notified', label: 'Notificados', count: summary.notified, conversionFromPrevious: summary.pending > 0 ? summary.notified / summary.pending : 0, conversionFromTop: total > 0 ? (summary.notified / total) * 100 : 0 },
          { key: 'converted', label: 'Convertidos', count: summary.converted, conversionFromPrevious: summary.notified > 0 ? summary.converted / summary.notified : 0, conversionFromTop: total > 0 ? (summary.converted / total) * 100 : 0 },
        ],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async campaigns(params: RangeParams): Promise<CampaignFunnelMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const promotions = await this.prisma.promotion.findMany({
      where: {
        organizationId: params.organizationId,
        createdAt: { lte: range.to },
      },
      include: {
        orders: {
          where: { status: COMPLETED, createdAt: { gte: range.from, lte: range.to } },
          select: { totalAmount: true, discountAmount: true },
        },
      },
    });

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      promotions: promotions.map((promo) => {
        const ordersAttributed = promo.orders.length;
        const revenueAttributed = promo.orders.reduce((s, o) => s + Number(o.totalAmount), 0);
        const discountGiven = promo.orders.reduce((s, o) => s + Number(o.discountAmount ?? 0), 0);
        const usageCount = promo.usageCount ?? ordersAttributed;
        const conversionRate = promo.usageLimit
          ? (usageCount / promo.usageLimit) * 100
          : ordersAttributed > 0
            ? 100
            : 0;
        let performance: 'strong' | 'average' | 'poor' = 'average';
        if (conversionRate >= 50) performance = 'strong';
        else if (conversionRate < 10) performance = 'poor';

        return {
          promotionId: promo.id,
          code: promo.code,
          name: promo.name,
          usageCount,
          usageLimit: promo.usageLimit,
          ordersAttributed,
          revenueAttributed,
          discountGiven,
          conversionRate: Number(conversionRate.toFixed(2)),
          performance,
        };
      }),
      funnel: {
        key: 'campaigns',
        label: 'Embudo promocional',
        stages: [
          { key: 'active', label: 'Promociones activas', count: promotions.length, conversionFromPrevious: null, conversionFromTop: 100 },
          { key: 'used', label: 'Con uso', count: promotions.filter((p) => p.usageCount > 0).length, conversionFromPrevious: null, conversionFromTop: 0 },
        ],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async fraud(params: RangeParams): Promise<FraudSignalsMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const flags = await this.prisma.fraudFlag.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        OR: [
          { event: { organizationId: params.organizationId } },
          { order: { organizationId: params.organizationId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const byType = new Map<string, number>();
    const bySeverity = new Map<string, number>();
    for (const flag of flags) {
      byType.set(flag.type, (byType.get(flag.type) ?? 0) + 1);
      bySeverity.set(flag.severity, (bySeverity.get(flag.severity) ?? 0) + 1);
    }

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      summary: {
        totalFlags: flags.length,
        openFlags: flags.filter((f) => f.status === 'FLAGGED' || f.status === 'INVESTIGATING').length,
        criticalFlags: flags.filter((f) => f.severity === 'CRITICAL').length,
        averageRiskScore:
          flags.length > 0
            ? flags.reduce((s, f) => s + Number(f.score ?? 0), 0) / flags.length
            : 0,
        resolvedFlags: flags.filter((f) => f.status === 'RESOLVED').length,
        falsePositives: flags.filter((f) => f.status === 'FALSE_POSITIVE').length,
      },
      byType: buildBreakdown(
        'type',
        'Por tipo',
        Array.from(byType.entries()).map(([key, value]) => ({ key, label: key, value })),
      ),
      bySeverity: buildBreakdown(
        'severity',
        'Por severidad',
        Array.from(bySeverity.entries()).map(([key, value]) => ({ key, label: key, value })),
      ),
      recentSignals: flags.slice(0, 20).map((f) => ({
        id: f.id,
        type: f.type,
        severity: f.severity,
        score: Number(f.score ?? 0),
        reason: f.reason,
        status: f.status,
        orderId: f.orderId,
        eventId: f.eventId,
        createdAt: f.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async settlements(params: RangeParams): Promise<SettlementsMetrics> {
    const range = parseMetricsRange(params.from, params.to);
    const [orders, refunds, payouts] = await Promise.all([
      this.completedOrders(params.organizationId, range.from, range.to, params.eventId),
      this.prisma.refund.findMany({
        where: {
          status: 'COMPLETED',
          processedAt: { gte: range.from, lte: range.to },
          order: { organizationId: params.organizationId },
        },
        select: { amount: true },
      }),
      this.prisma.promoterPayout.findMany({
        where: {
          organizationId: params.organizationId,
          periodStart: { gte: range.from },
          periodEnd: { lte: range.to },
        },
      }),
    ]);

    const grossRevenue = sumOrderRevenue(orders).revenue;
    const refundTotal = refunds.reduce((s, r) => s + Number(r.amount), 0);
    const commissionRate = await this.orgCommissionRate(params.organizationId);
    const commission = grossRevenue * commissionRate;
    const netPayable = grossRevenue - refundTotal - commission;

    const eventMap = new Map<string, number>();
    const orderRows = await this.prisma.order.findMany({
      where: { ...this.orderWhere(params.organizationId, range, params.eventId), status: COMPLETED },
      select: { totalAmount: true, event: { select: { id: true, title: true } } },
    });
    for (const order of orderRows) {
      eventMap.set(
        order.event.id,
        (eventMap.get(order.event.id) ?? 0) + Number(order.totalAmount),
      );
    }

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      summary: {
        grossRevenue,
        refunds: refundTotal,
        commission,
        netPayable,
        pendingPayouts: payouts.filter((p) => p.status === 'PENDING').length,
        completedPayouts: payouts.filter((p) => p.status === 'COMPLETED').length,
      },
      payouts: payouts.map((p) => ({
        id: p.id,
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        grossRevenue: Number(p.grossRevenue),
        commission: Number(p.commission),
        netAmount: Number(p.netAmount),
        status: p.status,
        referenceId: p.referenceId,
        processedAt: p.processedAt?.toISOString() ?? null,
      })),
      byEvent: Array.from(eventMap.entries()).map(([key, value]) => {
        const title = orderRows.find((o) => o.event.id === key)?.event.title ?? key;
        return { key, label: title, value };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  async timeseries(params: RangeParams & {
    granularity: MetricsGranularity;
    metric: 'revenue' | 'orders' | 'tickets' | 'refunds' | 'checkins';
  }): Promise<MetricsTimeSeriesResponse> {
    const range = parseMetricsRange(params.from, params.to);

    if (params.metric === 'checkins') {
      const scans = await this.prisma.ticketScan.findMany({
        where: {
          scannedAt: { gte: range.from, lte: range.to },
          success: true,
          ticket: { event: { organizationId: params.organizationId } },
        },
        select: { scannedAt: true },
      });
      return {
        organizationId: params.organizationId,
        dateRange: range.dateRange,
        granularity: params.granularity,
        metric: params.metric,
        series: [
          aggregateTimeSeries(
            scans.map((s) => ({ at: s.scannedAt, value: 1 })),
            params.granularity,
            'checkins',
            'Check-ins',
            'count',
          ),
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    if (params.metric === 'refunds') {
      const refunds = await this.prisma.refund.findMany({
        where: {
          requestedAt: { gte: range.from, lte: range.to },
          order: { organizationId: params.organizationId },
        },
        select: { requestedAt: true, amount: true },
      });
      return {
        organizationId: params.organizationId,
        dateRange: range.dateRange,
        granularity: params.granularity,
        metric: params.metric,
        series: [
          aggregateTimeSeries(
            refunds.map((r) => ({ at: r.requestedAt, value: Number(r.amount) })),
            params.granularity,
            'refunds',
            'Reembolsos',
            'mxn',
          ),
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    const orders = await this.prisma.order.findMany({
      where: {
        ...this.orderWhere(params.organizationId, range, params.eventId),
        ...(params.metric === 'orders' ? {} : { status: COMPLETED }),
      },
      select: {
        totalAmount: true,
        createdAt: true,
        completedAt: true,
        items: { select: { quantity: true } },
      },
    });

    const entries =
      params.metric === 'revenue'
        ? orders.map((o) => ({
            at: o.completedAt ?? o.createdAt,
            value: Number(o.totalAmount),
          }))
        : params.metric === 'tickets'
          ? orders.flatMap((o) =>
              Array.from({ length: o.items.reduce((s, i) => s + i.quantity, 0) }, () => ({
                at: o.completedAt ?? o.createdAt,
                value: 1,
              })),
            )
          : orders.map((o) => ({ at: o.createdAt, value: 1 }));

    const unit = params.metric === 'revenue' ? 'mxn' : 'count';
    const label =
      params.metric === 'revenue'
        ? 'Ingresos'
        : params.metric === 'tickets'
          ? 'Boletos'
          : 'Órdenes';

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      granularity: params.granularity,
      metric: params.metric,
      series: [
        aggregateTimeSeries(entries, params.granularity, params.metric, label, unit),
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  async alerts(params: RangeParams): Promise<MetricsAlertsResponse> {
    const range = parseMetricsRange(params.from, params.to);
    const pace = await this.salesPace(params);
    const inventory = await this.inventory(params);

    const alerts: MetricsAlert[] = [];

    for (const event of pace.atRisk.slice(0, 5)) {
      alerts.push({
        id: `pace-${event.eventId}`,
        domain: 'events',
        severity: event.riskLevel === 'critical' ? 'critical' : 'warning',
        title: `Ritmo de venta bajo — ${event.title}`,
        explanation: `El evento va ${Math.abs(event.paceDelta * 100).toFixed(0)}% por debajo del ritmo esperado.`,
        suggestedAction: 'Revisa precios, campañas o abre un canal adicional.',
        entityType: 'event',
        entityId: event.eventId,
        entityLabel: event.title,
        metricValue: event.actualPace,
        threshold: event.expectedPace,
        detectedAt: new Date().toISOString(),
      });
    }

    for (const zone of inventory.byZone.filter((z) => z.availabilityPercent < 10).slice(0, 3)) {
      alerts.push({
        id: `inv-${zone.offerId}`,
        domain: 'inventory',
        severity: zone.availabilityPercent < 5 ? 'critical' : 'warning',
        title: `Inventario bajo — ${zone.tierName}`,
        explanation: `Quedan ${zone.remainingQuantity} de ${zone.totalQuantity} en ${zone.eventTitle}.`,
        suggestedAction: 'Evalúa liberar holds o abrir inventario adicional.',
        entityType: 'offer',
        entityId: zone.offerId,
        entityLabel: zone.tierName,
        metricValue: zone.remainingQuantity,
        threshold: zone.totalQuantity * 0.1,
        detectedAt: new Date().toISOString(),
      });
    }

    const countsBySeverity = alerts.reduce(
      (acc, alert) => {
        acc[alert.severity] += 1;
        return acc;
      },
      { info: 0, warning: 0, critical: 0 },
    );

    return {
      organizationId: params.organizationId,
      dateRange: range.dateRange,
      alerts,
      countsBySeverity,
      generatedAt: new Date().toISOString(),
    };
  }

  resolveOrganizationId(
    scopedOrgId: string | null | undefined,
    userOrgId: string | null | undefined,
    queryOrgId?: string,
  ): string {
    const orgId = scopedOrgId ?? queryOrgId ?? userOrgId;
    if (!orgId) throw new BadRequestException('organizationId is required');
    return orgId;
  }
}
