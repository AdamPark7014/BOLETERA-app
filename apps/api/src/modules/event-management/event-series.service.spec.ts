import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  EventSeriesService,
  expandWithExcluded,
  parseRecurrenceRule,
} from './event-series.service';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const TZ = 'America/Mexico_City';

function makePrisma() {
  return {
    eventSeries: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    venue: { findFirst: jest.fn() },
    event: { findMany: jest.fn(), create: jest.fn() },
    venueBlackout: { findMany: jest.fn() },
    offer: { create: jest.fn() },
    $transaction: jest.fn(),
  };
}

function setup() {
  const prisma = makePrisma();
  const service = new EventSeriesService(prisma as never);
  return { prisma, service };
}

describe('EventSeriesService.listSeries', () => {
  it('filtra por la organización del usuario y arma totales', async () => {
    const { prisma, service } = setup();
    prisma.eventSeries.findMany.mockResolvedValue([
      {
        id: 's1',
        name: 'Ciclo de jazz',
        slug: 'ciclo-de-jazz',
        kind: 'SERIES',
        status: 'ACTIVE',
        timezone: TZ,
        recurrence: { frequency: 'WEEKLY', startLocal: '2026-11-20T20:00', timezone: TZ, count: 3 },
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        venue: { id: 'v1', name: 'Foro' },
        events: [
          {
            startsAt: new Date('2026-11-21T02:00:00.000Z'),
            status: 'SCHEDULED',
            totalCapacity: 100,
          },
          {
            startsAt: new Date('2026-12-05T02:00:00.000Z'),
            status: 'SCHEDULED',
            totalCapacity: 100,
          },
          {
            startsAt: new Date('2026-12-12T02:00:00.000Z'),
            status: 'CANCELLED',
            totalCapacity: 100,
          },
        ],
      },
    ]);

    const rows = await service.listSeries('org-a', NOW);

    expect(prisma.eventSeries.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-a' } })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].totals).toEqual({ events: 3, upcoming: 1, cancelled: 1, capacity: 200 });
    expect(rows[0].firstDate).toBe('2026-11-21T02:00:00.000Z');
    expect(rows[0].lastDate).toBe('2026-12-12T02:00:00.000Z');
    expect(rows[0].nextDate).toBe('2026-12-05T02:00:00.000Z');
    expect(rows[0].summary).toMatch(/a las 20:00/);
  });

  it('sin organización no consulta', async () => {
    const { prisma, service } = setup();
    await expect(service.listSeries('', NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.eventSeries.findMany).not.toHaveBeenCalled();
  });
});

describe('EventSeriesService.getSeries', () => {
  it('da 404 si la serie es de otra organización', async () => {
    const { prisma, service } = setup();
    prisma.eventSeries.findFirst.mockResolvedValue(null);
    await expect(service.getSeries('org-b', 's1', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.eventSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', organizationId: 'org-b' } })
    );
  });

  it('devuelve fechas con estado de venta y conteos', async () => {
    const { prisma, service } = setup();
    prisma.eventSeries.findFirst.mockResolvedValue({
      id: 's1',
      name: 'Ciclo',
      slug: 'ciclo',
      description: null,
      kind: 'SERIES',
      status: 'ACTIVE',
      category: 'MUSIC',
      timezone: TZ,
      recurrence: null,
      template: { capacity: 100, basePrice: 450 },
      venue: { id: 'v1', name: 'Foro', timezone: TZ },
      events: [
        {
          id: 'e1',
          title: 'Ciclo',
          slug: 'ciclo-1',
          status: 'SCHEDULED',
          seriesOrder: 1,
          startsAt: new Date('2026-12-05T02:00:00.000Z'),
          endsAt: null,
          doorsAt: null,
          timezone: TZ,
          announceAt: null,
          publishAt: null,
          salesStartAt: null,
          salesEndAt: null,
          totalCapacity: 100,
          salePhases: [],
          _count: { tickets: 3, orders: 2 },
        },
      ],
    });

    const detail = await service.getSeries('org-a', 's1', NOW);
    expect(detail.recurrence).toBeNull();
    expect(detail.template).toEqual({ capacity: 100, basePrice: 450 });
    expect(detail.events[0]).toMatchObject({
      localDate: '2026-12-04',
      sale: { state: 'ON_SALE', canPurchase: true },
      counts: { tickets: 3, orders: 2 },
    });
  });
});

describe('vista previa de recurrencia', () => {
  function previewSetup() {
    const ctx = setup();
    ctx.prisma.venue.findFirst.mockResolvedValue({ id: 'v1', name: 'Foro', timezone: TZ });
    ctx.prisma.event.findMany.mockResolvedValue([]);
    ctx.prisma.venueBlackout.findMany.mockResolvedValue([]);
    return ctx;
  }

  it('semanal con dos días, determinista y sin escribir', async () => {
    const { prisma, service } = previewSetup();
    const body = {
      venueId: 'v1',
      rule: {
        frequency: 'WEEKLY',
        startLocal: '2026-12-01T20:00',
        timezone: TZ,
        byWeekday: [4, 5],
        count: 4,
      },
      template: { capacity: 200, basePrice: 300, doorsOffsetMinutes: 60, salesEndOffsetHours: 2 },
    };
    const a = await service.previewSchedule('org-a', body);
    const b = await service.previewSchedule('org-a', body);
    expect(a).toEqual(b);
    expect(a.occurrences.map((o) => o.localDate)).toEqual([
      '2026-12-03',
      '2026-12-04',
      '2026-12-10',
      '2026-12-11',
    ]);
    // 20:00 en CDMX (UTC-6) = 02:00 UTC del día siguiente.
    expect(a.occurrences[0].startsAt).toBe('2026-12-04T02:00:00.000Z');
    expect(a.occurrences[0].doorsAt).toBe('2026-12-04T01:00:00.000Z');
    expect(a.occurrences[0].salesEndAt).toBe('2026-12-04T00:00:00.000Z');
    expect(a.totals).toEqual({ occurrences: 4, withConflicts: 0, blocking: 0, capacity: 800 });
    expect(a.limits.maxOccurrences).toBe(366);
    expect(prisma.venue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1', organizationId: 'org-a' } })
    );
    expect(prisma.event.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('mensual con día 31 se ajusta al fin de mes', async () => {
    const { service } = previewSetup();
    const preview = await service.previewSchedule('org-a', {
      venueId: 'v1',
      rule: { frequency: 'MONTHLY', startLocal: '2027-01-31T19:00', timezone: TZ, count: 2 },
    });
    expect(preview.occurrences.map((o) => o.localDate)).toEqual(['2027-01-31', '2027-02-28']);
    expect(preview.occurrences[1].clamped).toBe(true);
  });

  it('respeta el tope de 366 fechas', async () => {
    const { service } = previewSetup();
    const preview = await service.previewSchedule('org-a', {
      venueId: 'v1',
      rule: { frequency: 'DAILY', startLocal: '2027-01-01T10:00', timezone: TZ, count: 1000 },
    });
    expect(preview.totals.occurrences).toBe(366);
  });

  it('las excepciones no cuentan pero se devuelven para poder restaurarlas', () => {
    const { active, excluded } = expandWithExcluded({
      frequency: 'DAILY',
      startLocal: '2027-01-01T10:00',
      timezone: TZ,
      count: 3,
      exceptions: ['2027-01-02'],
    });
    expect(active.map((o) => o.localDate)).toEqual(['2027-01-01', '2027-01-03', '2027-01-04']);
    expect(excluded.map((o) => o.localDate)).toEqual(['2027-01-02']);
  });

  it('marca como bloqueante un traslape en el recinto', async () => {
    const { prisma, service } = previewSetup();
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'x',
        title: 'Otro show',
        startsAt: new Date('2027-01-01T18:00:00.000Z'),
        endsAt: null,
        durationMinutes: 120,
      },
    ]);
    const preview = await service.previewSchedule('org-a', {
      venueId: 'v1',
      rule: { frequency: 'DAILY', startLocal: '2027-01-01T11:00', timezone: TZ, count: 2 },
    });
    expect(preview.occurrences[0].blocking).toBe(true);
    expect(preview.occurrences[0].conflicts[0].kind).toBe('VENUE_OVERLAP');
    expect(preview.totals.blocking).toBe(1);
  });

  it('rechaza reglas mal formadas y recintos de otra organización', async () => {
    const { prisma, service } = previewSetup();
    expect(() =>
      parseRecurrenceRule({ frequency: 'YEARLY', startLocal: '2027-01-01T10:00', timezone: TZ })
    ).toThrow(BadRequestException);
    expect(() =>
      parseRecurrenceRule({
        frequency: 'DAILY',
        startLocal: '2027-01-01T10:00',
        timezone: 'Marte/Base',
      })
    ).toThrow(/Zona horaria/);
    expect(() =>
      parseRecurrenceRule({
        frequency: 'WEEKLY',
        startLocal: '2027-01-01T10:00',
        timezone: TZ,
        byWeekday: [9],
      })
    ).toThrow(BadRequestException);
    prisma.venue.findFirst.mockResolvedValue(null);
    await expect(
      service.previewSchedule('org-a', {
        venueId: 'ajeno',
        rule: { frequency: 'DAILY', startLocal: '2027-01-01T10:00', timezone: TZ },
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EventSeriesService.updateSeries / extendSeries', () => {
  it('no cambia series de otra organización ni estados inválidos', async () => {
    const { prisma, service } = setup();
    prisma.eventSeries.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateSeries('org-b', 's1', { status: 'ACTIVE' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    prisma.eventSeries.findFirst.mockResolvedValueOnce({ id: 's1' });
    await expect(service.updateSeries('org-a', 's1', { status: 'BORRADO' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.eventSeries.update).not.toHaveBeenCalled();
  });

  it('sin regla guardada no se extiende', async () => {
    const { prisma, service } = setup();
    prisma.eventSeries.findFirst.mockResolvedValue({
      id: 's1',
      venueId: 'v1',
      recurrence: null,
      template: { capacity: 10, basePrice: 1 },
      events: [],
    });
    await expect(service.extendSeries('org-a', 's1', { count: 2 })).rejects.toThrow(
      /no se puede extender/
    );
  });

  it('con conflicto bloqueante pide force (409)', async () => {
    const { prisma, service } = setup();
    prisma.eventSeries.findFirst.mockResolvedValue({
      id: 's1',
      venueId: 'v1',
      name: 'Ciclo',
      recurrence: { frequency: 'DAILY', startLocal: '2027-01-01T11:00', timezone: TZ, count: 1 },
      template: { capacity: 10, basePrice: 1 },
      events: [{ startsAt: new Date('2027-01-01T17:00:00.000Z'), seriesOrder: 1 }],
    });
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'x',
        title: 'Otro',
        startsAt: new Date('2027-01-02T17:00:00.000Z'),
        endsAt: null,
        durationMinutes: 60,
      },
    ]);
    prisma.venueBlackout.findMany.mockResolvedValue([]);
    await expect(service.extendSeries('org-a', 's1', { count: 1 })).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
