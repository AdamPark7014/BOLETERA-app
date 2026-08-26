import {
  PrismaClient,
  EventStatus,
  EventSeriesKind,
  EventSeriesStatus,
  TicketStatus,
  UserRole,
  OrgType,
  Currency,
  SalesChannel,
  OrderStatus,
  WaitlistStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateLayoutTemplate, type LayoutTemplateId } from '@boletera/venue-engine';
import { EVENT_STOCK_IMAGES, type SeatMapData, defaultSiteContent } from '@boletera/shared';
import { seedPermissions } from './seed-permissions';

const prisma = new PrismaClient();

/** Slot persisted under `event.metadata.channels` (lowercase keys). */
type ChannelSlotSeed = {
  enabled: boolean;
  allocation: number;
  locations?: string[];
  partners?: string[];
  commissionRate?: number;
  contactEmail?: string;
  feePercent?: number;
  hours?: string;
};

function assertChannelAllocation(slots: Record<string, ChannelSlotSeed>, label: string) {
  const total = Object.values(slots).reduce((sum, slot) => sum + slot.allocation, 0);
  if (total !== 100) {
    throw new Error(`${label}: channel allocation must equal 100%, got ${total}%`);
  }
}

/** Realistic multi-channel inventory mix for demo events. */
const DEMO_EVENT_CHANNEL_CONFIGS: Record<string, Record<string, ChannelSlotSeed>> = {
  'concierto-demo-2026': {
    web: { enabled: true, allocation: 43 },
    mobile: { enabled: true, allocation: 14 },
    taquilla: { enabled: true, allocation: 12, locations: ['Arena CDMX — taquilla norte'] },
    api: { enabled: true, allocation: 5, partners: ['partner-demo'] },
    promoter: { enabled: true, allocation: 7, commissionRate: 0.08 },
    affiliate: { enabled: true, allocation: 4, partners: ['afiliado-demo'] },
    phone: { enabled: true, allocation: 3, hours: '10:00–20:00' },
    corporate: { enabled: true, allocation: 3, contactEmail: 'corporativo@demo.boletera.com' },
    courtesy: { enabled: true, allocation: 1 },
    invitation: { enabled: true, allocation: 2 },
    vip: { enabled: true, allocation: 2 },
    resale: { enabled: true, allocation: 3, feePercent: 12 },
    admin: { enabled: true, allocation: 1 },
  },
  'clasico-regio': {
    web: { enabled: true, allocation: 26 },
    mobile: { enabled: true, allocation: 10 },
    taquilla: { enabled: true, allocation: 30, locations: ['Estadio — taquilla principal'] },
    api: { enabled: true, allocation: 3 },
    promoter: { enabled: true, allocation: 5, commissionRate: 0.06 },
    phone: { enabled: true, allocation: 5, hours: '09:00–21:00' },
    corporate: { enabled: true, allocation: 8, contactEmail: 'patrocinios@demo.boletera.com' },
    courtesy: { enabled: true, allocation: 2 },
    invitation: { enabled: true, allocation: 3 },
    affiliate: { enabled: true, allocation: 2 },
    vip: { enabled: true, allocation: 4 },
    resale: { enabled: true, allocation: 2, feePercent: 10 },
    admin: { enabled: false, allocation: 0 },
  },
  'festival-verano-mty': {
    web: { enabled: true, allocation: 35 },
    mobile: { enabled: true, allocation: 20 },
    taquilla: { enabled: true, allocation: 10, locations: ['Acceso general MTY'] },
    api: { enabled: true, allocation: 4 },
    promoter: { enabled: true, allocation: 10, commissionRate: 0.1 },
    affiliate: { enabled: true, allocation: 8, partners: ['influencer-demo'] },
    phone: { enabled: true, allocation: 2 },
    corporate: { enabled: true, allocation: 2 },
    courtesy: { enabled: true, allocation: 1 },
    invitation: { enabled: true, allocation: 3 },
    vip: { enabled: true, allocation: 2 },
    resale: { enabled: true, allocation: 2, feePercent: 15 },
    admin: { enabled: true, allocation: 1 },
  },
};

for (const [slug, slots] of Object.entries(DEMO_EVENT_CHANNEL_CONFIGS)) {
  assertChannelAllocation(slots, slug);
}

type DemoOrderSpec = {
  publicId: string;
  eventSlug: string;
  channel: SalesChannel;
  totalAmount: number;
  daysAgo: number;
  buyerName: string;
  buyerEmail: string;
};

const DEMO_CHANNEL_ORDERS: DemoOrderSpec[] = [
  { publicId: 'SEED-ORD-WEB-001', eventSlug: 'concierto-demo-2026', channel: SalesChannel.WEB, totalAmount: 1600, daysAgo: 0, buyerName: 'Laura Vega', buyerEmail: 'laura.vega@example.com' },
  { publicId: 'SEED-ORD-MOBILE-001', eventSlug: 'concierto-demo-2026', channel: SalesChannel.MOBILE, totalAmount: 2400, daysAgo: 0, buyerName: 'Diego Ruiz', buyerEmail: 'diego.ruiz@example.com' },
  { publicId: 'SEED-ORD-TAQUILLA-001', eventSlug: 'clasico-regio', channel: SalesChannel.TAQUILLA, totalAmount: 3300, daysAgo: 0, buyerName: 'Familia Ortiz', buyerEmail: 'ortiz@example.com' },
  { publicId: 'SEED-ORD-API-001', eventSlug: 'festival-verano-mty', channel: SalesChannel.API, totalAmount: 3960, daysAgo: 0, buyerName: 'Partner API', buyerEmail: 'api.partner@example.com' },
  { publicId: 'SEED-ORD-ADMIN-001', eventSlug: 'concierto-demo-2026', channel: SalesChannel.ADMIN, totalAmount: 800, daysAgo: 1, buyerName: 'Backoffice Demo', buyerEmail: 'admin@demo.boletera.com' },
  { publicId: 'SEED-ORD-PROMOTER-001', eventSlug: 'concierto-demo-2026', channel: SalesChannel.PROMOTER, totalAmount: 1200, daysAgo: 2, buyerName: 'Promotor Ana', buyerEmail: 'promotor@demo.boletera.com' },
  { publicId: 'SEED-ORD-COURTESY-001', eventSlug: 'clasico-regio', channel: SalesChannel.COURTESY, totalAmount: 0, daysAgo: 3, buyerName: 'Prensa Local', buyerEmail: 'prensa@example.com' },
  { publicId: 'SEED-ORD-CORPORATE-001', eventSlug: 'clasico-regio', channel: SalesChannel.CORPORATE, totalAmount: 8800, daysAgo: 4, buyerName: 'Grupo Regio SA', buyerEmail: 'compras@gruporegio.mx' },
  { publicId: 'SEED-ORD-MOBILE-002', eventSlug: 'festival-verano-mty', channel: SalesChannel.MOBILE, totalAmount: 1980, daysAgo: 5, buyerName: 'Sofía N.', buyerEmail: 'sofia.n@example.com' },
  { publicId: 'SEED-ORD-PHONE-001', eventSlug: 'concierto-demo-2026', channel: SalesChannel.PHONE, totalAmount: 1600, daysAgo: 6, buyerName: 'Call center #42', buyerEmail: 'callcenter@example.com' },
  { publicId: 'SEED-ORD-INVITATION-001', eventSlug: 'festival-verano-mty', channel: SalesChannel.INVITATION, totalAmount: 990, daysAgo: 7, buyerName: 'Invitado VIP', buyerEmail: 'invitado@example.com' },
  { publicId: 'SEED-ORD-AFFILIATE-001', eventSlug: 'festival-verano-mty', channel: SalesChannel.AFFILIATE, totalAmount: 2970, daysAgo: 8, buyerName: 'Afiliado Jorge', buyerEmail: 'afiliado@demo.boletera.com' },
  { publicId: 'SEED-ORD-VIP-001', eventSlug: 'clasico-regio', channel: SalesChannel.VIP, totalAmount: 4320, daysAgo: 9, buyerName: 'Club Palco', buyerEmail: 'palco@example.com' },
  { publicId: 'SEED-ORD-RESALE-001', eventSlug: 'concierto-demo-2026', channel: SalesChannel.RESALE, totalAmount: 920, daysAgo: 10, buyerName: 'Reventa segura', buyerEmail: 'resale@example.com' },
  { publicId: 'SEED-ORD-WEB-002', eventSlug: 'noche-indie-cdmx', channel: SalesChannel.WEB, totalAmount: 900, daysAgo: 12, buyerName: 'Marco P.', buyerEmail: 'marco.p@example.com' },
  { publicId: 'SEED-ORD-TAQUILLA-002', eventSlug: 'stand-up-gdl', channel: SalesChannel.TAQUILLA, totalAmount: 640, daysAgo: 14, buyerName: 'Walk-in GDL', buyerEmail: 'walkin@example.com' },
];

async function seedDemoChannelOrders(
  orgId: string,
  userId: string,
  eventsBySlug: Map<string, { id: string }>,
) {
  for (const spec of DEMO_CHANNEL_ORDERS) {
    const event = eventsBySlug.get(spec.eventSlug);
    if (!event) continue;

    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - spec.daysAgo);
    createdAt.setHours(12, 0, 0, 0);

    const subtotal = spec.totalAmount;
    const fees = 0;
    const taxAmount = 0;
    const commissionAmount = Math.round(subtotal * 0.15 * 100) / 100;

    await prisma.order.upsert({
      where: { publicId: spec.publicId },
      update: {
        organizationId: orgId,
        eventId: event.id,
        userId,
        status: OrderStatus.COMPLETED,
        channel: spec.channel,
        buyerName: spec.buyerName,
        buyerEmail: spec.buyerEmail,
        subtotal,
        fees,
        taxAmount,
        totalAmount: spec.totalAmount,
        commissionAmount,
        currency: Currency.MXN,
        completedAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      },
      create: {
        publicId: spec.publicId,
        organizationId: orgId,
        eventId: event.id,
        userId,
        status: OrderStatus.COMPLETED,
        channel: spec.channel,
        buyerName: spec.buyerName,
        buyerEmail: spec.buyerEmail,
        subtotal,
        fees,
        taxAmount,
        totalAmount: spec.totalAmount,
        commissionAmount,
        currency: Currency.MXN,
        completedAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  }
}

type DemoUserSpec = {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
};

async function upsertDemoUsers(orgId: string, passwordHash: string, users: readonly DemoUserSpec[]) {
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, organizationId: orgId },
      create: {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        password: passwordHash,
        role: u.role,
        organizationId: orgId,
        emailVerified: true,
      },
    });
  }
}

type PartnerRef = { email: string; refCode: string; commissionRate?: number };

async function assignPartnerRefCodes(
  orgId: string,
  partners: { promoters?: PartnerRef[]; affiliates?: PartnerRef[] },
) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  const current = (org?.settings as Record<string, unknown> | null) ?? {};
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      settings: {
        ...current,
        ...(partners.promoters ? { promoters: partners.promoters } : {}),
        ...(partners.affiliates ? { affiliates: partners.affiliates } : {}),
      },
    },
  });
}

async function markEventSoldOut(eventId: string) {
  await prisma.ticket.updateMany({
    where: { eventId, status: TicketStatus.AVAILABLE },
    data: { status: TicketStatus.SOLD },
  });
  await prisma.offer.updateMany({
    where: { eventId },
    data: { remainingQuantity: 0, isAvailable: false },
  });
}

async function markPartialSales(eventId: string, soldRatio: number) {
  const tickets = await prisma.ticket.findMany({
    where: { eventId, status: TicketStatus.AVAILABLE },
    orderBy: { id: 'asc' },
  });
  const toSell = Math.max(1, Math.floor(tickets.length * soldRatio));
  const sellIds = tickets.slice(0, toSell).map((t) => t.id);
  await prisma.ticket.updateMany({
    where: { id: { in: sellIds } },
    data: { status: TicketStatus.SOLD },
  });
  const offers = await prisma.offer.findMany({ where: { eventId } });
  for (const offer of offers) {
    const remaining = await prisma.ticket.count({
      where: { offerId: offer.id, status: TicketStatus.AVAILABLE },
    });
    await prisma.offer.update({
      where: { id: offer.id },
      data: { remainingQuantity: remaining, isAvailable: remaining > 0 },
    });
  }
}

async function seedWaitlistEntries(
  eventId: string,
  entries: Array<{
    email: string;
    firstName?: string;
    lastName?: string;
    quantity?: number;
    priority?: number;
  }>,
) {
  for (const entry of entries) {
    await prisma.waitlistEntry.upsert({
      where: { eventId_email: { eventId, email: entry.email } },
      update: {
        firstName: entry.firstName,
        lastName: entry.lastName,
        quantity: entry.quantity ?? 1,
        priority: entry.priority ?? 0,
        status: WaitlistStatus.PENDING,
      },
      create: {
        eventId,
        email: entry.email,
        firstName: entry.firstName,
        lastName: entry.lastName,
        quantity: entry.quantity ?? 1,
        priority: entry.priority ?? 0,
        status: WaitlistStatus.PENDING,
      },
    });
  }
}

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(20, 0, 0, 0);
  return d;
};

const STOCK_IMG = {
  demo: EVENT_STOCK_IMAGES.MUSIC,
  indie: EVENT_STOCK_IMAGES.MUSIC_INDIE,
  standup: EVENT_STOCK_IMAGES.COMEDY,
  obra: EVENT_STOCK_IMAGES.THEATER,
  clasico: EVENT_STOCK_IMAGES.SPORTS,
  verano: EVENT_STOCK_IMAGES.FESTIVAL,
  electro: EVENT_STOCK_IMAGES.ELECTRO,
  ballet: EVENT_STOCK_IMAGES.BALLET,
  final: EVENT_STOCK_IMAGES.SPORTS,
  comedia: EVENT_STOCK_IMAGES.COMEDY,
  jazz: EVENT_STOCK_IMAGES.JAZZ,
  openair: EVENT_STOCK_IMAGES.OPEN_AIR,
  experience: EVENT_STOCK_IMAGES.EXPERIENCE,
};

type EnsureEventOpts = {
  organizationId: string;
  slug: string;
  title: string;
  description: string;
  category: 'MUSIC' | 'SPORTS' | 'THEATER' | 'COMEDY' | 'FESTIVAL';
  venueId: string;
  startsAt: Date;
  price: number;
  withSeats?: boolean;
  offerName?: string;
  image?: string;
  layoutId: string;
  snapshot: SeatMapData;
  posterAspect?: string;
  channels?: Record<string, ChannelSlotSeed>;
  status?: EventStatus;
  publishedAt?: Date | null;
  seriesId?: string;
  seriesOrder?: number;
  extraMetadata?: Record<string, unknown>;
};

async function ensureEvent(opts: EnsureEventOpts) {
  const slugKey = opts.slug.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-16);
  const totalSeats = opts.snapshot.sections.reduce((n, s) => n + s.seats.length, 0);
  const channelSlots = opts.channels ?? DEMO_EVENT_CHANNEL_CONFIGS[opts.slug];
  const meta: Record<string, unknown> = {
    posterAspect: opts.posterAspect ?? '3/4',
    ...(opts.extraMetadata ?? {}),
  };
  if (channelSlots) {
    meta.channels = channelSlots;
    meta.channelConfiguredAt = new Date().toISOString();
  }
  const status = opts.status ?? EventStatus.SCHEDULED;
  const publishedAt =
    opts.publishedAt !== undefined
      ? opts.publishedAt
      : status === EventStatus.SCHEDULED
        ? new Date()
        : null;

  const event = await prisma.event.upsert({
    where: { slug: opts.slug },
    update: {
      organizationId: opts.organizationId,
      title: opts.title,
      description: opts.description,
      category: opts.category,
      venueId: opts.venueId,
      startsAt: opts.startsAt,
      status,
      publishedAt,
      minPrice: opts.price,
      maxPrice: opts.price * 2,
      image: opts.image,
      bannerImage: opts.image,
      totalCapacity: totalSeats || 80,
      seriesId: opts.seriesId,
      seriesOrder: opts.seriesOrder,
      metadata: meta,
    },
    create: {
      organizationId: opts.organizationId,
      venueId: opts.venueId,
      title: opts.title,
      description: opts.description,
      slug: opts.slug,
      category: opts.category,
      startsAt: opts.startsAt,
      timezone: 'America/Mexico_City',
      status,
      publishedAt,
      totalCapacity: totalSeats || 80,
      minPrice: opts.price,
      maxPrice: opts.price * 2,
      currency: Currency.MXN,
      image: opts.image,
      bannerImage: opts.image,
      seriesId: opts.seriesId,
      seriesOrder: opts.seriesOrder,
      metadata: meta,
    },
  });

  await prisma.eventSeatMap.upsert({
    where: { eventId: event.id },
    create: {
      eventId: event.id,
      layoutId: opts.layoutId,
      snapshotData: opts.snapshot as object,
      publishedAt: publishedAt ?? new Date(),
    },
    update: {
      layoutId: opts.layoutId,
      snapshotData: opts.snapshot as object,
      publishedAt: publishedAt ?? new Date(),
    },
  });

  await prisma.ticket.deleteMany({ where: { eventId: event.id } });
  await prisma.seatHold.deleteMany({ where: { eventId: event.id } }).catch(() => undefined);

  if (opts.withSeats !== false && opts.snapshot.sections.length) {
    for (const section of opts.snapshot.sections) {
      const tier = section.seats[0]?.tier ?? 'standard';
      const priceMul = tier === 'premium' ? 1.4 : tier === 'economy' ? 0.75 : 1;
      const price = Math.round(opts.price * priceMul);
      const qty = section.seats.length;
      const offer = await prisma.offer.upsert({
        where: { eventId_zone: { eventId: event.id, zone: section.slug } },
        update: {
          name: section.name,
          basePrice: price,
          totalQuantity: qty,
          remainingQuantity: qty,
          isAvailable: true,
        },
        create: {
          eventId: event.id,
          name: section.name,
          zone: section.slug,
          basePrice: price,
          totalQuantity: qty,
          remainingQuantity: qty,
          startDate: new Date(),
          endDate: opts.startsAt,
          isAvailable: true,
        },
      });

      for (const seat of section.seats) {
        const seatExists = await prisma.seat.findUnique({ where: { id: seat.id } });
        await prisma.ticket.create({
          data: {
            code: `TKT-${slugKey}-${seat.id.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase()}`,
            eventId: event.id,
            offerId: offer.id,
            status: TicketStatus.AVAILABLE,
            seatId: seatExists ? seat.id : undefined,
            seatNumber: seat.label.includes('-') ? seat.label.split('-').pop() : seat.label,
            row: seat.row || 'A',
            section: section.name,
          },
        });
      }
    }
  } else {
    const gaQty = 120;
    const offer = await prisma.offer.upsert({
      where: { eventId_zone: { eventId: event.id, zone: 'ga' } },
      update: {
        name: opts.offerName ?? 'General',
        basePrice: opts.price,
        totalQuantity: gaQty,
        remainingQuantity: gaQty,
        isAvailable: true,
      },
      create: {
        eventId: event.id,
        name: opts.offerName ?? 'General',
        zone: 'ga',
        basePrice: opts.price,
        totalQuantity: gaQty,
        remainingQuantity: gaQty,
        startDate: new Date(),
        endDate: opts.startsAt,
      },
    });
    for (let i = 1; i <= gaQty; i++) {
      await prisma.ticket.create({
        data: {
          code: `GA-${slugKey}-${String(i).padStart(3, '0')}`,
          eventId: event.id,
          offerId: offer.id,
          status: TicketStatus.AVAILABLE,
          seatNumber: String(i),
          row: 'GA',
          section: 'GA',
        },
      });
    }
  }

  return event;
}

async function ensureEventSeries(opts: {
  organizationId: string;
  slug: string;
  name: string;
  description?: string;
  venueId: string;
  kind?: EventSeriesKind;
  category?: 'MUSIC' | 'SPORTS' | 'THEATER' | 'COMEDY' | 'FESTIVAL';
}) {
  return prisma.eventSeries.upsert({
    where: { slug: opts.slug },
    update: {
      name: opts.name,
      description: opts.description,
      venueId: opts.venueId,
      kind: opts.kind ?? EventSeriesKind.SERIES,
      status: EventSeriesStatus.ACTIVE,
      category: opts.category ?? 'MUSIC',
    },
    create: {
      organizationId: opts.organizationId,
      venueId: opts.venueId,
      name: opts.name,
      slug: opts.slug,
      description: opts.description,
      kind: opts.kind ?? EventSeriesKind.SERIES,
      status: EventSeriesStatus.ACTIVE,
      category: opts.category ?? 'MUSIC',
      timezone: 'America/Mexico_City',
    },
  });
}

async function persistLayoutFromTemplate(
  venueId: string,
  name: string,
  template: LayoutTemplateId,
  opts?: { capacity?: number },
) {
  const mapData = generateLayoutTemplate(template, {
    idPrefix: `${venueId.slice(-8)}-${template}`,
    capacity: opts?.capacity,
  });

  let layout = await prisma.venueLayout.findFirst({
    where: { venueId, name },
    include: { sections: { include: { seats: true, rows: true } } },
  });

  if (!layout) {
    layout = await prisma.venueLayout.create({
      data: {
        venueId,
        name,
        isActive: true,
        mapData: mapData as object,
      },
      include: { sections: { include: { seats: true, rows: true } } },
    });
  }

  // Replace sections/seats for deterministic demo maps
  await prisma.seat.deleteMany({ where: { section: { layoutId: layout.id } } });
  await prisma.seatRow.deleteMany({ where: { section: { layoutId: layout.id } } });
  await prisma.section.deleteMany({ where: { layoutId: layout.id } });

  for (let i = 0; i < mapData.sections.length; i++) {
    const sec = mapData.sections[i];
    const section = await prisma.section.create({
      data: {
        id: sec.id,
        layoutId: layout.id,
        name: sec.name,
        slug: sec.slug,
        color: sec.color,
        sortOrder: i,
      },
    });

    const rowLabels = Array.from(
      new Set(sec.seats.map((s) => s.row || s.label.split('-')[0] || 'A')),
    );
    const rowIds = new Map<string, string>();
    for (let ri = 0; ri < rowLabels.length; ri++) {
      const row = await prisma.seatRow.create({
        data: { sectionId: section.id, label: rowLabels[ri], sortOrder: ri },
      });
      rowIds.set(rowLabels[ri], row.id);
    }

    for (const seat of sec.seats) {
      const rowLabel = seat.row || seat.label.split('-')[0] || 'A';
      await prisma.seat.create({
        data: {
          id: seat.id,
          sectionId: section.id,
          rowId: rowIds.get(rowLabel),
          label: seat.label,
          x: seat.x,
          y: seat.y,
          rotation: seat.rotation ?? 0,
          tier: seat.tier ?? 'standard',
        },
      });
    }
  }

  const refreshed = await prisma.venueLayout.findFirstOrThrow({
    where: { id: layout.id },
    include: { sections: { include: { seats: { include: { row: true } } }, orderBy: { sortOrder: 'asc' } } },
  });

  const snapshot: SeatMapData = {
    version: 2,
    sections: refreshed.sections.map((sec) => ({
      id: sec.id,
      name: sec.name,
      slug: sec.slug,
      color: sec.color,
      seats: sec.seats.map((s) => ({
        id: s.id,
        label: s.label,
        x: s.x,
        y: s.y,
        rotation: s.rotation,
        tier: s.tier ?? 'standard',
        row: s.row?.label ?? s.label.split('-')[0],
      })),
    })),
    viewport: mapData.viewport,
  };

  await prisma.venueLayout.update({
    where: { id: layout.id },
    data: { mapData: snapshot as object, isActive: true },
  });

  return { layout: refreshed, snapshot };
}

const ARENA_NORTE_CHANNEL_CONFIG: Record<string, ChannelSlotSeed> = {
  web: { enabled: true, allocation: 40 },
  mobile: { enabled: true, allocation: 18 },
  taquilla: { enabled: true, allocation: 15, locations: ['Arena Norte — taquilla principal'] },
  api: { enabled: true, allocation: 4 },
  promoter: { enabled: true, allocation: 8, commissionRate: 0.1, partners: ['AN-PROMO-01'] },
  affiliate: { enabled: true, allocation: 5, partners: ['AN-AFF-01'] },
  phone: { enabled: true, allocation: 3, hours: '11:00–19:00' },
  corporate: { enabled: true, allocation: 2, contactEmail: 'corporativo@arena-norte.mx' },
  courtesy: { enabled: true, allocation: 1 },
  invitation: { enabled: true, allocation: 2 },
  vip: { enabled: true, allocation: 1 },
  resale: { enabled: true, allocation: 1, feePercent: 12 },
  admin: { enabled: false, allocation: 0 },
};
assertChannelAllocation(ARENA_NORTE_CHANNEL_CONFIG, 'rock-sold-out-mty');

const TEATRO_CAPITAL_CHANNEL_CONFIG: Record<string, ChannelSlotSeed> = {
  web: { enabled: true, allocation: 45 },
  mobile: { enabled: true, allocation: 12 },
  taquilla: { enabled: true, allocation: 18, locations: ['Teatro Capital — lobby'] },
  api: { enabled: true, allocation: 3 },
  promoter: { enabled: true, allocation: 6, commissionRate: 0.07, partners: ['TC-PROMO-01'] },
  affiliate: { enabled: true, allocation: 4, partners: ['TC-AFF-01'] },
  phone: { enabled: true, allocation: 4, hours: '10:00–18:00' },
  corporate: { enabled: true, allocation: 3, contactEmail: 'patrocinios@teatro-capital.mx' },
  courtesy: { enabled: true, allocation: 2 },
  invitation: { enabled: true, allocation: 1 },
  vip: { enabled: true, allocation: 1 },
  resale: { enabled: true, allocation: 1, feePercent: 10 },
  admin: { enabled: false, allocation: 0 },
};
assertChannelAllocation(TEATRO_CAPITAL_CHANNEL_CONFIG, 'musical-temporada-capital');

async function seedArenaNorte(passwordHash: string) {
  const org = await prisma.organization.upsert({
    where: { slug: 'arena-norte' },
    update: { verified: true },
    create: {
      name: 'Arena Norte',
      slug: 'arena-norte',
      email: 'admin@arena-norte.mx',
      country: 'MX',
      timezone: 'America/Mexico_City',
      currency: Currency.MXN,
      type: OrgType.VENUE,
      verified: true,
      tenantTheme: {
        create: {
          primaryColor: '#0f172a',
          secondaryColor: '#38bdf8',
          subdomain: 'arena-norte',
        },
      },
    },
  });

  const demoUsers = [
    { email: 'admin@arena-norte.mx', firstName: 'Patricia', lastName: 'Norte', role: UserRole.SUPER_ADMIN },
    { email: 'taquilla@arena-norte.mx', firstName: 'Roberto', lastName: 'Taquilla', role: UserRole.TAQUILLA },
    { email: 'promotor@arena-norte.mx', firstName: 'Elena', lastName: 'Promotora', role: UserRole.PROMOTER },
    { email: 'afiliado@arena-norte.mx', firstName: 'Miguel', lastName: 'Afiliado', role: UserRole.AFFILIATE },
    { email: 'scanner@arena-norte.mx', firstName: 'Sandra', lastName: 'Accesos', role: UserRole.SCANNER },
    { email: 'comprador@arena-norte.mx', firstName: 'Cliente', lastName: 'Norte', role: UserRole.CUSTOMER },
  ] as const;
  await upsertDemoUsers(org.id, passwordHash, demoUsers);
  await assignPartnerRefCodes(org.id, {
    promoters: [{ email: 'promotor@arena-norte.mx', refCode: 'AN-PROMO-01', commissionRate: 0.1 }],
    affiliates: [{ email: 'afiliado@arena-norte.mx', refCode: 'AN-AFF-01', commissionRate: 0.05 }],
  });

  const venue = await prisma.venue.upsert({
    where: { slug: 'arena-norte-mty' },
    update: { totalCapacity: 450 },
    create: {
      organizationId: org.id,
      name: 'Arena Norte Monterrey',
      slug: 'arena-norte-mty',
      address: 'Av. Morones Prieto 4500',
      city: 'Monterrey',
      state: 'NL',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 450,
      generalSeats: 450,
    },
  });

  const arenaLayout = await persistLayoutFromTemplate(venue.id, 'Layout Arena Norte', 'arena', {
    capacity: 180,
  });
  const stadiumLayout = await persistLayoutFromTemplate(venue.id, 'Layout Estadio Norte', 'stadium', {
    capacity: 220,
  });

  const soldOutEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'rock-sold-out-mty',
    title: 'Rock Sold Out — Arena Norte',
    description: 'Concierto agotado al 100%. Escenario para probar estado sold-out y reventa.',
    category: 'MUSIC',
    venueId: venue.id,
    startsAt: inDays(14),
    price: 950,
    image: STOCK_IMG.demo,
    layoutId: arenaLayout.layout.id,
    snapshot: arenaLayout.snapshot,
    channels: ARENA_NORTE_CHANNEL_CONFIG,
    extraMetadata: { eventKind: 'single', scenario: 'sold-out' },
  });
  await markEventSoldOut(soldOutEvent.id);

  const partialEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'liga-norte-j12',
    title: 'Liga Norte — Jornada 12',
    description: 'Partido con ~55% de aforo vendido. Mix de canales taquilla y web.',
    category: 'SPORTS',
    venueId: venue.id,
    startsAt: inDays(7),
    price: 480,
    image: STOCK_IMG.clasico,
    layoutId: stadiumLayout.layout.id,
    snapshot: stadiumLayout.snapshot,
    extraMetadata: { eventKind: 'single', scenario: 'partial-sales' },
  });
  await markPartialSales(partialEvent.id, 0.55);

  const waitlistEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'concierto-waitlist-mty',
    title: 'Pop Estelar — Lista de Espera',
    description: 'Show agotado con lista de espera activa. Ideal para probar notificaciones waitlist.',
    category: 'MUSIC',
    venueId: venue.id,
    startsAt: inDays(10),
    price: 1200,
    image: STOCK_IMG.indie,
    layoutId: arenaLayout.layout.id,
    snapshot: arenaLayout.snapshot,
    extraMetadata: { eventKind: 'single', scenario: 'waitlist', waitlistEnabled: true },
  });
  await markEventSoldOut(waitlistEvent.id);
  await seedWaitlistEntries(waitlistEvent.id, [
    { email: 'espera1@example.com', firstName: 'Valeria', lastName: 'López', quantity: 2, priority: 10 },
    { email: 'espera2@example.com', firstName: 'Héctor', lastName: 'Mora', quantity: 1, priority: 5 },
    { email: 'espera3@example.com', firstName: 'Renata', lastName: 'Vega', quantity: 4, priority: 0 },
    { email: 'espera4@example.com', firstName: 'Pablo', lastName: 'Soto', quantity: 2, priority: 3 },
  ]);

  const gaEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'festival-urbano-ga-mty',
    title: 'Festival Urbano GA',
    description: 'Admisión general sin mapa de asientos. Acceso por pulsera en puerta.',
    category: 'FESTIVAL',
    venueId: venue.id,
    startsAt: inDays(16),
    price: 650,
    withSeats: false,
    offerName: 'Pista General',
    image: STOCK_IMG.openair,
    layoutId: arenaLayout.layout.id,
    snapshot: { version: 2, sections: [], viewport: { x: 0, y: 0, zoom: 1 } },
    posterAspect: '16/9',
    extraMetadata: { eventKind: 'single', scenario: 'ga-only' },
  });
  await markPartialSales(gaEvent.id, 0.35);

  const comedyTour = await ensureEventSeries({
    organizationId: org.id,
    slug: 'comedia-tour-norte',
    name: 'Gira Comedia Norte 2026',
    description: 'Tres fechas en Arena Norte con el mismo show.',
    venueId: venue.id,
    kind: EventSeriesKind.TOUR,
    category: 'COMEDY',
  });

  const tourDates = [inDays(20), inDays(27), inDays(34)];
  const tourEvents = await Promise.all(
    tourDates.map((startsAt, i) =>
      ensureEvent({
        organizationId: org.id,
        slug: `comedia-tour-norte-${i + 1}`,
        title: `Gira Comedia Norte — Fecha ${i + 1}`,
        description: `Función ${i + 1} de la gira. Mismo elenco, distinta noche.`,
        category: 'COMEDY',
        venueId: venue.id,
        startsAt,
        price: 420,
        image: STOCK_IMG.comedia,
        layoutId: arenaLayout.layout.id,
        snapshot: arenaLayout.snapshot,
        seriesId: comedyTour.id,
        seriesOrder: i + 1,
        extraMetadata: { eventKind: 'series', seriesSlug: comedyTour.slug, scenario: 'multi-session' },
      }),
    ),
  );
  await markPartialSales(tourEvents[0].id, 0.7);

  const flagship = await ensureEvent({
    organizationId: org.id,
    slug: 'electro-arena-norte',
    title: 'Electro Arena Norte',
    description: 'Headliner internacional. Canales multi-partner con promotor y afiliado.',
    category: 'MUSIC',
    venueId: venue.id,
    startsAt: inDays(22),
    price: 880,
    image: STOCK_IMG.electro,
    layoutId: arenaLayout.layout.id,
    snapshot: arenaLayout.snapshot,
    channels: ARENA_NORTE_CHANNEL_CONFIG,
    extraMetadata: { eventKind: 'single' },
  });

  const customer = demoUsers.find((u) => u.role === UserRole.CUSTOMER)!;
  const customerUser = await prisma.user.findUniqueOrThrow({ where: { email: customer.email } });
  const eventsBySlug = new Map(
    [soldOutEvent, partialEvent, waitlistEvent, gaEvent, flagship, ...tourEvents].map(
      (e) => [e.slug, { id: e.id }] as const,
    ),
  );

  const extraOrders: DemoOrderSpec[] = [
    { publicId: 'AN-ORD-WEB-001', eventSlug: 'liga-norte-j12', channel: SalesChannel.WEB, totalAmount: 1440, daysAgo: 1, buyerName: 'Familia Garza', buyerEmail: 'garza@example.com' },
    { publicId: 'AN-ORD-TAQUILLA-001', eventSlug: 'liga-norte-j12', channel: SalesChannel.TAQUILLA, totalAmount: 960, daysAgo: 2, buyerName: 'Walk-in MTY', buyerEmail: 'walkin.mty@example.com' },
    { publicId: 'AN-ORD-PROMO-001', eventSlug: 'electro-arena-norte', channel: SalesChannel.PROMOTER, totalAmount: 1760, daysAgo: 3, buyerName: 'Promo Elena', buyerEmail: 'promotor@arena-norte.mx' },
    { publicId: 'AN-ORD-AFF-001', eventSlug: 'festival-urbano-ga-mty', channel: SalesChannel.AFFILIATE, totalAmount: 1300, daysAgo: 4, buyerName: 'Afiliado Miguel', buyerEmail: 'afiliado@arena-norte.mx' },
  ];
  for (const spec of extraOrders) {
    const event = eventsBySlug.get(spec.eventSlug);
    if (!event) continue;
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - spec.daysAgo);
    await prisma.order.upsert({
      where: { publicId: spec.publicId },
      update: {
        organizationId: org.id,
        eventId: event.id,
        userId: customerUser.id,
        status: OrderStatus.COMPLETED,
        channel: spec.channel,
        buyerName: spec.buyerName,
        buyerEmail: spec.buyerEmail,
        subtotal: spec.totalAmount,
        fees: 0,
        taxAmount: 0,
        totalAmount: spec.totalAmount,
        commissionAmount: Math.round(spec.totalAmount * 0.12 * 100) / 100,
        currency: Currency.MXN,
        completedAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      },
      create: {
        publicId: spec.publicId,
        organizationId: org.id,
        eventId: event.id,
        userId: customerUser.id,
        status: OrderStatus.COMPLETED,
        channel: spec.channel,
        buyerName: spec.buyerName,
        buyerEmail: spec.buyerEmail,
        subtotal: spec.totalAmount,
        fees: 0,
        taxAmount: 0,
        totalAmount: spec.totalAmount,
        commissionAmount: Math.round(spec.totalAmount * 0.12 * 100) / 100,
        currency: Currency.MXN,
        completedAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  }

  return {
    org,
    demoUsers,
    events: {
      soldOut: soldOutEvent.slug,
      partialSales: partialEvent.slug,
      waitlist: waitlistEvent.slug,
      gaOnly: gaEvent.slug,
      multiSession: tourEvents.map((e) => e.slug),
      flagship: flagship.slug,
    },
    waitlistEntries: 4,
    orders: extraOrders.length,
  };
}

async function seedTeatroCapital(passwordHash: string) {
  const org = await prisma.organization.upsert({
    where: { slug: 'teatro-capital' },
    update: { verified: true },
    create: {
      name: 'Teatro Capital',
      slug: 'teatro-capital',
      email: 'admin@teatro-capital.mx',
      country: 'MX',
      timezone: 'America/Mexico_City',
      currency: Currency.MXN,
      type: OrgType.PROMOTER,
      verified: true,
      tenantTheme: {
        create: {
          primaryColor: '#4c1d95',
          secondaryColor: '#c4b5fd',
          subdomain: 'teatro-capital',
        },
      },
    },
  });

  const demoUsers = [
    { email: 'admin@teatro-capital.mx', firstName: 'Claudia', lastName: 'Capital', role: UserRole.SUPER_ADMIN },
    { email: 'finanzas@teatro-capital.mx', firstName: 'Andrés', lastName: 'Finanzas', role: UserRole.FINANCE },
    { email: 'promotor@teatro-capital.mx', firstName: 'Lucía', lastName: 'Promotora', role: UserRole.PROMOTER },
    { email: 'afiliado@teatro-capital.mx', firstName: 'Tomás', lastName: 'Afiliado', role: UserRole.AFFILIATE },
    { email: 'scanner@teatro-capital.mx', firstName: 'Paola', lastName: 'Accesos', role: UserRole.SCANNER },
    { email: 'comprador@teatro-capital.mx', firstName: 'Cliente', lastName: 'Capital', role: UserRole.CUSTOMER },
  ] as const;
  await upsertDemoUsers(org.id, passwordHash, demoUsers);
  await assignPartnerRefCodes(org.id, {
    promoters: [{ email: 'promotor@teatro-capital.mx', refCode: 'TC-PROMO-01', commissionRate: 0.07 }],
    affiliates: [{ email: 'afiliado@teatro-capital.mx', refCode: 'TC-AFF-01', commissionRate: 0.04 }],
  });

  const venue = await prisma.venue.upsert({
    where: { slug: 'teatro-capital-cdmx' },
    update: { totalCapacity: 320 },
    create: {
      organizationId: org.id,
      name: 'Teatro Capital',
      slug: 'teatro-capital-cdmx',
      address: 'Av. Insurgentes Sur 1235',
      city: 'Ciudad de México',
      state: 'CDMX',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 320,
      generalSeats: 320,
    },
  });

  const theaterLayout = await persistLayoutFromTemplate(venue.id, 'Layout Teatro Capital', 'theater', {
    capacity: 150,
  });

  const privateEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'gala-privada-capital',
    title: 'Gala Privada de Beneficencia',
    description: 'Evento oculto del catálogo público. Solo acceso con invitación o código.',
    category: 'THEATER',
    venueId: venue.id,
    startsAt: inDays(8),
    price: 2500,
    image: STOCK_IMG.obra,
    layoutId: theaterLayout.layout.id,
    snapshot: theaterLayout.snapshot,
    status: EventStatus.DRAFT,
    publishedAt: null,
    extraMetadata: {
      eventKind: 'single',
      scenario: 'private-hidden',
      visibility: 'private',
      accessCode: 'GALA-INVITE-2026',
    },
  });

  const partialEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'musical-temporada-capital',
    title: 'Musical de Temporada',
    description: 'Temporada en curso con ~42% vendido. Canales web, taquilla y corporativo.',
    category: 'THEATER',
    venueId: venue.id,
    startsAt: inDays(12),
    price: 680,
    image: STOCK_IMG.ballet,
    layoutId: theaterLayout.layout.id,
    snapshot: theaterLayout.snapshot,
    channels: TEATRO_CAPITAL_CHANNEL_CONFIG,
    extraMetadata: { eventKind: 'single', scenario: 'partial-sales' },
  });
  await markPartialSales(partialEvent.id, 0.42);

  const gaEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'microteatro-ga-capital',
    title: 'Microteatro — Noche Abierta',
    description: 'Admisión general sin numeración. Cupo limitado en sala íntima.',
    category: 'COMEDY',
    venueId: venue.id,
    startsAt: inDays(5),
    price: 280,
    withSeats: false,
    offerName: 'Entrada General',
    image: STOCK_IMG.comedia,
    layoutId: theaterLayout.layout.id,
    snapshot: { version: 2, sections: [], viewport: { x: 0, y: 0, zoom: 1 } },
    posterAspect: '4/5',
    extraMetadata: { eventKind: 'single', scenario: 'ga-only' },
  });

  const residency = await ensureEventSeries({
    organizationId: org.id,
    slug: 'residencia-drama-capital',
    name: 'Residencia Drama Capital 2026',
    description: 'Cuatro funciones semanales del mismo montaje.',
    venueId: venue.id,
    kind: EventSeriesKind.RESIDENCY,
    category: 'THEATER',
  });

  const residencyDates = [inDays(6), inDays(13), inDays(20), inDays(27)];
  const residencyEvents = await Promise.all(
    residencyDates.map((startsAt, i) =>
      ensureEvent({
        organizationId: org.id,
        slug: `residencia-drama-capital-${i + 1}`,
        title: `Residencia Drama — Función ${i + 1}`,
        description: `Función ${i + 1} de la residencia. Mismo elenco, distinta noche.`,
        category: 'THEATER',
        venueId: venue.id,
        startsAt,
        price: 520,
        image: STOCK_IMG.obra,
        layoutId: theaterLayout.layout.id,
        snapshot: theaterLayout.snapshot,
        seriesId: residency.id,
        seriesOrder: i + 1,
        extraMetadata: { eventKind: 'residency', seriesSlug: residency.slug, scenario: 'multi-session' },
      }),
    ),
  );
  await markPartialSales(residencyEvents[0].id, 0.85);
  await markPartialSales(residencyEvents[1].id, 0.5);

  const waitlistEvent = await ensureEvent({
    organizationId: org.id,
    slug: 'obra-waitlist-capital',
    title: 'Estreno Exclusivo — Lista de Espera',
    description: 'Estreno agotado. Cola de espera con prioridad para suscriptores.',
    category: 'THEATER',
    venueId: venue.id,
    startsAt: inDays(15),
    price: 890,
    image: STOCK_IMG.jazz,
    layoutId: theaterLayout.layout.id,
    snapshot: theaterLayout.snapshot,
    extraMetadata: { eventKind: 'single', scenario: 'waitlist', waitlistEnabled: true },
  });
  await markEventSoldOut(waitlistEvent.id);
  await seedWaitlistEntries(waitlistEvent.id, [
    { email: 'suscriptor1@example.com', firstName: 'Diana', lastName: 'Reyes', quantity: 2, priority: 20 },
    { email: 'suscriptor2@example.com', firstName: 'Fernando', lastName: 'Castro', quantity: 1, priority: 15 },
    { email: 'suscriptor3@example.com', firstName: 'Isabel', lastName: 'Núñez', quantity: 2, priority: 8 },
  ]);

  const customer = demoUsers.find((u) => u.role === UserRole.CUSTOMER)!;
  const customerUser = await prisma.user.findUniqueOrThrow({ where: { email: customer.email } });
  const eventsBySlug = new Map(
    [privateEvent, partialEvent, gaEvent, waitlistEvent, ...residencyEvents].map(
      (e) => [e.slug, { id: e.id }] as const,
    ),
  );

  const extraOrders: DemoOrderSpec[] = [
    { publicId: 'TC-ORD-WEB-001', eventSlug: 'musical-temporada-capital', channel: SalesChannel.WEB, totalAmount: 1360, daysAgo: 1, buyerName: 'Pareja Méndez', buyerEmail: 'mendez@example.com' },
    { publicId: 'TC-ORD-CORP-001', eventSlug: 'musical-temporada-capital', channel: SalesChannel.CORPORATE, totalAmount: 6800, daysAgo: 5, buyerName: 'Empresa Patrocinadora', buyerEmail: 'patrocinios@teatro-capital.mx' },
    { publicId: 'TC-ORD-PROMO-001', eventSlug: 'residencia-drama-capital-1', channel: SalesChannel.PROMOTER, totalAmount: 1040, daysAgo: 2, buyerName: 'Promo Lucía', buyerEmail: 'promotor@teatro-capital.mx' },
  ];
  for (const spec of extraOrders) {
    const event = eventsBySlug.get(spec.eventSlug);
    if (!event) continue;
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - spec.daysAgo);
    await prisma.order.upsert({
      where: { publicId: spec.publicId },
      update: {
        organizationId: org.id,
        eventId: event.id,
        userId: customerUser.id,
        status: OrderStatus.COMPLETED,
        channel: spec.channel,
        buyerName: spec.buyerName,
        buyerEmail: spec.buyerEmail,
        subtotal: spec.totalAmount,
        fees: 0,
        taxAmount: 0,
        totalAmount: spec.totalAmount,
        commissionAmount: Math.round(spec.totalAmount * 0.1 * 100) / 100,
        currency: Currency.MXN,
        completedAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      },
      create: {
        publicId: spec.publicId,
        organizationId: org.id,
        eventId: event.id,
        userId: customerUser.id,
        status: OrderStatus.COMPLETED,
        channel: spec.channel,
        buyerName: spec.buyerName,
        buyerEmail: spec.buyerEmail,
        subtotal: spec.totalAmount,
        fees: 0,
        taxAmount: 0,
        totalAmount: spec.totalAmount,
        commissionAmount: Math.round(spec.totalAmount * 0.1 * 100) / 100,
        currency: Currency.MXN,
        completedAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  }

  return {
    org,
    demoUsers,
    events: {
      privateHidden: privateEvent.slug,
      partialSales: partialEvent.slug,
      gaOnly: gaEvent.slug,
      waitlist: waitlistEvent.slug,
      multiSession: residencyEvents.map((e) => e.slug),
    },
    waitlistEntries: 3,
    orders: extraOrders.length,
  };
}

async function main() {

  try {
    await seedPermissions(prisma);
  } catch (err) {
    console.warn('seedPermissions skipped (run migrations if Permission tables are missing):', err);
  }

  const passwordHash = await bcrypt.hash('Admin123!', 10);

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-boletera' },
    update: {},
    create: {
      name: 'Demo Boletera',
      slug: 'demo-boletera',
      email: 'admin@demo.boletera.com',
      country: 'MX',
      timezone: 'America/Mexico_City',
      currency: Currency.MXN,
      type: OrgType.BOLETERA,
      verified: true,
      tenantTheme: {
        create: {
          primaryColor: '#171717',
          secondaryColor: '#737373',
          subdomain: 'demo',
          siteContent: defaultSiteContent() as object,
        },
      },
    },
  });

  await prisma.tenantTheme.upsert({
    where: { organizationId: org.id },
    update: { siteContent: defaultSiteContent() as object },
    create: {
      organizationId: org.id,
      primaryColor: '#171717',
      secondaryColor: '#737373',
      subdomain: 'demo',
      siteContent: defaultSiteContent() as object,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.boletera.com' },
    update: {},
    create: {
      email: 'admin@demo.boletera.com',
      firstName: 'Admin',
      lastName: 'Demo',
      password: passwordHash,
      role: UserRole.SUPER_ADMIN,
      organizationId: org.id,
      emailVerified: true,
    },
  });

  const cashier = await prisma.user.upsert({
    where: { email: 'taquilla@demo.boletera.com' },
    update: {},
    create: {
      email: 'taquilla@demo.boletera.com',
      firstName: 'Cajero',
      lastName: 'Demo',
      password: passwordHash,
      role: UserRole.TAQUILLA,
      organizationId: org.id,
      emailVerified: true,
    },
  });

  const demoUsers = [
    {
      email: 'promotor@demo.boletera.com',
      firstName: 'Ana',
      lastName: 'Promotora',
      role: UserRole.PROMOTER,
    },
    {
      email: 'supervisor@demo.boletera.com',
      firstName: 'Luis',
      lastName: 'Supervisor',
      role: UserRole.TAQUILLA_SUPERVISOR,
    },
    {
      email: 'scanner@demo.boletera.com',
      firstName: 'María',
      lastName: 'Accesos',
      role: UserRole.SCANNER,
    },
    {
      email: 'finanzas@demo.boletera.com',
      firstName: 'Carlos',
      lastName: 'Finanzas',
      role: UserRole.FINANCE,
    },
    {
      email: 'afiliado@demo.boletera.com',
      firstName: 'Jorge',
      lastName: 'Afiliado',
      role: UserRole.AFFILIATE,
    },
  ] as const;

  await upsertDemoUsers(org.id, passwordHash, demoUsers);
  await assignPartnerRefCodes(org.id, {
    promoters: [{ email: 'promotor@demo.boletera.com', refCode: 'DEMO-PROMO-01', commissionRate: 0.08 }],
    affiliates: [{ email: 'afiliado@demo.boletera.com', refCode: 'DEMO-AFF-01', commissionRate: 0.05 }],
  });

  const venue = await prisma.venue.upsert({
    where: { slug: 'arena-cdmx' },
    update: { totalCapacity: 500 },
    create: {
      organizationId: org.id,
      name: 'Arena CDMX',
      slug: 'arena-cdmx',
      address: 'Av. Constituyentes 947',
      city: 'Ciudad de México',
      state: 'CDMX',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 500,
      generalSeats: 500,
    },
  });

  const venueGdl = await prisma.venue.upsert({
    where: { slug: 'teatro-degollado' },
    update: { totalCapacity: 280 },
    create: {
      organizationId: org.id,
      name: 'Teatro Degollado',
      slug: 'teatro-degollado',
      address: 'Degollado s/n',
      city: 'Guadalajara',
      state: 'Jalisco',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 280,
      generalSeats: 280,
    },
  });

  const venueMty = await prisma.venue.upsert({
    where: { slug: 'arena-monterrey' },
    update: { totalCapacity: 400 },
    create: {
      organizationId: org.id,
      name: 'Arena Monterrey',
      slug: 'arena-monterrey',
      address: 'Av. Fundidora 501',
      city: 'Monterrey',
      state: 'NL',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 400,
      generalSeats: 400,
    },
  });

  const arena = await persistLayoutFromTemplate(venue.id, 'Layout Arena', 'arena', {
    capacity: 200,
  });
  const theater = await persistLayoutFromTemplate(venueGdl.id, 'Layout Teatro', 'theater', {
    capacity: 160,
  });
  const stadium = await persistLayoutFromTemplate(venueMty.id, 'Layout Estadio', 'stadium', {
    capacity: 280,
  });

  // Festival map stored as alternate active snapshot generator (per-event override)
  const festivalMap = generateLayoutTemplate('festival', {
    idPrefix: `${venue.id.slice(-8)}-fest`,
    capacity: 180,
  });

  const customer = await prisma.user.upsert({
    where: { email: 'comprador@demo.boletera.com' },
    update: {},
    create: {
      email: 'comprador@demo.boletera.com',
      firstName: 'Comprador',
      lastName: 'Demo',
      password: passwordHash,
      role: UserRole.CUSTOMER,
      organizationId: org.id,
      emailVerified: true,
    },
  });

  const event = await ensureEvent({
    organizationId: org.id,
    slug: 'concierto-demo-2026',
    title: 'Concierto Demo 2026',
    description:
      'Show demo con mapa de asientos en vivo. Ideal para probar hold, checkout Banorte y boleto QR.',
    category: 'MUSIC',
    venueId: venue.id,
    startsAt: inDays(28),
    price: 800,
    withSeats: true,
    offerName: 'Sección A',
    image: STOCK_IMG.demo,
    layoutId: arena.layout.id,
    snapshot: arena.snapshot,
    posterAspect: '3/4',
  });

  const catalog = await Promise.all([
    ensureEvent({
      organizationId: org.id,
      slug: 'noche-indie-cdmx',
      title: 'Noche Indie CDMX',
      description: 'Tres bandas emergentes en una noche íntima. Doors 19:00 · show 20:00.',
      category: 'MUSIC',
      venueId: venue.id,
      startsAt: inDays(3),
      price: 450,
      withSeats: true,
      image: STOCK_IMG.indie,
      layoutId: arena.layout.id,
      snapshot: arena.snapshot,
      posterAspect: '3/4',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'stand-up-gdl',
      title: 'Stand-up en Guadalajara',
      description: 'Rutina completa con invitados locales. Edad sugerida 16+.',
      category: 'COMEDY',
      venueId: venueGdl.id,
      startsAt: inDays(5),
      price: 320,
      withSeats: true,
      image: STOCK_IMG.standup,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '4/5',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'obra-clasica-gdl',
      title: 'Obra clásica — Teatro Degollado',
      description: 'Montaje de temporada en el Degollado. Código de vestimenta semi-formal.',
      category: 'THEATER',
      venueId: venueGdl.id,
      startsAt: inDays(12),
      price: 280,
      withSeats: true,
      image: STOCK_IMG.obra,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '2/3',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'clasico-regio',
      title: 'Clásico Regio',
      description: 'Partido de temporada regular. Acceso por torniquete con QR dinámico.',
      category: 'SPORTS',
      venueId: venueMty.id,
      startsAt: inDays(9),
      price: 550,
      withSeats: true,
      image: STOCK_IMG.clasico,
      layoutId: stadium.layout.id,
      snapshot: stadium.snapshot,
      posterAspect: '1/1',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'festival-verano-mty',
      title: 'Festival de Verano MTY',
      description: 'Jornada completa con escenarios principales y food court. Boleto de un día.',
      category: 'FESTIVAL',
      venueId: venueMty.id,
      startsAt: inDays(18),
      price: 990,
      withSeats: true,
      image: STOCK_IMG.verano,
      layoutId: stadium.layout.id,
      snapshot: generateLayoutTemplate('festival', {
        idPrefix: `${venueMty.id.slice(-8)}-fest`,
      }),
      posterAspect: '16/9',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'electro-night-cdmx',
      title: 'Electro Night CDMX',
      description: 'Set continuo hasta tarde. Política de reingreso no aplica.',
      category: 'MUSIC',
      venueId: venue.id,
      startsAt: inDays(6),
      price: 620,
      withSeats: true,
      image: STOCK_IMG.electro,
      layoutId: arena.layout.id,
      snapshot: arena.snapshot,
      posterAspect: '3/4',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'ballet-gdl',
      title: 'Ballet Contemporáneo',
      description: 'Compañía residente. Duración aprox. 95 min con intermedio.',
      category: 'THEATER',
      venueId: venueGdl.id,
      startsAt: inDays(4),
      price: 380,
      withSeats: true,
      image: STOCK_IMG.ballet,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '2/3',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'final-regional-mty',
      title: 'Final Regional',
      description: 'Eliminatoria a partido único. Llegar 60 min antes por filtros de seguridad.',
      category: 'SPORTS',
      venueId: venueMty.id,
      startsAt: inDays(2),
      price: 720,
      withSeats: true,
      image: STOCK_IMG.final,
      layoutId: stadium.layout.id,
      snapshot: stadium.snapshot,
      posterAspect: '1/1',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'comedia-abierta-cdmx',
      title: 'Comedia Abierta',
      description: 'Micrófono abierto + headliner. Barra disponible en venue.',
      category: 'COMEDY',
      venueId: venue.id,
      startsAt: inDays(11),
      price: 250,
      withSeats: true,
      image: STOCK_IMG.comedia,
      layoutId: arena.layout.id,
      snapshot: arena.snapshot,
      posterAspect: '4/5',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'jazz-al-atardecer',
      title: 'Jazz al Atardecer',
      description: 'Quinteto en vivo al atardecer. Asientos numerados limitados.',
      category: 'MUSIC',
      venueId: venueGdl.id,
      startsAt: inDays(15),
      price: 410,
      withSeats: true,
      image: STOCK_IMG.jazz,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '3/4',
    }),
    ensureEvent({
      organizationId: org.id,
      slug: 'open-air-fest-cdmx',
      title: 'Open Air Fest',
      description: 'Festival al aire libre con lineup multi-género. Incluye acceso a zonas comunes.',
      category: 'FESTIVAL',
      venueId: venue.id,
      startsAt: inDays(21),
      price: 1250,
      withSeats: true,
      image: STOCK_IMG.openair,
      layoutId: arena.layout.id,
      snapshot: festivalMap,
      posterAspect: '16/9',
    }),
  ]);

  const eventsBySlug = new Map(
    [event, ...catalog].map((e) => [e.slug, { id: e.id }] as const),
  );
  await seedDemoChannelOrders(org.id, customer.id, eventsBySlug);

  const arenaNorte = await seedArenaNorte(passwordHash);
  const teatroCapital = await seedTeatroCapital(passwordHash);

  const channelConfiguredEvents = Object.keys(DEMO_EVENT_CHANNEL_CONFIGS);

  console.log('Seed OK:', {
    password: 'Admin123!',
    organizations: [
      {
        slug: org.slug,
        admin: admin.email,
        events: [event.slug, ...catalog.map((e) => e.slug)],
        demoChannelOrders: DEMO_CHANNEL_ORDERS.length,
      },
      {
        slug: arenaNorte.org.slug,
        scenarios: arenaNorte.events,
        waitlistEntries: arenaNorte.waitlistEntries,
        orders: arenaNorte.orders,
        credentials: arenaNorte.demoUsers.map((u) => u.email),
      },
      {
        slug: teatroCapital.org.slug,
        scenarios: teatroCapital.events,
        waitlistEntries: teatroCapital.waitlistEntries,
        orders: teatroCapital.orders,
        credentials: teatroCapital.demoUsers.map((u) => u.email),
      },
    ],
    demoBoletera: {
      admin: admin.email,
      cashier: cashier.email,
      customer: customer.email,
      demoUsers: demoUsers.map((u) => `${u.email} (${u.role})`),
      partnerRefs: {
        promoter: 'DEMO-PROMO-01',
        affiliate: 'DEMO-AFF-01',
      },
      channelConfiguredEvents,
      layouts: {
        arena: arena.snapshot.sections.map((s) => `${s.name}:${s.seats.length}`),
        theater: theater.snapshot.sections.map((s) => `${s.name}:${s.seats.length}`),
        stadium: stadium.snapshot.sections.map((s) => `${s.name}:${s.seats.length}`),
      },
    },
  });
}


main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
