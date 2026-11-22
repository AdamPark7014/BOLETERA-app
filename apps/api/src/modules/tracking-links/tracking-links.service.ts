import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { readAnalyticsMeta } from '../metrics/event-analytics.service';
import type { AnalyticsTrackingLink } from '../metrics/event-analytics.types';
import { parseMetricsRange } from '../metrics/metrics.helpers';

const CLICK_TTL_SEC = 90 * 24 * 60 * 60;
const COMPLETED: OrderStatus = 'COMPLETED';

export type TrackingLinkWithClicks = AnalyticsTrackingLink & { clicks: number };

export type TrackingLinkReportRow = TrackingLinkWithClicks & {
  orders: number;
  tickets: number;
  revenue: number;
  known: boolean;
};

export function normalizeTrackingCode(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  return cleaned.length ? cleaned : undefined;
}

function clicksKey(eventId: string, code: string) {
  return `analytics:clicks:${eventId}:${code}`;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readAffiliateRef(posOps: unknown): string | undefined {
  const ops = asObject(posOps);
  const ref = ops.affiliateRef;
  return typeof ref === 'string' ? normalizeTrackingCode(ref) : undefined;
}

@Injectable()
export class TrackingLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  private async loadEvent(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true, metadata: true, slug: true, title: true },
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

  private async getClicks(eventId: string, code: string): Promise<number> {
    const raw = await this.redis.get(clicksKey(eventId, code));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  async list(organizationId: string, eventId: string): Promise<TrackingLinkWithClicks[]> {
    const event = await this.loadEvent(organizationId, eventId);
    const links = readAnalyticsMeta(event.metadata).trackingLinks ?? [];
    return Promise.all(
      links.map(async (link) => ({
        ...link,
        clicks: await this.getClicks(event.id, link.code),
      }))
    );
  }

  async create(
    organizationId: string,
    eventId: string,
    input: { code: string; label: string },
    userId?: string
  ): Promise<TrackingLinkWithClicks> {
    const code = normalizeTrackingCode(input.code);
    if (!code) throw new BadRequestException('El código del enlace no es válido');
    const label = (input.label ?? '').trim().slice(0, 80);
    if (!label) throw new BadRequestException('Ponle un nombre al enlace');

    const event = await this.loadEvent(organizationId, eventId);
    const root = asObject(event.metadata);
    const analytics = asObject(root.analytics);
    const existing = readAnalyticsMeta(event.metadata).trackingLinks ?? [];
    if (existing.some((l) => l.code === code)) {
      throw new BadRequestException(`Ya existe el enlace ${code}`);
    }

    const link: AnalyticsTrackingLink = {
      code,
      label,
      createdAt: new Date().toISOString(),
      ...(userId ? { createdBy: userId } : {}),
    };
    analytics.trackingLinks = [...existing, link];
    root.analytics = analytics;

    const channels = asObject(root.channels);
    const affiliate = asObject(channels.affiliate);
    const partners = Array.isArray(affiliate.partners)
      ? (affiliate.partners as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
    if (!partners.map((p) => normalizeTrackingCode(p)).includes(code)) {
      partners.push(code);
    }
    affiliate.partners = partners;
    affiliate.enabled = true;
    channels.affiliate = affiliate;
    root.channels = channels;

    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: root as Prisma.InputJsonValue },
    });

    return { ...link, clicks: 0 };
  }

  async remove(organizationId: string, eventId: string, codeRaw: string): Promise<{ ok: true }> {
    const code = normalizeTrackingCode(codeRaw);
    if (!code) throw new BadRequestException('Código inválido');
    const event = await this.loadEvent(organizationId, eventId);
    const root = asObject(event.metadata);
    const analytics = asObject(root.analytics);
    const links = (readAnalyticsMeta(event.metadata).trackingLinks ?? []).filter(
      (l) => l.code !== code
    );
    analytics.trackingLinks = links;
    root.analytics = analytics;

    const channels = asObject(root.channels);
    const affiliate = asObject(channels.affiliate);
    if (Array.isArray(affiliate.partners)) {
      affiliate.partners = (affiliate.partners as unknown[])
        .filter((p): p is string => typeof p === 'string')
        .filter((p) => normalizeTrackingCode(p) !== code);
      channels.affiliate = affiliate;
      root.channels = channels;
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: root as Prisma.InputJsonValue },
    });
    return { ok: true };
  }

  async recordClick(params: {
    eventId?: string;
    slug?: string;
    code?: string;
  }): Promise<{ eventId: string; code: string; clicks: number }> {
    const code = normalizeTrackingCode(params.code);
    if (!code) throw new BadRequestException('Falta el código del enlace');
    const eventId = await this.resolveEventId(params);
    const clicks =
      (await this.redis.incrementWithTtl(clicksKey(eventId, code), 1, CLICK_TTL_SEC)) ?? 0;
    return { eventId, code, clicks };
  }

  async report(
    organizationId: string,
    eventId: string,
    from?: string,
    to?: string
  ): Promise<{ eventId: string; links: TrackingLinkReportRow[] }> {
    const event = await this.loadEvent(organizationId, eventId);
    const range = parseMetricsRange(from, to);
    const known = readAnalyticsMeta(event.metadata).trackingLinks ?? [];
    const knownMap = new Map(known.map((l) => [l.code, l]));

    const orders = await this.prisma.order.findMany({
      where: {
        eventId,
        organizationId,
        status: COMPLETED,
        createdAt: { gte: range.from, lte: range.to },
      },
      select: {
        totalAmount: true,
        posOps: true,
        items: { select: { quantity: true } },
      },
    });

    const stats = new Map<string, { orders: number; tickets: number; revenue: number }>();
    for (const order of orders) {
      const ref = readAffiliateRef(order.posOps);
      if (!ref) continue;
      const row = stats.get(ref) ?? { orders: 0, tickets: 0, revenue: 0 };
      row.orders += 1;
      row.tickets += order.items.reduce((s, i) => s + i.quantity, 0);
      row.revenue += Number(order.totalAmount);
      stats.set(ref, row);
    }

    const codes = new Set<string>([...knownMap.keys(), ...stats.keys()]);
    const links: TrackingLinkReportRow[] = [];
    for (const code of codes) {
      const meta = knownMap.get(code);
      const s = stats.get(code) ?? { orders: 0, tickets: 0, revenue: 0 };
      links.push({
        code,
        label: meta?.label ?? code,
        createdAt: meta?.createdAt ?? '',
        ...(meta?.createdBy ? { createdBy: meta.createdBy } : {}),
        clicks: await this.getClicks(eventId, code),
        orders: s.orders,
        tickets: s.tickets,
        revenue: s.revenue,
        known: Boolean(meta),
      });
    }

    links.sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks);
    return { eventId, links };
  }
}
