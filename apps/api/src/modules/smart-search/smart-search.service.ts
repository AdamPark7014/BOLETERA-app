import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { publicCatalogEventWhere } from '../../common/event-visibility';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClaudeClient } from './claude-client';
import { normalizeQuery, type InterpretResult, type SmartSearchFilters } from './query-filters';
import { explainChips, fuzzyIncludes, interpretQuery } from './query-interpreter';

const CACHE_TTL = 600;
const RATE_IP = 30;
const RATE_SESSION = 60;
const RATE_WINDOW = 3600;
const ASSISTANT_LIMIT = 5;

export type SmartSearchHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: Date;
  category: string;
  genre: string | null;
  image: string | null;
  minPrice: number;
  venue?: { name: string; city: string } | null;
  score: number;
  available: boolean;
};

@Injectable()
export class SmartSearchService {
  private readonly logger = new Logger(SmartSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly claude: ClaudeClient
  ) {}

  assistantAvailable(): boolean {
    return this.claude.isConfigured();
  }

  private async rateLimit(kind: 'ip' | 'session' | 'assistant', key: string, limit: number) {
    const redisKey = `smart-search:rl:${kind}:${key || 'anon'}`;
    const n = await this.redis.incrementWithTtl(redisKey, 1, RATE_WINDOW);
    if (n !== null && n > limit) {
      throw new HttpException(
        { code: 'RATE_LIMIT', message: 'Demasiadas búsquedas. Espera un momento.' },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  async search(params: {
    q: string;
    city?: string;
    orgId: string;
    ip?: string;
    sessionId?: string;
  }) {
    const q = params.q?.trim() ?? '';
    if (q.length < 2) {
      return {
        understood: '',
        chips: [] as string[],
        filters: {} as SmartSearchFilters,
        source: 'deterministic' as const,
        results: [] as SmartSearchHit[],
        alternatives: [] as SmartSearchHit[],
        usage: null as null | { inputTokens: number; outputTokens: number },
      };
    }

    await this.rateLimit('ip', params.ip || 'unknown', RATE_IP);
    if (params.sessionId) await this.rateLimit('session', params.sessionId, RATE_SESSION);

    const cacheKey = `smart-search:q:${params.orgId}:${normalizeQuery(q)}:${normalizeQuery(params.city || '')}`;
    const cached = await this.redis.getJson<{
      understood: string;
      chips: string[];
      filters: SmartSearchFilters;
      source: string;
      results: SmartSearchHit[];
      alternatives: SmartSearchHit[];
      usage: { inputTokens: number; outputTokens: number } | null;
    }>(cacheKey);
    if (cached) return cached;

    let interpreted: InterpretResult = interpretQuery(q);
    let usage: { inputTokens: number; outputTokens: number } | null = null;

    if (params.city && !interpreted.filters.city) {
      interpreted.filters.city = params.city;
      if (!interpreted.chips.includes(params.city)) interpreted.chips.push(params.city);
    }

    const needsModel =
      this.claude.isConfigured() &&
      (interpreted.residual.length >= 3 ||
        Object.keys(interpreted.filters).filter((k) => k !== 'text').length === 0);

    if (needsModel) {
      const model = await this.claude.interpretFilters(q, params.city);
      if (model) {
        usage = model.usage;
        this.logger.log(
          `smart-search tokens in=${model.usage.inputTokens} out=${model.usage.outputTokens}`
        );
        interpreted = {
          filters: { ...interpreted.filters, ...model.filters },
          chips: model.chips.length ? model.chips : interpreted.chips,
          residual: '',
          source: 'hybrid',
        };
      }
    }

    const { results, alternatives } = await this.queryEvents(params.orgId, interpreted.filters, q);
    const body = {
      understood: explainChips(interpreted.chips) || q,
      chips: interpreted.chips,
      filters: interpreted.filters,
      source: interpreted.source,
      results,
      alternatives,
      usage,
    };
    await this.redis.setJson(cacheKey, body, CACHE_TTL);
    return body;
  }

  private async queryEvents(orgId: string, filters: SmartSearchFilters, rawQ: string) {
    const where: Prisma.EventWhereInput = {
      AND: [
        publicCatalogEventWhere(),
        { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
        { organizationId: orgId },
        { startsAt: { gte: new Date() } },
      ],
    };

    if (filters.city) {
      const cityAliases =
        filters.city === 'CDMX'
          ? ['CDMX', 'Ciudad de México', 'Ciudad de Mexico', 'Mexico City']
          : [filters.city];
      where.venue = {
        ...(where.venue as object),
        OR: cityAliases.map((city) => ({ city: { equals: city, mode: 'insensitive' as const } })),
      } as Prisma.VenueWhereInput;
    }
    if (filters.category) {
      where.category = filters.category as never;
    }
    if (filters.genre) {
      where.genre = { contains: filters.genre, mode: 'insensitive' };
    }
    if (filters.dateFrom || filters.dateTo) {
      where.startsAt = {
        gte: filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00-06:00`) : new Date(),
        ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59-06:00`) } : {}),
      };
    }
    if (filters.maxPrice != null || filters.cheap) {
      const cap = filters.maxPrice ?? 500;
      where.minPrice = { lte: cap };
    }
    if (filters.text) {
      where.OR = [
        { title: { contains: filters.text, mode: 'insensitive' } },
        { description: { contains: filters.text, mode: 'insensitive' } },
        { genre: { contains: filters.text, mode: 'insensitive' } },
        { venue: { name: { contains: filters.text, mode: 'insensitive' } } },
      ];
    }

    const events = await this.prisma.event.findMany({
      where,
      take: 40,
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        startsAt: true,
        category: true,
        genre: true,
        image: true,
        minPrice: true,
        description: true,
        venue: { select: { name: true, city: true } },
        _count: { select: { orders: true, tickets: true } },
        offers: { where: { isAvailable: true }, select: { remainingQuantity: true }, take: 8 },
      },
    });

    const now = Date.now();
    const scored: SmartSearchHit[] = events.map((e) => {
      const textBlob = [e.title, e.genre, e.venue?.name, e.venue?.city, e.description]
        .filter(Boolean)
        .join(' ');
      let score = 40;
      if (filters.text && fuzzyIncludes(textBlob, filters.text)) score += 25;
      if (rawQ && fuzzyIncludes(e.title, rawQ)) score += 15;
      if (filters.genre && fuzzyIncludes(e.genre || '', filters.genre)) score += 15;
      if (filters.category && e.category === filters.category) score += 10;
      const days = Math.max(0, (e.startsAt.getTime() - now) / 86_400_000);
      score += Math.max(0, 20 - days);
      score += Math.min(15, e._count.orders);
      const remaining = e.offers.reduce((s, o) => s + (o.remainingQuantity ?? 0), 0);
      const available = remaining > 0 || e._count.tickets > 0;
      if (available) score += 8;
      if (filters.nearStage) score += 2;
      if (filters.accessible) score += 2;
      if (filters.kids && (e.category === 'FAMILY' || /familia|niñ/i.test(e.title))) score += 8;
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        startsAt: e.startsAt,
        category: e.category,
        genre: e.genre,
        image: e.image,
        minPrice: Number(e.minPrice),
        venue: e.venue,
        score: Math.round(score * 10) / 10,
        available,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, 24);

    let alternatives: SmartSearchHit[] = [];
    if (results.length === 0) {
      const loose: Prisma.EventWhereInput = {
        AND: [
          publicCatalogEventWhere(),
          { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
          { organizationId: orgId },
          { startsAt: { gte: new Date() } },
        ],
      };
      if (filters.category) loose.category = filters.category as never;
      else if (filters.city) {
        loose.venue = { city: { equals: filters.city, mode: 'insensitive' } };
      }
      const alt = await this.prisma.event.findMany({
        where: loose,
        take: 12,
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          slug: true,
          title: true,
          startsAt: true,
          category: true,
          genre: true,
          image: true,
          minPrice: true,
          venue: { select: { name: true, city: true } },
        },
      });
      alternatives = alt.map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        startsAt: e.startsAt,
        category: e.category,
        genre: e.genre,
        image: e.image,
        minPrice: Number(e.minPrice),
        venue: e.venue,
        score: 0,
        available: true,
      }));
    }

    return { results, alternatives };
  }

  async recommend(params: {
    orgId: string;
    userId?: string;
    viewedEventIds?: string[];
    limit?: number;
  }) {
    const take = Math.min(Math.max(params.limit ?? 8, 1), 16);
    const seeds: string[] = [...(params.viewedEventIds ?? [])];

    if (params.userId) {
      const orders = await this.prisma.order.findMany({
        where: {
          userId: params.userId,
          organizationId: params.orgId,
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { eventId: true },
      });
      for (const o of orders) if (o.eventId) seeds.push(o.eventId);
    }

    const uniqueSeeds = [...new Set(seeds)].slice(0, 12);
    if (uniqueSeeds.length === 0) {
      const trending = await this.prisma.event.findMany({
        where: {
          AND: [
            publicCatalogEventWhere(),
            { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
            { organizationId: params.orgId },
            { startsAt: { gte: new Date() } },
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
          image: true,
          minPrice: true,
          venue: { select: { name: true, city: true } },
        },
      });
      return { items: trending, reason: 'cartelera' as const };
    }

    const seedEvents = await this.prisma.event.findMany({
      where: { id: { in: uniqueSeeds }, organizationId: params.orgId },
      select: { category: true, venueId: true, venue: { select: { city: true } } },
    });
    const categories = [...new Set(seedEvents.map((e) => e.category))];
    const cities = [...new Set(seedEvents.map((e) => e.venue?.city).filter(Boolean))] as string[];
    const venueIds = [...new Set(seedEvents.map((e) => e.venueId).filter(Boolean))] as string[];

    const items = await this.prisma.event.findMany({
      where: {
        AND: [
          publicCatalogEventWhere(),
          { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
          { organizationId: params.orgId },
          { startsAt: { gte: new Date() } },
          { id: { notIn: uniqueSeeds } },
          {
            OR: [
              categories.length ? { category: { in: categories as never[] } } : undefined,
              cities.length
                ? { venue: { city: { in: cities } } }
                : undefined,
              venueIds.length ? { venueId: { in: venueIds } } : undefined,
            ].filter(Boolean) as Prisma.EventWhereInput[],
          },
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
        image: true,
        minPrice: true,
        venue: { select: { name: true, city: true } },
      },
    });

    return { items, reason: 'similares' as const };
  }

  async suggest(params: { orgId: string; q: string; limit?: number }) {
    const q = params.q.trim();
    if (q.length < 2) return { events: [], venues: [], cities: [], artists: [] };
    const take = Math.min(Math.max(params.limit ?? 6, 1), 10);

    const [events, venues] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          AND: [
            publicCatalogEventWhere(),
            { status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] } },
            { organizationId: params.orgId },
            {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { genre: { contains: q, mode: 'insensitive' } },
              ],
            },
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
      }),
      this.prisma.venue.findMany({
        where: {
          organizationId: params.orgId,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: { id: true, slug: true, name: true, city: true },
      }),
    ]);

    const citySet = new Map<string, number>();
    for (const v of venues) {
      if (v.city && normalizeQuery(v.city).includes(normalizeQuery(q))) {
        citySet.set(v.city, (citySet.get(v.city) ?? 0) + 1);
      }
    }
    const artists = events
      .filter((e) => fuzzyIncludes(e.title, q))
      .slice(0, 4)
      .map((e) => ({ name: e.title, slug: e.slug, type: 'artist' as const }));

    return {
      events: events.map((e) => ({
        type: 'event' as const,
        id: e.id,
        slug: e.slug,
        title: e.title,
        startsAt: e.startsAt,
        subtitle: [e.venue?.name, e.venue?.city].filter(Boolean).join(' · '),
      })),
      venues: venues.map((v) => ({
        type: 'venue' as const,
        id: v.id,
        slug: v.slug,
        title: v.name,
        subtitle: v.city,
      })),
      cities: [...citySet.keys()].slice(0, 4).map((name) => ({
        type: 'city' as const,
        title: name,
      })),
      artists,
    };
  }

  async assistantContext(orgId: string, eventIdOrSlug: string) {
    const event = await this.prisma.event.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ id: eventIdOrSlug }, { slug: eventIdOrSlug }],
        AND: [publicCatalogEventWhere()],
      },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        startsAt: true,
        doorsAt: true,
        genre: true,
        rating: true,
        allowResale: true,
        transferAllowed: true,
        refundable: true,
        nonTransferable: true,
        venue: {
          select: {
            name: true,
            city: true,
            address: true,
            accessibilitySeats: true,
          },
        },
        offers: {
          where: { isAvailable: true },
          select: {
            name: true,
            basePrice: true,
            zone: true,
            remainingQuantity: true,
          },
          take: 20,
        },
      },
    });
    if (!event) return null;

    const lines = [
      `Título: ${event.title}`,
      `Inicio: ${event.startsAt.toISOString()}`,
      event.doorsAt ? `Puertas: ${event.doorsAt.toISOString()}` : null,
      event.genre ? `Género: ${event.genre}` : null,
      event.rating ? `Clasificación: ${event.rating}` : null,
      event.venue
        ? `Recinto: ${event.venue.name}, ${event.venue.city}, ${event.venue.address || ''}`
        : null,
      event.venue?.accessibilitySeats
        ? `Accesibilidad: ${event.venue.accessibilitySeats} asientos accesibles`
        : 'Accesibilidad: sin dato en ficha',
      `Reembolso: ${event.refundable ? 'permitido según política' : 'no reembolsable'}`,
      `Transferencia: ${event.transferAllowed && !event.nonTransferable ? 'permitida' : 'no permitida'}`,
      `Reventa oficial: ${event.allowResale ? 'sí' : 'no'}`,
      event.description ? `Descripción: ${event.description.slice(0, 800)}` : null,
      'Zonas y precios base (MXN):',
      ...event.offers.map(
        (o) =>
          `- ${o.name || o.zone || 'Zona'}: $${Number(o.basePrice)} (quedan ${o.remainingQuantity ?? '—'})`
      ),
    ];
    return { eventId: event.id, slug: event.slug, context: lines.filter(Boolean).join('\n') };
  }

  async askAssistant(params: {
    orgId: string;
    eventId: string;
    question: string;
    sessionId?: string;
    ip?: string;
  }) {
    if (!this.claude.isConfigured()) {
      throw new HttpException(
        { code: 'ASSISTANT_OFF', message: 'El asistente no está disponible.' },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    await this.rateLimit('assistant', params.sessionId || params.ip || 'anon', ASSISTANT_LIMIT);
    const ctx = await this.assistantContext(params.orgId, params.eventId);
    if (!ctx) {
      throw new HttpException(
        { code: 'NOT_FOUND', message: 'No encontramos ese evento.' },
        HttpStatus.NOT_FOUND
      );
    }
    return this.claude.streamAssistant({
      question: params.question.slice(0, 500),
      eventContext: ctx.context,
    });
  }
}
