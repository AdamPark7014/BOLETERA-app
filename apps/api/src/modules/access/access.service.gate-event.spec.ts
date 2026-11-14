import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessService } from './access.service';

/**
 * La puerta controla UNA función. Antes, un boleto de otro evento escaneado en
 * esta puerta respondía «Éxito» y quedaba USED (quemado para su propia función).
 */
describe('AccessService · boleto de otra función y otra organización', () => {
  function build(opts: { eventOrg?: string | null; ticketEventId?: string } = {}) {
    const prisma = {
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.eventOrg === null ? null : { organizationId: opts.eventOrg ?? 'org-a' }
          ),
      },
      ticket: {
        findFirst: jest.fn().mockResolvedValue({
          id: 't1',
          code: 'BLT-1',
          eventId: opts.ticketEventId ?? 'ev-door',
          section: 'Luneta',
          row: 'A',
          seatNumber: '2',
          event: { title: 'Ballet' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ticketScan: { create: jest.fn().mockResolvedValue({}) },
      accessZone: { findUnique: jest.fn() },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AccessService(prisma as never, audit as never);
    return { service, prisma };
  }

  const base = {
    ticketCode: 'BLT-1',
    scannedBy: 'u1',
    channel: 'TAQUILLA',
    scannerOrganizationId: 'org-a',
    scannerRole: 'SCANNER',
  };

  it('rechaza un boleto de otro evento sin marcarlo usado y registra el intento', async () => {
    const { service, prisma } = build({ ticketEventId: 'ev-otro' });
    await expect(service.scanTicket({ ...base, eventId: 'ev-door' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(prisma.ticketScan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false, reason: 'Wrong event' }),
      })
    );
  });

  it('responde con código WRONG_EVENT', async () => {
    const { service } = build({ ticketEventId: 'ev-otro' });
    const err = await service.scanTicket({ ...base, eventId: 'ev-door' }).catch((e) => e);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'WRONG_EVENT' });
  });

  it('deja pasar el boleto de la función de la puerta', async () => {
    const { service, prisma } = build();
    const res = await service.scanTicket({ ...base, eventId: 'ev-door' });
    expect(res.success).toBe(true);
    expect(prisma.ticket.updateMany).toHaveBeenCalled();
  });

  it('403 si la función pedida es de otra organización', async () => {
    const { service, prisma } = build({ eventOrg: 'org-b' });
    await expect(service.scanTicket({ ...base, eventId: 'ev-door' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('403 si el escáner no tiene organización', async () => {
    const { service } = build();
    await expect(
      service.scanTicket({ ...base, scannerOrganizationId: null, eventId: 'ev-door' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SUPER_ADMIN puede controlar la puerta de cualquier organización', async () => {
    const { service } = build({ eventOrg: 'org-b' });
    const res = await service.scanTicket({
      ...base,
      scannerRole: 'SUPER_ADMIN',
      eventId: 'ev-door',
    });
    expect(res.success).toBe(true);
  });

  it('sin eventId se comporta como antes (compatibilidad)', async () => {
    const { service } = build({ ticketEventId: 'ev-otro' });
    const res = await service.scanTicket({ ...base });
    expect(res.success).toBe(true);
  });
});
