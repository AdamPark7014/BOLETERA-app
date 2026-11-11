'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
const client_1 = require('@prisma/client');
const bcrypt = __importStar(require('bcrypt'));
const prisma = new client_1.PrismaClient();
async function main() {
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
      currency: client_1.Currency.MXN,
      type: client_1.OrgType.BOLETERA,
      verified: true,
      tenantTheme: {
        create: {
          primaryColor: '#171717',
          secondaryColor: '#737373',
          subdomain: 'demo',
        },
      },
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
      role: client_1.UserRole.SUPER_ADMIN,
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
      role: client_1.UserRole.TAQUILLA,
      organizationId: org.id,
      emailVerified: true,
    },
  });
  const venue = await prisma.venue.upsert({
    where: { slug: 'arena-cdmx' },
    update: {},
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
  const mapData = {
    sections: [
      {
        id: 'sec-a',
        name: 'Sección A',
        slug: 'a',
        color: '#404040',
        seats: Array.from({ length: 20 }, (_, i) => ({
          id: `seat-a-${i + 1}`,
          label: `A-${i + 1}`,
          row: 'A',
          x: 50 + (i % 10) * 35,
          y: 80 + Math.floor(i / 10) * 35,
          tier: 'standard',
        })),
      },
    ],
  };
  const layout = await prisma.venueLayout.create({
    data: {
      venueId: venue.id,
      name: 'Layout Principal',
      mapData: { sections: [] },
      sections: {
        create: [
          {
            name: 'Sección A',
            slug: 'a',
            color: '#404040',
            sortOrder: 0,
            seats: {
              create: Array.from({ length: 20 }, (_, i) => ({
                label: `A-${i + 1}`,
                x: 50 + (i % 10) * 35,
                y: 80 + Math.floor(i / 10) * 35,
                tier: 'standard',
              })),
            },
          },
        ],
      },
    },
    include: { sections: { include: { seats: true } } },
  });
  const snapshotData = {
    sections: layout.sections.map((sec) => ({
      id: sec.id,
      name: sec.name,
      slug: sec.slug,
      color: sec.color,
      seats: sec.seats.map((s) => ({
        id: s.id,
        label: s.label,
        x: s.x,
        y: s.y,
        tier: s.tier,
        row: 'A',
      })),
    })),
  };
  await prisma.venueLayout.update({
    where: { id: layout.id },
    data: { mapData: snapshotData },
  });
  const startsAt = new Date();
  startsAt.setMonth(startsAt.getMonth() + 1);
  const event = await prisma.event.upsert({
    where: { slug: 'concierto-demo-2026' },
    update: {},
    create: {
      organizationId: org.id,
      venueId: venue.id,
      title: 'Concierto Demo 2026',
      slug: 'concierto-demo-2026',
      category: 'MUSIC',
      startsAt,
      timezone: 'America/Mexico_City',
      status: client_1.EventStatus.SCHEDULED,
      publishedAt: new Date(),
      totalCapacity: 20,
      minPrice: 500,
      maxPrice: 1500,
      currency: client_1.Currency.MXN,
      seatMap: {
        create: {
          layoutId: layout.id,
          snapshotData,
        },
      },
    },
  });
  const offer = await prisma.offer.upsert({
    where: { eventId_zone: { eventId: event.id, zone: 'a' } },
    update: {},
    create: {
      eventId: event.id,
      name: 'General Sección A',
      zone: 'a',
      basePrice: 800,
      totalQuantity: 20,
      remainingQuantity: 20,
      startDate: new Date(),
      endDate: startsAt,
    },
  });
  const section = layout.sections[0];
  for (const seat of section.seats) {
    await prisma.ticket.create({
      data: {
        code: `TKT-${seat.id.slice(-8).toUpperCase()}`,
        eventId: event.id,
        offerId: offer.id,
        status: client_1.TicketStatus.AVAILABLE,
        seatId: seat.id,
        seatNumber: seat.label.split('-')[1],
        row: 'A',
        section: 'A',
      },
    });
  }
  console.log('Seed OK:', {
    org: org.slug,
    admin: admin.email,
    cashier: cashier.email,
    event: event.slug,
  });
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map
