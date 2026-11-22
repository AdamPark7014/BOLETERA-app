import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventCategory, EventStatus, SalePhaseStatus } from '@prisma/client';
import { EventManagementService } from './event-management.service';

function makePrisma() {
  const event = {
    id: 'ev1',
    organizationId: 'org1',
    title: 'Concierto',
    description: 'Noche',
    image: 'https://img/a.jpg',
    bannerImage: null,
    startsAt: new Date('2026-12-20T02:00:00.000Z'),
    endsAt: null,
    doorsAt: new Date('2026-12-20T01:00:00.000Z'),
    venueId: 'v1',
    category: EventCategory.MUSIC,
    rating: 'PG',
    salesStartAt: new Date('2026-12-01T16:00:00.000Z'),
    salesEndAt: new Date('2026-12-20T01:30:00.000Z'),
    totalCapacity: 100,
    allowResale: true,
    transferAllowed: true,
    refundable: true,
    nonTransferable: false,
    holdExpiration: 900,
    enableDynamic: false,
    surgeThreshold: 0.8,
    surgePriceMultiplier: 1.25,
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    minPrice: 100,
    maxPrice: 100,
    genre: null,
    status: EventStatus.DRAFT,
    metadata: { eventKind: 'single', channels: { web: { enabled: true, allocation: 100 } } },
    offers: [
      {
        name: 'General',
        zone: 'GA',
        description: null,
        basePrice: 100,
        fees: 0,
        currency: 'MXN',
        totalQuantity: 100,
        remainingQuantity: 100,
        soldQuantity: 0,
        holdQuantity: 0,
        minPerOrder: 1,
        maxPerOrder: 8,
        minAge: null,
        restrictedCards: [] as string[],
        startDate: new Date('2026-12-20T02:00:00.000Z'),
        endDate: new Date('2026-12-20T02:00:00.000Z'),
        isAvailable: true,
      },
    ],
    salePhases: [
      {
        name: 'Público',
        kind: 'PUBLIC',
        code: null,
        startsAt: new Date('2026-12-01T16:00:00.000Z'),
        endsAt: new Date('2026-12-20T01:30:00.000Z'),
        status: SalePhaseStatus.SCHEDULED,
        channels: [],
        allocationPercent: null,
        maxPerOrder: null,
        discountPercent: null,
        priority: 100,
        notes: null,
      },
    ],
    venue: { id: 'v1', name: 'Foro' },
  };

  const prisma = {
    event: {
      findFirst: jest.fn().mockResolvedValue(event),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...event, ...data, id: 'ev1' })
        ),
      create: jest.fn(),
    },
    venue: {
      findFirst: jest.fn().mockResolvedValue({ id: 'v1' }),
    },
    seat: {
      count: jest.fn().mockResolvedValue(120),
    },
    offer: { create: jest.fn().mockResolvedValue({}) },
    salePhase: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        event: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              id: 'ev2',
              ...data,
              status: EventStatus.DRAFT,
              venue: { id: 'v1', name: 'Foro' },
            })
          ),
        },
        offer: { create: jest.fn().mockResolvedValue({}) },
        salePhase: { create: jest.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    }),
  };

  return { prisma, event };
}

describe('EventManagementService.updateEvent / duplicateEvent', () => {
  it('updateEvent exige organización y evento', async () => {
    const { prisma } = makePrisma();
    prisma.event.findFirst.mockResolvedValue(null);
    const service = new EventManagementService(prisma as never, {} as never, {} as never);
    await expect(service.updateEvent('org1', 'missing', { title: 'X' })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('updateEvent guarda título y políticas en metadata', async () => {
    const { prisma } = makePrisma();
    const service = new EventManagementService(prisma as never, {} as never, {} as never);
    await service.updateEvent('org1', 'ev1', {
      title: 'Concierto remix',
      allowResale: false,
      policies: { resaleMaxPercent: 1.2, resaleDeadline: '2026-12-15' },
    });
    expect(prisma.event.update).toHaveBeenCalled();
    const data = prisma.event.update.mock.calls[0][0].data as {
      title: string;
      allowResale: boolean;
      metadata: { eventPolicies: { resaleMaxPercent: number } };
    };
    expect(data.title).toBe('Concierto remix');
    expect(data.allowResale).toBe(false);
    expect(data.metadata.eventPolicies.resaleMaxPercent).toBe(1.2);
  });

  it('duplicateEvent crea borrador con fecha nueva', async () => {
    const { prisma } = makePrisma();
    prisma.event.findFirst
      .mockResolvedValueOnce(makePrisma().event)
      .mockResolvedValueOnce({ id: 'ev2', status: EventStatus.DRAFT });
    const service = new EventManagementService(prisma as never, {} as never, {} as never);
    const cloned = await service.duplicateEvent('org1', 'ev1', {
      startDate: '2027-01-10T02:00:00.000Z',
      title: 'Concierto (copia)',
    });
    expect(cloned?.id).toBe('ev2');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('updateEvent rechaza ventana inválida', async () => {
    const { prisma } = makePrisma();
    const service = new EventManagementService(prisma as never, {} as never, {} as never);
    await expect(
      service.updateEvent('org1', 'ev1', {
        salesStartAt: '2026-12-20T02:00:00.000Z',
        salesEndAt: '2026-12-01T16:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('syncCapacityFromMap iguala el cupo a las butacas', async () => {
    const { prisma } = makePrisma();
    const service = new EventManagementService(prisma as never, {} as never, {} as never);
    const result = await service.syncCapacityFromMap('org1', 'ev1');
    expect(result.totalCapacity).toBe(120);
    expect(result.mapSeats).toBe(120);
    expect(prisma.event.update).toHaveBeenCalled();
  });
});
