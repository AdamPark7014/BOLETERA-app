import { ForbiddenException } from '@nestjs/common';
import { AccessService } from './access.service';

/** Totales en vivo de la puerta: conteos, por minuto y alcance por organización. */
describe('AccessService · totales en vivo', () => {
  const now = new Date('2026-12-01T22:00:00Z');

  function build() {
    const prisma = {
      event: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org1' }) },
      ticket: {
        count: jest
          .fn()
          .mockResolvedValueOnce(120) // entraron (USED)
          .mockResolvedValueOnce(500), // esperados
      },
      ticketScan: {
        findMany: jest
          .fn()
          // allScans (aforo)
          .mockResolvedValueOnce([
            { zoneId: 'z1', reason: 'ENTRY' },
            { zoneId: 'z1', reason: 'ENTRY' },
            { zoneId: 'z1', reason: 'EXIT' },
            { zoneId: 'z2', reason: 'ENTRY' },
            { zoneId: 'z2', reason: null },
          ])
          // recent (por minuto, solo entradas)
          .mockResolvedValueOnce([
            { scannedAt: new Date(now.getTime() - 30_000), reason: 'ENTRY' },
            { scannedAt: new Date(now.getTime() - 45_000), reason: 'ENTRY' },
            { scannedAt: new Date(now.getTime() - 5 * 60_000 - 1000), reason: 'ENTRY' },
          ]),
      },
      accessZone: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'z1', name: 'Puerta 1' },
          { id: 'z2', name: 'Puerta 2' },
        ]),
      },
    };
    const service = Object.create(AccessService.prototype) as AccessService;
    Object.assign(service, { prisma });
    return service;
  }

  it('cuenta entradas, faltantes, aforo dentro, puertas y minuto a minuto', async () => {
    const stats = await build().getLiveStats(
      'e1',
      { organizationId: 'org1', role: 'SCANNER' },
      now
    );
    expect(stats.admitted).toBe(120);
    expect(stats.remaining).toBe(380);
    expect(stats.insideNow).toBe(3);
    expect(stats.exited).toBe(1);
    expect(stats.lastTenMinutes).toBe(3);
    expect(stats.perMinute[9]).toBe(2);
    expect(stats.perMinute[4]).toBe(1);
    expect(stats.byGate.find((g) => g.zoneId === 'z1')).toEqual({
      zoneId: 'z1',
      name: 'Puerta 1',
      admitted: 2,
      exited: 1,
      inside: 1,
    });
  });

  it('otra organización no ve los totales', async () => {
    await expect(
      build().getLiveStats('e1', { organizationId: 'otra', role: 'SCANNER' }, now)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
