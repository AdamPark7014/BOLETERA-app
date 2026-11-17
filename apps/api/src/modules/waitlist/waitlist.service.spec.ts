import { BadRequestException } from '@nestjs/common';
import { CLAIM_TTL_MS, WaitlistService } from './waitlist.service';

describe('WaitlistService (lista de espera DICE)', () => {
  const now = new Date('2026-11-17T15:00:00.000Z');

  function setup() {
    const prisma = {
      event: {
        findUnique: jest.fn(),
      },
      waitlistEntry: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const notifications = { enqueueEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new WaitlistService(prisma as never, audit as never, notifications as never);
    return { prisma, audit, notifications, service };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('offerNext notifica al PENDING con más prioridad y abre claim de 60 min', async () => {
    const { prisma, notifications, service } = setup();
    prisma.waitlistEntry.findFirst
      .mockResolvedValueOnce(null) // sin claim vigente
      .mockResolvedValueOnce({
        id: 'w1',
        eventId: 'e1',
        email: 'fan@ejemplo.com',
        quantity: 1,
        offerId: null,
        priority: 1,
      });
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1',
      title: 'Concierto',
      slug: 'concierto',
      organizationId: 'org1',
    });
    prisma.waitlistEntry.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'w1',
      eventId: 'e1',
      email: 'fan@ejemplo.com',
      quantity: 1,
      ...data,
    }));

    const entry = await service.offerNext('e1', { facePrice: 500, source: 'test' });

    expect(entry).toMatchObject({
      status: 'NOTIFIED',
      claimToken: expect.any(String),
    });
    expect(entry!.claimExpiresAt!.getTime() - now.getTime()).toBe(CLAIM_TTL_MS);
    expect(notifications.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'fan@ejemplo.com',
        data: expect.objectContaining({
          claimUrl: expect.stringContaining('/espera/'),
        }),
      })
    );
  });

  it('offerNext no abre otro claim si ya hay uno vigente', async () => {
    const { prisma, service } = setup();
    prisma.waitlistEntry.findFirst.mockResolvedValueOnce({ id: 'active' });

    await expect(service.offerNext('e1')).resolves.toBeNull();
    expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
  });

  it('getByClaimToken vence el enlace y lanza BadRequestException', async () => {
    const { prisma, service } = setup();
    const expiredAt = new Date(now.getTime() - 1000);
    prisma.waitlistEntry.findUnique
      .mockResolvedValueOnce({
        id: 'w1',
        eventId: 'e1',
        status: 'NOTIFIED',
        claimExpiresAt: expiredAt,
        email: 'fan@ejemplo.com',
        quantity: 1,
        offerId: null,
        reservedTicketId: null,
        facePrice: null,
        event: {
          id: 'e1',
          title: 'Concierto',
          slug: 'concierto',
          startsAt: now,
          organizationId: 'org1',
          image: null,
        },
      })
      .mockResolvedValueOnce({ id: 'w1', eventId: 'e1', status: 'NOTIFIED' });
    prisma.waitlistEntry.update.mockResolvedValue({});
    prisma.waitlistEntry.findFirst.mockResolvedValue(null);
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1',
      title: 'Concierto',
      slug: 'concierto',
      organizationId: 'org1',
    });

    await expect(service.getByClaimToken('tok')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.waitlistEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w1' },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      })
    );
  });

  it('expireClaim marca EXPIRED y ofrece al siguiente', async () => {
    const { prisma, service } = setup();
    const offerSpy = jest.spyOn(service, 'offerNext').mockResolvedValue(null);
    prisma.waitlistEntry.findUnique.mockResolvedValue({
      id: 'w1',
      eventId: 'e1',
      status: 'NOTIFIED',
    });
    prisma.waitlistEntry.update.mockResolvedValue({});

    await service.expireClaim('w1');

    expect(prisma.waitlistEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'EXPIRED', claimToken: null }),
      })
    );
    expect(offerSpy).toHaveBeenCalledWith('e1', { source: 'expireClaim' });
  });
});
