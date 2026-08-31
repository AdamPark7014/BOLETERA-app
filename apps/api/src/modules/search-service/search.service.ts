import { Injectable, Logger } from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { publicCatalogEventWhere } from '../../common/event-visibility';
import { PrismaService } from '../prisma/prisma.service';

interface SearchFilters {
  query?: string;
  dateRange?: { start: Date; end: Date };
  categories?: string[];
  cities?: string[];
  venues?: string[];
  limit?: number;
  /** Required for public routes: same host scope as discovery. */
  organizationId?: string;
}

@Injectable()
export class SearchService {
  private logger = new Logger(SearchService.name);

  constructor(private prisma: PrismaService) {}

  private catalogWhere(filters: SearchFilters): Prisma.EventWhereInput {
    return {
      AND: [
        publicCatalogEventWhere(),
        {
          status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] },
        },
      ],
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.dateRange && {
        startsAt: { gte: filters.dateRange.start, lte: filters.dateRange.end },
      }),
      ...(filters.categories?.length && { category: { in: filters.categories as never[] } }),
      ...(filters.cities?.length && { venue: { city: { in: filters.cities } } }),
      ...(filters.venues?.length && { venueId: { in: filters.venues } }),
      ...(filters.query && {
        OR: [
          { title: { contains: filters.query, mode: 'insensitive' } },
          { description: { contains: filters.query, mode: 'insensitive' } },
          { venue: { name: { contains: filters.query, mode: 'insensitive' } } },
        ],
      }),
    };
  }

  async searchEvents(filters: SearchFilters, userId?: string) {
    const where = this.catalogWhere(filters);

    const events = await this.prisma.event.findMany({
      where,
      take: filters.limit ?? 24,
      orderBy: { startsAt: 'asc' },
      include: {
        venue: { select: { name: true, city: true, slug: true } },
        offers: { where: { isAvailable: true }, take: 3 },
        _count: { select: { orders: true, tickets: true } },
      },
    });

    const ranked = await Promise.all(
      events.map(async (event) => {
        const factors = await this.rankingFactors(event, filters.query ?? '', userId);
        const score =
          factors.contentMatching * 0.3 +
          factors.personalization * 0.35 +
          factors.demandSignals * 0.25 +
          factors.businessValue * 0.1;
        return {
          eventId: event.id,
          title: event.title,
          slug: event.slug,
          score: Math.round(score * 10) / 10,
          rankingFactors: factors,
          event: {
            id: event.id,
            title: event.title,
            slug: event.slug,
            startsAt: event.startsAt,
            minPrice: event.minPrice,
            currency: event.currency,
            venue: event.venue,
            category: event.category,
          },
        };
      }),
    );

    ranked.sort((a, b) => b.score - a.score);
    this.logger.log(`Search: ${ranked.length} results for "${filters.query ?? '*'}"`);
    return ranked;
  }

  private async rankingFactors(
    event: {
      title: string;
      description: string | null;
      category: string;
      venue: { name: string };
      _count: { orders: number };
    },
    query: string,
    userId?: string,
  ) {
    const q = query.toLowerCase();
    let contentMatching = 40;
    if (!q) contentMatching = 50;
    else if (event.title.toLowerCase().includes(q)) contentMatching = 95;
    else if (event.description?.toLowerCase().includes(q)) contentMatching = 70;
    else if (event.venue.name.toLowerCase().includes(q)) contentMatching = 55;

    let personalization = 50;
    if (userId) {
      const past = await this.prisma.order.count({
        where: { userId, event: { category: event.category as never } },
      });
      personalization = Math.min(100, 50 + past * 10);
    }

    const demandSignals = Math.min(100, 30 + event._count.orders * 2);
    const businessValue = 60;

    return { contentMatching, personalization, demandSignals, businessValue };
  }

  async getSearchFacets(filters: SearchFilters) {
    const events = await this.prisma.event.findMany({
      where: this.catalogWhere(filters),
      include: { venue: true },
      take: 200,
    });
    const cities = [...new Set(events.map((e) => e.venue.city).filter(Boolean))];
    const categories = [...new Set(events.map((e) => e.category))];
    return { cities, categories, priceRange: { min: 0, max: 5000 } };
  }

  async getAutocomplete(query: string, organizationId?: string) {
    if (!query || query.length < 2) return [];
    const events = await this.prisma.event.findMany({
      where: {
        AND: [publicCatalogEventWhere()],
        status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] },
        ...(organizationId ? { organizationId } : {}),
        title: { contains: query, mode: 'insensitive' },
      },
      take: 8,
      select: { id: true, title: true, slug: true, startsAt: true },
    });
    return events;
  }

  async getTrendingEvents(limit = 10, organizationId?: string) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events = await this.prisma.event.findMany({
      where: {
        AND: [publicCatalogEventWhere()],
        status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] },
        startsAt: { gte: new Date() },
        ...(organizationId ? { organizationId } : {}),
      },
      include: {
        venue: true,
        _count: {
          select: {
            orders: {
              where: { createdAt: { gte: weekAgo }, status: 'COMPLETED' },
            },
          },
        },
      },
      take: limit * 3,
    });
    return events
      .sort((a, b) => b._count.orders - a._count.orders)
      .slice(0, limit)
      .map((e) => ({
        eventId: e.id,
        title: e.title,
        slug: e.slug,
        score: e._count.orders,
        event: e,
      }));
  }

  async getSmartRecommendations(userId?: string, organizationId?: string) {
    if (userId) {
      const lastOrder = await this.prisma.order.findFirst({
        where: {
          userId,
          status: 'COMPLETED',
          ...(organizationId ? { organizationId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: { event: true },
      });
      if (lastOrder?.event) {
        return this.searchEvents(
          {
            categories: [lastOrder.event.category],
            limit: 8,
            organizationId,
          },
          userId,
        );
      }
    }
    return this.getTrendingEvents(8, organizationId);
  }
}
