import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccessService } from './access.service';

describe('AccessService · salida, reingreso y puerta', () => {
  function build(
    opts: {
      status?: string;
      metadata?: unknown;
      lastReason?: string | null;
      reentries?: number;
      zoneId?: string;
    } = {}
  ) {
    const ticket = {
      id: 't1',
      code: 'BLT-1',
      eventId: 'ev-door',
      status: opts.status ?? 'USED',
      section: 'Luneta',
      row: 'A',
      seatNumber: '2',
      buyerName: 'Ana Ruiz',
      event: { title: 'Ballet', metadata: opts.metadata ?? {} },
      offer: { name: 'General', zone: 'General' },
    };
    const prisma = {
      event: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-a' }) },
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        findUnique: jest.fn().mockResolvedValue({
          status: ticket.status,
          usedAt: new Date('2026-12-01T20:00:00Z'),
          checkedInAt: new Date('2026-12-01T20:00:00Z'),
          keyEpoch: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: ticket.status === 'SOLD' ? 1 : 0 }),
      },
      ticketScan: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.lastReason === undefined
              ? { reason: 'ENTRY', scannedAt: new Date(), zoneId: 'z1', scannedBy: 'u0' }
              : opts.lastReason === null
                ? null
                : { reason: opts.lastReason, scannedAt: new Date(), zoneId: 'z1', scannedBy: 'u0' }
          ),
        count: jest.fn().mockResolvedValue(opts.reentries ?? 0),
      },
      accessZone: {
        findUnique: jest.fn().mockResolvedValue(opts.zoneId ? { id: opts.zoneId } : null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AccessService(prisma as never, audit as never);
    return { service, prisma, audit, ticket };
  }

  const base = {
    ticketCode: 'BLT-1',
    scannedBy: 'u1',
    channel: 'TAQUILLA',
    scannerOrganizationId: 'org-a',
    scannerRole: 'SCANNER',
    eventId: 'ev-door',
  };

  it('registra salida con reason EXIT sin cambiar a SOLD', async () => {
    const { service, prisma, audit } = build({ status: 'USED', lastReason: 'ENTRY' });
    const res = await service.scanTicket({ ...base, mode: 'EXIT' });
    expect(res.action).toBe('EXIT');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(prisma.ticketScan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: true, reason: 'EXIT' }),
      })
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ticket.exit' }));
  });

  it('rechaza salida si el boleto no está dentro', async () => {
    const { service } = build({ status: 'USED', lastReason: 'EXIT' });
    await expect(service.scanTicket({ ...base, mode: 'EXIT' })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('permite reingreso cuando el evento lo autoriza', async () => {
    const { service, prisma } = build({
      status: 'USED',
      lastReason: 'EXIT',
      reentries: 0,
      metadata: { access: { reentryAllowed: true, maxReentries: 2 } },
    });
    const res = await service.scanTicket({ ...base, mode: 'ENTRY' });
    expect(res.action).toBe('REENTRY');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(prisma.ticketScan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: true, reason: 'REENTRY' }),
      })
    );
  });

  it('409 si ya entró y no hay reingreso', async () => {
    const { service } = build({ status: 'USED', lastReason: 'ENTRY' });
    await expect(service.scanTicket({ ...base, mode: 'ENTRY' })).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('WRONG_GATE si la puerta no acepta la zona del boleto', async () => {
    const { service } = build({
      status: 'SOLD',
      zoneId: 'z-vip',
      metadata: {
        access: {
          gates: {
            'z-vip': { allowedZones: ['VIP'], label: 'Norte' },
            'z-gen': { allowedZones: ['General'], label: 'Sur' },
          },
        },
      },
    });
    const err = await service
      .scanTicket({ ...base, zoneId: 'z-vip', mode: 'ENTRY' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({
      code: 'WRONG_GATE',
      message: 'Este boleto entra por la puerta Sur',
    });
  });
});
