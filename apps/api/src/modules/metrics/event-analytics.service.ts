import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { METRICS_TIMEZONE, parseMetricsRange } from './metrics.helpers';
import type {
  AnalyticsMeta,
  AnalyticsSalesGoal,
  AnalyticsTrackingLink,
  BreakdownRow,
  EventAnalyticsPayload,
  SeriesPoint,
} from './event-analytics.types';

const VISIT_TTL_SEC = 90 * 24 * 60 * 60;
const COMPLETED: OrderStatus = 'COMPLETED';

export function readAnalyticsMeta(metadata: unknown): AnalyticsMeta {
  const root = (metadata ?? {}) as Record<string, unknown>;
  const analytics = (root.analytics ?? {}) as Record<string, unknown>;
  const rawGoal = analytics.salesGoal as AnalyticsSalesGoal | undefined;
  const rawLinks = analytics.trackingLinks;
  const salesGoal =
    rawGoal && typeof rawGoal === 'object'
      ? {
          ...(typeof rawGoal.tickets === 'number' && Number.isFinite(rawGoal.tickets)
            ? { tickets: rawGoal.tickets }
            : {}),
          ...(typeof rawGoal.revenue === 'number' && Number.isFinite(rawGoal.revenue)
            ? { revenue: rawGoal.revenue }
            : {}),
        }
      : undefined;
  const trackingLinks = Array.isArray(rawLinks)
    ? (rawLinks as AnalyticsTrackingLink[]).filter(
        (l) => l && typeof l.code === 'string' && typeof l.label === 'string'
      )
    : undefined;
  return {
    ...(salesGoal && Object.keys(salesGoal).length ? { salesGoal } : {}),
    ...(trackingLinks ? { trackingLinks } : {}),
  };
}

/** Minuto en zona México: YYYY-MM-DDTHH:MM */
export function bucketKeyMinute(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: METRICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function bucketKeyHour(date: Date): string {
  return `${bucketKeyMinute(date).slice(0, 13)}:00`;
}

function bucketKeyDay(date: Date): string {
  return bucketKeyMinute(date).slice(0, 10);
}

export function aggregateBuckets(
  entries: { at: Date; revenue: number; tickets: number }[],
  mode: 'minute' | 'hour' | 'day'
): SeriesPoint[] {
  const keyFn =
    mode === 'minute' ? bucketKeyMinute : mode === 'hour' ? bucketKeyHour : bucketKeyDay;
  const map = new Map<string, { revenue: number; tickets: number }>();
  for (const e of entries) {
    const key = keyFn(e.at);
    const cur = map.get(key) ?? { revenue: 0, tickets: 0 };
    cur.revenue += e.revenue;
    cur.tickets += e.tickets;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, revenue: v.revenue, tickets: v.tickets }));
}

export function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    WEB: 'Web',
    TAQUILLA: 'Taquilla',
    RESALE: 'Reventa',
    AFFILIATE: 'Enlace',
    MOBILE: 'App',
    API: 'API',
    ADMIN: 'Admin',
    PROMOTER: 'Promotor',
    COURTESY: 'Cortesía',
    CORPORATE: 'Corporativo',
    PHONE: 'Teléfono',
    INVITATION: 'Invitación',
    VIP: 'VIP',
  };
  return map[channel] ?? channel;
}

export function paymentLabel(method: string): string {
  const map: Record<string, string> = {
    CARD: 'Tarjeta',
    OXXO: 'OXXO',
    SPEI: 'SPEI',
    BANK_TRANSFER: 'SPEI',
    CASH: 'Efectivo',
    CRYPTO: 'Cripto',
    PAYPAL: 'PayPal',
  };
  return map[method] ?? method;
}

function visitsKey(eventId: string) {
  return `analytics:visits:${eventId}`;
}

@Injectable()
export class EventAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  private async loadEvent(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true, title: true, metadata: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('No encontramos este evento');
    return event;
  }

  private async resolveEventId(params: { eventId?: string; slug?: string }): Promise<string> {
    if (params.eventId?.trim()) return params.eventId.trim();
    if (!params.slug?.trim()) {
      throw new BadRequestException('Indica el evento o su enlace');
    }
    const event = await this.prisma.event.findUnique({
      where: { slug: params.slug.trim() },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('No encontramos este evento');
    return event.id;
  }

  async recordVisit(params: {
    eventId?: string;
    slug?: string;
  }): Promise<{ eventId: string; visits: number }> {
    const eventId = await this.resolveEventId(params);
    const visits = (await this.redis.incrementWithTtl(visitsKey(eventId), 1, VISIT_TTL_SEC)) ?? 0;
    return { eventId, visits };
  }

  async getVisitCount(eventId: string): Promise<number> {
    const raw = await this.redis.get(visitsKey(eventId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  async getEventAnalytics(params: {
    organizationId: string;
    eventId: string;
    from?: string;
    to?: string;
  }): Promise<EventAnalyticsPayload> {
    const event = await this.loadEvent(params.organizationId, params.eventId);
    const range = parseMetricsRange(params.from, params.to);

    const [orders, holds, visits] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          eventId: event.id,
          organizationId: params.organizationId,
          createdAt: { gte: range.from, lte: range.to },
        },
        select: {
          status: true,
          channel: true,
          paymentMethod: true,
          totalAmount: true,
          createdAt: true,
          completedAt: true,
          items: {
            select: {
              quantity: true,
              offer: { select: { zone: true, name: true } },
            },
          },
        },
      }),
      this.prisma.seatHold.count({
        where: {
          eventId: event.id,
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      this.getVisitCount(event.id),
    ]);

    const paid = orders.filter((o) => o.status === COMPLETED);
    const seriesEntries = paid.map((o) => ({
      at: o.completedAt ?? o.createdAt,
      revenue: Number(o.totalAmount),
      tickets: o.items.reduce((s, i) => s + i.quantity, 0),
    }));

    const ticketsSold = seriesEntries.reduce((s, e) => s + e.tickets, 0);
    const revenue = seriesEntries.reduce((s, e) => s + e.revenue, 0);
    const meta = readAnalyticsMeta(event.metadata);
    const ticketsTarget =
      typeof meta.salesGoal?.tickets === 'number' ? meta.salesGoal.tickets : null;
    const revenueTarget =
      typeof meta.salesGoal?.revenue === 'number' ? meta.salesGoal.revenue : null;

    return {
      eventId: event.id,
      title: event.title,
      range: range.dateRange,
      series: {
        minute: aggregateBuckets(seriesEntries, 'minute'),
        hour: aggregateBuckets(seriesEntries, 'hour'),
        day: aggregateBuckets(seriesEntries, 'day'),
      },
      funnel: {
        visits,
        holds,
        orders: orders.length,
        paid: paid.length,
      },
      goal: {
        ticketsTarget,
        revenueTarget,
        ticketsSold,
        revenue,
        ticketsProgress:
          ticketsTarget && ticketsTarget > 0 ? Math.min(1, ticketsSold / ticketsTarget) : 0,
        revenueProgress:
          revenueTarget && revenueTarget > 0 ? Math.min(1, revenue / revenueTarget) : 0,
      },
      byChannel: this.breakdown(paid, (o) => o.channel, channelLabel),
      byPaymentMethod: this.breakdown(paid, (o) => String(o.paymentMethod), paymentLabel),
      byZone: this.breakdownByZone(paid),
    };
  }

  private breakdown(
    orders: {
      channel: string;
      paymentMethod: string;
      totalAmount: unknown;
      items: { quantity: number; offer: { zone: string; name: string } | null }[];
    }[],
    keyFn: (o: { channel: string; paymentMethod: string }) => string,
    labelFn: (key: string) => string
  ): BreakdownRow[] {
    const map = new Map<string, BreakdownRow>();
    for (const o of orders) {
      const key = keyFn(o);
      const row = map.get(key) ?? {
        key,
        label: labelFn(key),
        orders: 0,
        tickets: 0,
        revenue: 0,
      };
      row.orders += 1;
      row.tickets += o.items.reduce((s, i) => s + i.quantity, 0);
      row.revenue += Number(o.totalAmount);
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }

  private breakdownByZone(
    orders: {
      totalAmount: unknown;
      items: { quantity: number; offer: { zone: string; name: string } | null }[];
    }[]
  ): BreakdownRow[] {
    const map = new Map<string, BreakdownRow>();
    for (const o of orders) {
      const revenue = Number(o.totalAmount);
      const totalQty = o.items.reduce((s, i) => s + i.quantity, 0) || 1;
      for (const item of o.items) {
        const key = item.offer?.zone || item.offer?.name || 'sin-zona';
        const label = item.offer?.zone || item.offer?.name || 'Sin zona';
        const row = map.get(key) ?? { key, label, orders: 0, tickets: 0, revenue: 0 };
        row.tickets += item.quantity;
        row.revenue += revenue * (item.quantity / totalQty);
        map.set(key, row);
      }
      // Una orden cuenta una vez por zona distinta
      const zones = new Set(o.items.map((i) => i.offer?.zone || i.offer?.name || 'sin-zona'));
      for (const z of zones) {
        const row = map.get(z);
        if (row) row.orders += 1;
      }
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async setSalesGoal(
    organizationId: string,
    eventId: string,
    goal: { tickets?: number | null; revenue?: number | null }
  ): Promise<AnalyticsSalesGoal> {
    const event = await this.loadEvent(organizationId, eventId);
    const root = { ...((event.metadata as Record<string, unknown> | null) ?? {}) };
    const analytics = {
      ...((root.analytics as Record<string, unknown> | undefined) ?? {}),
    };
    const current = readAnalyticsMeta(event.metadata).salesGoal ?? {};
    const next: AnalyticsSalesGoal = { ...current };

    if (goal.tickets === null) delete next.tickets;
    else if (typeof goal.tickets === 'number') {
      if (!(goal.tickets >= 0)) throw new BadRequestException('La meta de boletos debe ser ≥ 0');
      next.tickets = Math.floor(goal.tickets);
    }

    if (goal.revenue === null) delete next.revenue;
    else if (typeof goal.revenue === 'number') {
      if (!(goal.revenue >= 0)) throw new BadRequestException('La meta de ingresos debe ser ≥ 0');
      next.revenue = goal.revenue;
    }

    if (Object.keys(next).length) analytics.salesGoal = next;
    else delete analytics.salesGoal;

    root.analytics = analytics;
    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: root as Prisma.InputJsonValue },
    });
    return next;
  }

  async exportCsv(
    organizationId: string,
    eventId: string,
    from?: string,
    to?: string
  ): Promise<string> {
    const data = await this.getEventAnalytics({ organizationId, eventId, from, to });
    const lines: string[] = [];
    lines.push('seccion,clave,etiqueta,ordenes,boletos,ingresos');
    lines.push(`embudo,visitas,Visitas a la ficha,${data.funnel.visits},${data.funnel.visits},0`);
    lines.push(`embudo,apartados,Apartados,${data.funnel.holds},${data.funnel.holds},0`);
    lines.push(`embudo,ordenes,Órdenes,${data.funnel.orders},${data.funnel.orders},0`);
    lines.push(`embudo,pagadas,Pagadas,${data.funnel.paid},${data.funnel.paid},0`);
    for (const row of data.byChannel) {
      lines.push(
        `canal,${csv(row.key)},${csv(row.label)},${row.orders},${row.tickets},${row.revenue}`
      );
    }
    for (const row of data.byPaymentMethod) {
      lines.push(
        `pago,${csv(row.key)},${csv(row.label)},${row.orders},${row.tickets},${row.revenue}`
      );
    }
    for (const row of data.byZone) {
      lines.push(
        `zona,${csv(row.key)},${csv(row.label)},${row.orders},${row.tickets},${row.revenue}`
      );
    }
    lines.push('serie_dia,cubeta,Cubeta,0,boletos,ingresos');
    for (const p of data.series.day) {
      lines.push(`serie_dia,${csv(p.bucket)},${csv(p.bucket)},0,${p.tickets},${p.revenue}`);
    }
    lines.push(
      `meta,boletos,Meta de boletos,0,${data.goal.ticketsTarget ?? ''},${data.goal.ticketsSold}`
    );
    lines.push(`meta,ingresos,Meta de ingresos,0,,${data.goal.revenueTarget ?? ''}`);
    return lines.join('\n');
  }
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
