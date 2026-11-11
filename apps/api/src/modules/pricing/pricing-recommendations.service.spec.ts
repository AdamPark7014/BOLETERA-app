import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PricingRecommendationsService, type Actor } from './pricing-recommendations.service';

const now = new Date('2026-11-11T12:00:00Z');

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec1',
    organizationId: 'org-a',
    eventId: 'ev1',
    offerId: 'of1',
    status: 'PENDING',
    fromPrice: new Prisma.Decimal(1000),
    proposedPrice: new Prisma.Decimal(1100),
    multiplier: 1.1,
    direction: 'increase',
    deltaPercent: 0.1,
    explanation: 'Subir 10 %.',
    payload: {},
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    ...overrides,
  };
}

function setup(row: ReturnType<typeof pendingRow> | null, offerUpdateCount = 1) {
  const tx = {
    offer: { updateMany: jest.fn().mockResolvedValue({ count: offerUpdateCount }) },
    event: { findUnique: jest.fn().mockResolvedValue({ startsAt: now, endsAt: null }) },
    dynamicPrice: { create: jest.fn().mockResolvedValue({}) },
    pricingRecommendation: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    pricingRecommendation: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue({}),
    },
    offer: { findUnique: jest.fn() },
    dynamicPrice: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const service = new PricingRecommendationsService(prisma as never, audit as never);
  return { service, prisma, tx, audit };
}

const promoterA: Actor = { userId: 'u1', role: 'PROMOTER', scopedOrganizationId: 'org-a' };
const promoterB: Actor = { userId: 'u2', role: 'PROMOTER', scopedOrganizationId: 'org-b' };

describe('cola de aprobación de precios', () => {
  it('aprobar escribe el precio de la oferta, deja historial y marca APPLIED', async () => {
    const { service, tx, audit } = setup(pendingRow());
    await expect(service.approve('rec1', 'ok', promoterA, now)).resolves.toEqual({
      id: 'rec1',
      status: 'approved',
    });
    expect(tx.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 'of1', basePrice: new Prisma.Decimal(1000) },
      data: { basePrice: new Prisma.Decimal(1100) },
    });
    const history = tx.dynamicPrice.create.mock.calls[0][0].data;
    expect(history.reason.startsWith('applied_recommendation|')).toBe(true);
    expect(tx.pricingRecommendation.update.mock.calls[0][0].data.status).toBe('APPLIED');
    expect(audit.log).toHaveBeenCalled();
  });

  it('otra organización no la ve (404, no 403)', async () => {
    const { service, tx } = setup(pendingRow());
    await expect(service.approve('rec1', undefined, promoterB, now)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.reject('rec1', undefined, promoterB, now)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(tx.offer.updateMany).not.toHaveBeenCalled();
  });

  it('un rol sin organización en el token tampoco', async () => {
    const { service } = setup(pendingRow());
    await expect(
      service.approve('rec1', undefined, { role: 'ADMIN', scopedOrganizationId: null }, now)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SUPER_ADMIN sí puede', async () => {
    const { service } = setup(pendingRow());
    await expect(
      service.reject('rec1', 'no', { role: 'SUPER_ADMIN', scopedOrganizationId: null }, now)
    ).resolves.toEqual({ id: 'rec1', status: 'rejected' });
  });

  it('caducada a las 24 h', async () => {
    const { service } = setup(
      pendingRow({ createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) })
    );
    await expect(service.approve('rec1', undefined, promoterA, now)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('ya revisada → 409', async () => {
    const { service } = setup(pendingRow({ status: 'REJECTED' }));
    await expect(service.approve('rec1', undefined, promoterA, now)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('si el precio cambió desde el cálculo no se pisa', async () => {
    const { service, tx } = setup(pendingRow(), 0);
    await expect(service.approve('rec1', undefined, promoterA, now)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(tx.dynamicPrice.create).not.toHaveBeenCalled();
  });

  it('historial de oferta ajena → 403', async () => {
    const { service, prisma } = setup(null);
    prisma.offer.findUnique.mockResolvedValue({ event: { organizationId: 'org-a' } });
    await expect(service.history('of1', 20, promoterB)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.history('of1', 500, promoterA)).resolves.toEqual([]);
    expect(prisma.dynamicPrice.findMany.mock.calls[0][0].take).toBe(100);
  });
});
