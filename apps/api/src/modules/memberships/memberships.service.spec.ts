import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MembershipsService, validatePlanInput, type MembershipActor } from './memberships.service';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-11T12:00:00Z');

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    organizationId: 'org-a',
    planId: 'p1',
    status: 'ACTIVE',
    expiresAt: new Date(now.getTime() + 5 * DAY),
    plan: { active: true, billingPeriod: 'ANNUAL', price: new Prisma.Decimal(2499) },
    ...overrides,
  };
}

function setup(row: ReturnType<typeof membershipRow> | null) {
  const prisma = {
    membership: {
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockReturnValue('update'),
    },
    membershipPeriod: { create: jest.fn().mockReturnValue('create') },
    membershipBenefitRedemption: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const audit = { log: jest.fn().mockResolvedValue({}) };
  return { service: new MembershipsService(prisma as never, audit as never), prisma, audit };
}

const promoterA: MembershipActor = {
  userId: 'u1',
  role: 'PROMOTER',
  scopedOrganizationId: 'org-a',
};

describe('validación de planes', () => {
  it('acepta un plan correcto y normaliza', () => {
    expect(
      validatePlanInput({ name: ' Oro ', slug: 'oro', price: '2499.999', billingPeriod: 'annual' })
    ).toMatchObject({
      name: 'Oro',
      slug: 'oro',
      price: 2500,
      billingPeriod: 'ANNUAL',
      maxMembers: null,
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ slug: 'x', price: 10 }, 'nombre'],
    [{ name: 'x', slug: 'Con Espacios', price: 10 }, 'slug'],
    [{ name: 'x', slug: 'x', price: 0 }, 'precio'],
    [{ name: 'x', slug: 'x', price: 10, billingPeriod: 'WEEKLY' }, 'periodo'],
    [{ name: 'x', slug: 'x', price: 10, maxMembers: 0 }, 'cupo'],
  ])('rechaza %j', (body) => {
    expect(() => validatePlanInput(body)).toThrow(BadRequestException);
  });
});

describe('renovación', () => {
  it('registra un periodo al precio del plan y mueve el vencimiento', async () => {
    const { service, prisma, audit } = setup(membershipRow());
    const result = await service.renew('m1', promoterA, now);
    expect(result.kind).toBe('RENEWAL');
    const period = prisma.membershipPeriod.create.mock.calls[0][0].data;
    expect(period.amount.toString()).toBe('2499');
    expect(period.startsAt).toEqual(new Date(now.getTime() + 5 * DAY));
    expect(prisma.membership.update.mock.calls[0][0].data.expiresAt).toEqual(period.endsAt);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEMBERSHIP_RENEWED' })
    );
  });

  it('otra organización → 404', async () => {
    const { service, prisma } = setup(membershipRow());
    await expect(
      service.renew('m1', { role: 'ADMIN', scopedOrganizationId: 'org-b' }, now)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fuera de ventana, cancelada o con plan inactivo → 409', async () => {
    await expect(
      setup(membershipRow({ expiresAt: new Date(now.getTime() + 200 * DAY) })).service.renew(
        'm1',
        promoterA,
        now
      )
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup(membershipRow({ status: 'CANCELLED' })).service.renew('m1', promoterA, now)
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup(
        membershipRow({
          plan: { active: false, billingPeriod: 'ANNUAL', price: new Prisma.Decimal(1) },
        })
      ).service.renew('m1', promoterA, now)
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('métricas', () => {
  it('sin membresías todo queda en cero o null', async () => {
    const { service } = setup(null);
    await expect(service.metrics('org-a', now)).resolves.toEqual({
      activeMembers: 0,
      benefitsRedeemed: 0,
      renewalRate: null,
      retention12m: null,
      revenue: '0.00',
      mrr: '0.00',
    });
  });
});
