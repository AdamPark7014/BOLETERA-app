import { Injectable, NotFoundException } from '@nestjs/common';
import { allInPrice, priceBreakdown } from '../../common/pricing-rates';
import { EventCategory, EventStatus, Prisma } from '@prisma/client';
import { isPublicCatalogEvent, publicCatalogEventWhere } from '../../common/event-visibility';
import { PrismaService } from '../prisma/prisma.service';

const CATEGORIES = new Set(Object.values(EventCategory));

type ListParams = {
  orgId?: string;
  q?: string;
  city?: string;
  category?: string;
  venueSlug?: string;
  when?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
};

@Injectable()
export class DiscoveryService {
  constructor(private prisma: PrismaService) {}

  private whenRange(when?: string): { gte?: Date; lte?: Date } | undefined {
    if (!when || when === 'ALL') return undefined;
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    if (when === 'WEEK') return { gte: now, lte: weekEnd };
    if (when === 'MONTH') return { gte: now, lte: monthEnd };
    if (when === 'WEEKEND') return { gte: now, lte: weekEnd };
    return undefined;
  }

  async listEvents(params: ListParams) {
    const range = this.whenRange(params.when);
    const from = params.from ? new Date(params.from) : range?.gte;
    const to = params.to ? new Date(params.to) : range?.lte;

    const where: Prisma.EventWhereInput = {
      AND: [
        publicCatalogEventWhere(),
        {
          status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] },
        },
      ],
      ...(params.orgId ? { organizationId: params.orgId } : {}),
      ...(params.city
        ? { venue: { city: { equals: params.city, mode: 'insensitive' } } }
        : {}),
      ...(params.venueSlug
        ? { venue: { slug: params.venueSlug } }
        : {}),
      ...(params.category && CATEGORIES.has(params.category as EventCategory)
        ? { category: params.category as EventCategory }
        : {}),
      ...(from || to
        ? {
            startsAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' } },
              { slug: { contains: params.q, mode: 'insensitive' } },
              { venue: { name: { contains: params.q, mode: 'insensitive' } } },
              { venue: { city: { contains: params.q, mode: 'insensitive' } } },
              { genre: { contains: params.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const take = Math.min(Math.max(params.limit ?? 40, 1), 100);
    let events = await this.prisma.event.findMany({
      where,
      take: params.when === 'WEEKEND' ? Math.min(take * 3, 120) : take,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: { startsAt: 'asc' },
      include: {
        venue: { select: { name: true, city: true, slug: true } },
        organization: { select: { name: true, slug: true } },
        offers: {
          where: { isAvailable: true },
          select: {
            id: true,
            name: true,
            zone: true,
            basePrice: true,
            remainingQuantity: true,
            isAvailable: true,
          },
        },
      },
    });

    if (params.when === 'WEEKEND') {
      events = events
        .filter((e) => {
          const d = e.startsAt.getDay();
          return d === 5 || d === 6 || d === 0;
        })
        .slice(0, take);
    }

    return events.map((e) => {
      const prices = e.offers.map((o) => Number(o.basePrice)).filter((n) => !Number.isNaN(n));
      const minPrice = prices.length ? Math.min(...prices) : 0;
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        description: e.description,
        image: e.image,
        bannerImage: e.bannerImage,
        posterAspect:
          ((e.metadata as { posterAspect?: string } | null)?.posterAspect) ??
          undefined,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        status: e.status,
        category: e.category,
        genre: e.genre,
        currency: e.currency ?? 'MXN',
        /** @deprecated Precio base sin cargos. No mostrarlo como «desde». */
        minPrice,
        /** Precio final al comprador: es el que debe anunciarse. */
        minPriceAllIn: allInPrice(minPrice),
        minPriceBreakdown: priceBreakdown(minPrice),
        maxPrice: e.maxPrice != null ? Number(e.maxPrice) : null,
        venue: e.venue,
        organization: e.organization,
        offerCount: e.offers.length,
        offers: e.offers.map((o) => ({
          id: o.id,
          name: o.name,
          zone: o.zone,
          basePrice: o.basePrice,
          /** Lo que se paga por esta zona, cargos e IVA incluidos. */
          allInPrice: allInPrice(Number(o.basePrice)),
          priceBreakdown: priceBreakdown(Number(o.basePrice)),
          remainingQuantity: o.remainingQuantity,
          isAvailable: o.isAvailable,
        })),
      };
    });
  }

  async getBySlug(slug: string, orgId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      include: {
        venue: true,
        organization: { include: { tenantTheme: true } },
        offers: { where: { isAvailable: true } },
        seatMap: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (orgId && event.organizationId !== orgId) {
      throw new NotFoundException('Event not found');
    }
    if (!isPublicCatalogEvent(event.metadata)) {
      throw new NotFoundException('Event not found');
    }
    const posterAspect =
      ((event.metadata as { posterAspect?: string } | null)?.posterAspect) ?? undefined;

    // El precio anunciado tiene que ser el que se cobra: `basePrice` deja fuera
    // cargos e IVA, que con las tarifas actuales son un 26% más.
    const offerPrices = event.offers
      .map((o) => Number(o.basePrice))
      .filter((n) => Number.isFinite(n) && n > 0);
    const cheapest = offerPrices.length ? Math.min(...offerPrices) : 0;

    return {
      ...event,
      posterAspect,
      minPriceAllIn: allInPrice(cheapest),
      minPriceBreakdown: priceBreakdown(cheapest),
      offers: event.offers.map((o) => ({
        ...o,
        allInPrice: allInPrice(Number(o.basePrice)),
        priceBreakdown: priceBreakdown(Number(o.basePrice)),
      })),
    };
  }

  /** Lightweight typeahead rows for discovery search. */
  async suggest(params: { orgId?: string; q: string; limit?: number }) {
    const q = params.q.trim();
    if (q.length < 2) return [];
    const take = Math.min(Math.max(params.limit ?? 8, 1), 12);
    const events = await this.prisma.event.findMany({
      where: {
        AND: [
          publicCatalogEventWhere(),
          {
            status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] },
          },
        ],
        ...(params.orgId ? { organizationId: params.orgId } : {}),
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { venue: { name: { contains: q, mode: 'insensitive' } } },
          { venue: { city: { contains: q, mode: 'insensitive' } } },
          { genre: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        startsAt: true,
        category: true,
        venue: { select: { name: true, city: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      startsAt: e.startsAt,
      category: e.category,
      venue: e.venue,
      subtitle: [e.venue?.name, e.venue?.city].filter(Boolean).join(' · '),
    }));
  }

  async facets(orgId?: string) {
    const events = await this.prisma.event.findMany({
      where: {
        AND: [
          publicCatalogEventWhere(),
          {
            status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] },
          },
        ],
        ...(orgId ? { organizationId: orgId } : {}),
      },
      select: {
        category: true,
        venue: { select: { city: true } },
      },
    });

    const cityMap = new Map<string, number>();
    const categoryMap = new Map<string, number>();
    for (const e of events) {
      const city = e.venue?.city?.trim();
      if (city) cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
      if (e.category) categoryMap.set(e.category, (categoryMap.get(e.category) ?? 0) + 1);
    }

    return {
      cities: Array.from(cityMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      categories: Array.from(categoryMap.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async listVenues(params: { orgId?: string; limit?: number; city?: string }) {
    const take = Math.min(Math.max(params.limit ?? 24, 1), 60);
    const venues = await this.prisma.venue.findMany({
      where: {
        ...(params.orgId ? { organizationId: params.orgId } : {}),
        ...(params.city
          ? { city: { equals: params.city, mode: 'insensitive' } }
          : {}),
        events: {
          some: {
            AND: [
              publicCatalogEventWhere(),
              { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
            ],
          },
        },
      },
      take,
      orderBy: { events: { _count: 'desc' } },
      select: {
        id: true,
        slug: true,
        name: true,
        city: true,
        state: true,
        address: true,
        image: true,
        _count: {
          select: {
            events: {
              where: {
                AND: [
                  publicCatalogEventWhere(),
                  { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
                ],
              },
            },
          },
        },
      },
    });

    return venues.map((v) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      state: v.state,
      address: v.address,
      image: v.image,
      eventCount: v._count.events,
    }));
  }

  async getVenueBySlug(slug: string, orgId?: string) {
    const venue = await this.prisma.venue.findFirst({
      where: {
        slug,
        ...(orgId ? { organizationId: orgId } : {}),
      },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    const events = await this.listEvents({
      orgId,
      venueSlug: slug,
      limit: 40,
    });

    return {
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      description: venue.description,
      address: venue.address,
      city: venue.city,
      state: venue.state,
      country: venue.country,
      postalCode: venue.postalCode,
      latitude: venue.latitude,
      longitude: venue.longitude,
      phone: venue.phone,
      website: venue.website,
      image: venue.image,
      totalCapacity: venue.totalCapacity,
      eventCount: events.length,
      events,
    };
  }

  async getSiteContent(orgId: string) {
    const theme = await this.prisma.tenantTheme.findUnique({
      where: { organizationId: orgId },
      select: { siteContent: true },
    });
    const { mergeSiteContent } = await import('@boletera/shared');
    return mergeSiteContent(theme?.siteContent);
  }
}
