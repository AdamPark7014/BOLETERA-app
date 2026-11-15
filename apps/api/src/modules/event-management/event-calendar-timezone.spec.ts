import { EventManagementService, localDateKey } from './event-management.service';

/**
 * El calendario agrupa y muestra la hora en la zona del evento, no en la del
 * servidor (UTC): una función de las 20:00 en CDMX es el mismo día, a las 20:00.
 */
describe('Calendario de eventos · zona del evento', () => {
  it('localDateKey usa la zona dada', () => {
    // 2026-11-17 02:00 UTC = 2026-11-16 20:00 en CDMX.
    const instant = new Date('2026-11-17T02:00:00Z');
    expect(localDateKey(instant, 'America/Mexico_City')).toBe('2026-11-16');
    expect(localDateKey(instant, 'UTC')).toBe('2026-11-17');
  });

  it('agrupa por el día local y da la hora local en 24 h', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'e1',
        title: 'Noche',
        startsAt: new Date('2026-11-17T02:00:00Z'),
        timezone: 'America/Mexico_City',
        venue: { name: 'Arena' },
        totalCapacity: 100,
        status: 'PUBLISHED',
        metadata: null,
      },
      {
        // 1 de diciembre local: no pertenece a noviembre.
        id: 'e2',
        title: 'Diciembre',
        startsAt: new Date('2026-12-01T18:00:00Z'),
        timezone: 'America/Mexico_City',
        venue: { name: 'Arena' },
        totalCapacity: 100,
        status: 'PUBLISHED',
        metadata: null,
      },
    ]);
    const service = Object.create(EventManagementService.prototype) as EventManagementService;
    (service as unknown as { prisma: unknown }).prisma = { event: { findMany } };

    const result = await service.getEventCalendar('org1', 11, 2026);
    expect(result.totalEvents).toBe(1);
    const day = result.calendar['2026-11-16'] as Array<{ startTime: string; startsAt: string }>;
    expect(day).toHaveLength(1);
    expect(day[0].startTime).toBe('20:00');
    expect(day[0].startsAt).toBe('2026-11-17T02:00:00.000Z');
  });
});
