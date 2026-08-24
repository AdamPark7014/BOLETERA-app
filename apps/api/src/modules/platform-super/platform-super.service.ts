import { Injectable, BadRequestException } from '@nestjs/common';
import { OrgType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;

export type PlatformSuperSearchEntityType =
  | 'user'
  | 'customer'
  | 'event'
  | 'order'
  | 'ticket'
  | 'venue'
  | 'organization'
  | 'promoter';

export type PlatformSuperSearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: Record<string, string>;
};

export type PlatformSuperSearchGroup = {
  entityType: PlatformSuperSearchEntityType;
  label: string;
  items: PlatformSuperSearchItem[];
  total: number;
};

@Injectable()
export class PlatformSuperService {
  constructor(private prisma: PrismaService) {}

  private startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  private textOrIdFilter(
    q: string,
    fields: string[],
  ): { OR: Array<Record<string, unknown>> } {
    const contains = fields.map((field) => ({
      [field]: { contains: q, mode: 'insensitive' as const },
    }));
    if (q.length >= 4) {
      return { OR: [...contains, { id: q }] };
    }
    return { OR: contains };
  }

  async overview() {
    const today = this.startOfToday();

    const [
      organizationCount,
      organizations,
      usersByRole,
      events,
      orders,
      venues,
      ordersToday,
      failedPayments,
      pendingRefunds,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          verified: true,
          createdAt: true,
          _count: { select: { users: true, events: true, venues: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.user.groupBy({
        by: ['role'],
        _count: { role: true },
      }),
      this.prisma.event.count(),
      this.prisma.order.count(),
      this.prisma.venue.count(),
      this.prisma.order.count({ where: { createdAt: { gte: today } } }),
      this.prisma.payment.count({ where: { status: 'FAILED' } }),
      this.prisma.refund.count({ where: { status: 'PENDING' } }),
    ]);

    const userTotal = usersByRole.reduce((n, r) => n + r._count.role, 0);

    return {
      totals: {
        organizations: organizationCount,
        users: userTotal,
        events,
        orders,
        venues,
      },
      health: {
        ordersToday,
        failedPayments,
        pendingRefunds,
      },
      usersByRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count.role])),
      organizations: organizations.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        verified: o.verified,
        createdAt: o.createdAt,
        users: o._count.users,
        events: o._count.events,
        venues: o._count.venues,
      })),
    };
  }

  async search(rawQuery?: string, rawLimit?: number): Promise<{
    query: string;
    limit: number;
    groups: PlatformSuperSearchGroup[];
    totalCount: number;
  }> {
    const query = rawQuery?.trim() ?? '';
    if (query.length < MIN_QUERY_LENGTH) {
      throw new BadRequestException(`La búsqueda requiere al menos ${MIN_QUERY_LENGTH} caracteres`);
    }

    const limit = Math.min(
      Math.max(rawLimit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );

    const userWhere = this.textOrIdFilter(query, ['email', 'firstName', 'lastName', 'phone']);
    const eventWhere = this.textOrIdFilter(query, ['title', 'slug', 'externalId']);
    const orderWhere = this.textOrIdFilter(query, ['publicId', 'buyerEmail', 'buyerName']);
    const ticketWhere = this.textOrIdFilter(query, ['code', 'buyerEmail', 'buyerName']);
    const venueWhere = this.textOrIdFilter(query, ['name', 'slug', 'city']);
    const orgWhere = this.textOrIdFilter(query, ['name', 'slug', 'email']);
    const promoterOrgWhere: Prisma.OrganizationWhereInput = {
      type: OrgType.PROMOTER,
      ...(orgWhere as Prisma.OrganizationWhereInput),
    };
    const promoterUserWhere: Prisma.UserWhereInput = {
      role: UserRole.PROMOTER,
      ...userWhere,
    };

    const [
      users,
      userTotal,
      customers,
      customerTotal,
      events,
      eventTotal,
      orders,
      orderTotal,
      tickets,
      ticketTotal,
      venues,
      venueTotal,
      organizations,
      organizationTotal,
      promoterOrgs,
      promoterOrgTotal,
      promoterUsers,
      promoterUserTotal,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: userWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.user.count({ where: userWhere }),
      this.prisma.user.findMany({
        where: { role: UserRole.CUSTOMER, ...userWhere },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER, ...userWhere } }),
      this.prisma.event.findMany({
        where: eventWhere,
        take: limit,
        orderBy: { startsAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          startsAt: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.event.count({ where: eventWhere }),
      this.prisma.order.findMany({
        where: orderWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          publicId: true,
          status: true,
          buyerName: true,
          buyerEmail: true,
          event: { select: { title: true } },
          organization: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where: orderWhere }),
      this.prisma.ticket.findMany({
        where: ticketWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          status: true,
          buyerName: true,
          event: { select: { id: true, title: true } },
        },
      }),
      this.prisma.ticket.count({ where: ticketWhere }),
      this.prisma.venue.findMany({
        where: venueWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          city: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.venue.count({ where: venueWhere }),
      this.prisma.organization.findMany({
        where: orgWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          verified: true,
        },
      }),
      this.prisma.organization.count({ where: orgWhere }),
      this.prisma.organization.findMany({
        where: promoterOrgWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          verified: true,
        },
      }),
      this.prisma.organization.count({ where: promoterOrgWhere }),
      this.prisma.user.findMany({
        where: promoterUserWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.user.count({ where: promoterUserWhere }),
    ]);

    const promoterItems: PlatformSuperSearchItem[] = [
      ...promoterOrgs.map((o) => ({
        id: o.id,
        title: o.name,
        subtitle: o.slug,
        meta: {
          promoterKind: 'organization',
          email: o.email,
          verified: String(o.verified),
        },
      })),
      ...promoterUsers.map((u) => ({
        id: u.id,
        title: `${u.firstName} ${u.lastName}`.trim(),
        subtitle: u.email,
        meta: {
          promoterKind: 'user',
          organizationName: u.organization?.name ?? '',
        },
      })),
    ].slice(0, limit);

    const promoterTotal = promoterOrgTotal + promoterUserTotal;

    const groups: PlatformSuperSearchGroup[] = [
      {
        entityType: 'user',
        label: 'Usuarios',
        total: userTotal,
        items: users.map((u) => {
          const row = u as typeof u & { organization: { name: string } | null };
          return {
            id: row.id,
            title: `${row.firstName} ${row.lastName}`.trim(),
            subtitle: row.email,
            meta: {
              role: row.role,
              organizationName: row.organization?.name ?? '',
            },
          };
        }),
      },
      {
        entityType: 'customer',
        label: 'Clientes',
        total: customerTotal,
        items: customers.map((u) => {
          const row = u as typeof u & { organization: { name: string } | null };
          return {
            id: row.id,
            title: `${row.firstName} ${row.lastName}`.trim(),
            subtitle: row.email,
            meta: { organizationName: row.organization?.name ?? '' },
          };
        }),
      },
      {
        entityType: 'event',
        label: 'Eventos',
        total: eventTotal,
        items: events.map((e) => {
          const row = e as typeof e & { organization: { name: string } };
          return {
            id: row.id,
            title: row.title,
            subtitle: row.organization.name,
            meta: {
              slug: row.slug,
              status: row.status,
              startsAt: row.startsAt.toISOString(),
            },
          };
        }),
      },
      {
        entityType: 'order',
        label: 'Órdenes',
        total: orderTotal,
        items: orders.map((o) => {
          const row = o as typeof o & {
            event: { title: string };
            organization: { name: string };
          };
          return {
            id: row.id,
            title: row.publicId,
            subtitle: row.event.title,
            meta: {
              status: row.status,
              buyerName: row.buyerName,
              buyerEmail: row.buyerEmail,
              organizationName: row.organization.name,
            },
          };
        }),
      },
      {
        entityType: 'ticket',
        label: 'Boletos',
        total: ticketTotal,
        items: tickets.map((t) => {
          const row = t as typeof t & { event: { id: string; title: string } };
          return {
            id: row.id,
            title: row.code,
            subtitle: row.event.title,
            meta: {
              status: row.status,
              eventId: row.event.id,
              buyerName: row.buyerName ?? '',
            },
          };
        }),
      },
      {
        entityType: 'venue',
        label: 'Venues',
        total: venueTotal,
        items: venues.map((v) => {
          const row = v as (typeof venues)[number] & { organization?: { name: string } };
          return {
            id: row.id,
            title: row.name,
            subtitle: [row.city, row.organization?.name].filter(Boolean).join(' · '),
            meta: { slug: row.slug },
          };
        }),
      },
      {
        entityType: 'organization',
        label: 'Organizaciones',
        total: organizationTotal,
        items: organizations.map((o) => ({
          id: o.id,
          title: o.name,
          subtitle: o.slug,
          meta: { type: o.type, verified: String(o.verified) },
        })),
      },
      {
        entityType: 'promoter',
        label: 'Promotores',
        total: promoterTotal,
        items: promoterItems,
      },
    ].filter((g) => g.total > 0) as PlatformSuperSearchGroup[];

    const totalCount = groups.reduce((n, g) => n + g.total, 0);

    return { query, limit, groups, totalCount };
  }
}
