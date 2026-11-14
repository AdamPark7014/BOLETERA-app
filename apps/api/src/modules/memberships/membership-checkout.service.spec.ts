import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ExternalChargeBlockedError,
  PaymentService,
  type ExternalCharge,
} from '../payment/payment.service';
import { MembershipCheckoutService } from './membership-checkout.service';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-13T12:00:00Z');

const plan = {
  id: 'plan-oro',
  organizationId: 'org-a',
  name: 'Abono Oro',
  price: new Prisma.Decimal(2499),
  currency: 'MXN',
  billingPeriod: 'ANNUAL',
  maxMembers: null as number | null,
  active: true,
};

const user = { id: 'u1', email: 'comprador@example.test', firstName: 'Ana', lastName: 'Ruiz' };

function checkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chk1',
    publicId: 'MEM-ABC',
    organizationId: 'org-a',
    planId: plan.id,
    userId: user.id,
    status: 'PENDING',
    kind: 'NEW',
    amount: new Prisma.Decimal(2499),
    currency: 'MXN',
    paymentMethod: 'CARD',
    buyerEmail: user.email,
    buyerName: 'Ana Ruiz',
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    ...overrides,
  };
}

/** Membresía vigente con un periodo que cubre `now`. */
function activeMembership(id: string, expiresInDays: number, planId = plan.id) {
  const expiresAt = new Date(now.getTime() + expiresInDays * DAY);
  return {
    id,
    planId,
    status: 'ACTIVE',
    expiresAt,
    cancelledAt: null,
    periods: [
      {
        startsAt: new Date(now.getTime() - 30 * DAY),
        endsAt: expiresAt,
        amount: new Prisma.Decimal(2499),
      },
    ],
  };
}

function setup() {
  const prisma = {
    membershipPlan: { findUnique: jest.fn().mockResolvedValue(plan) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    membership: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    membershipPeriod: { create: jest.fn() },
    membershipCheckout: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...checkoutRow(), ...data, id: 'chk1' })),
      update: jest.fn().mockResolvedValue({ id: 'chk1', organizationId: 'org-a' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const payments = {
    registerExternalCharge: jest.fn(),
    createExternalPaymentIntent: jest.fn().mockResolvedValue({
      redirectUrl: 'http://localhost:3040/orders/MEM-ABC/pago?result=ok&demo=1',
      metadata: { type: 'CARD', demo: true },
    }),
  };
  const service = new MembershipCheckoutService(prisma as never, audit as never, payments as never);
  return { service, prisma, audit, payments };
}

describe('inicio de compra de membresía', () => {
  it('crea el checkout con el precio del plan y pide el intent al camino de pago', async () => {
    const { service, prisma, payments } = setup();
    const out = await service.start(user.id, { planId: plan.id, paymentMethod: 'card' }, now);

    expect(prisma.membershipCheckout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planId: plan.id,
        userId: user.id,
        kind: 'NEW',
        amount: plan.price,
        paymentMethod: 'CARD',
        publicId: expect.stringMatching(/^MEM-/),
      }),
    });
    expect(payments.createExternalPaymentIntent).toHaveBeenCalledWith(
      service,
      expect.objectContaining({ id: 'chk1', amount: 2499, status: 'PENDING' }),
      { email: user.email, name: 'Ana Ruiz' }
    );
    expect(out).toMatchObject({ publicId: expect.stringMatching(/^MEM-/), amount: '2499' });
    expect(out.payment.demo).toBe(true);
  });

  it('rechaza un plan sin cupo (vigentes + compras ajenas en curso)', async () => {
    const { service, prisma, payments } = setup();
    prisma.membershipPlan.findUnique.mockResolvedValue({ ...plan, maxMembers: 2 });
    prisma.membership.findMany.mockResolvedValue([activeMembership('m-otro', 200)]);
    prisma.membershipCheckout.count.mockResolvedValue(1);

    await expect(service.start(user.id, { planId: plan.id }, now)).rejects.toThrow(
      new ConflictException('El plan no tiene cupo')
    );
    expect(prisma.membershipCheckout.create).not.toHaveBeenCalled();
    expect(payments.createExternalPaymentIntent).not.toHaveBeenCalled();
  });

  it('no duplica una membresía vigente fuera de la ventana de renovación', async () => {
    const { service, prisma } = setup();
    prisma.membership.findUnique.mockResolvedValue(activeMembership('m1', 200));

    await expect(service.start(user.id, { planId: plan.id }, now)).rejects.toThrow(
      ConflictException
    );
    expect(prisma.membershipCheckout.create).not.toHaveBeenCalled();
  });

  it('dentro de la ventana de renovación la compra es RENEWAL', async () => {
    const { service, prisma } = setup();
    prisma.membership.findUnique.mockResolvedValue(activeMembership('m1', 10));
    await service.start(user.id, { planId: plan.id }, now);
    expect(prisma.membershipCheckout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'RENEWAL' }),
    });
  });

  it('reutiliza la compra pendiente del mismo plan en vez de crear otra', async () => {
    const { service, prisma, payments } = setup();
    prisma.membershipCheckout.findFirst.mockResolvedValue(checkoutRow());
    await service.start(user.id, { planId: plan.id }, now);
    expect(prisma.membershipCheckout.create).not.toHaveBeenCalled();
    expect(payments.createExternalPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('plan inactivo o inexistente: 404', async () => {
    const { service, prisma } = setup();
    prisma.membershipPlan.findUnique.mockResolvedValue({ ...plan, active: false });
    await expect(service.start(user.id, { planId: plan.id }, now)).rejects.toThrow(
      NotFoundException
    );
  });
});

describe('activación al confirmarse el pago', () => {
  const charge: ExternalCharge = {
    id: 'chk1',
    publicId: 'MEM-ABC',
    organizationId: 'org-a',
    status: 'PENDING',
    amount: 2499,
    currency: 'MXN',
    paymentMethod: 'CARD',
  };

  it('alta nueva: crea la membresía con su periodo y liga el checkout al Payment', async () => {
    const { service, prisma } = setup();
    prisma.membershipCheckout.findUnique.mockResolvedValue({ ...checkoutRow(), plan });
    prisma.membership.create.mockResolvedValue({ id: 'm-new', periods: [{ id: 'per-1' }] });

    await service.activate(prisma as never, charge, 'pay-1', now);

    const created = prisma.membership.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ planId: plan.id, userId: user.id, startedAt: now });
    expect(created.periods.create).toMatchObject({
      kind: 'NEW',
      startsAt: now,
      amount: plan.price,
    });
    expect(created.expiresAt.toISOString()).toBe('2027-11-13T12:00:00.000Z');
    expect(prisma.membershipCheckout.update).toHaveBeenCalledWith({
      where: { id: 'chk1' },
      data: { paymentId: 'pay-1', membershipId: 'm-new', periodId: 'per-1', kind: 'NEW' },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'MEMBERSHIP_PURCHASED' }),
    });
  });

  it('renovación: agrega un periodo desde el vencimiento y extiende la vigencia', async () => {
    const { service, prisma } = setup();
    prisma.membershipCheckout.findUnique.mockResolvedValue({ ...checkoutRow(), plan });
    prisma.membership.findUnique.mockResolvedValue(activeMembership('m1', 10));
    prisma.membershipPeriod.create.mockResolvedValue({ id: 'per-2' });

    await service.activate(prisma as never, charge, 'pay-1', now);

    const period = prisma.membershipPeriod.create.mock.calls[0][0].data;
    expect(period.kind).toBe('RENEWAL');
    expect(period.startsAt.getTime()).toBe(now.getTime() + 10 * DAY);
    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { expiresAt: period.endsAt },
    });
  });

  it('si el plan se llenó mientras se pagaba, bloquea (el cobro va a devolución)', async () => {
    const { service, prisma } = setup();
    prisma.membershipCheckout.findUnique.mockResolvedValue({
      ...checkoutRow(),
      plan: { ...plan, maxMembers: 1 },
    });
    prisma.membership.findMany.mockResolvedValue([activeMembership('m-otro', 100)]);

    await expect(service.activate(prisma as never, charge, 'pay-1', now)).rejects.toBeInstanceOf(
      ExternalChargeBlockedError
    );
    expect(prisma.membership.create).not.toHaveBeenCalled();
  });

  it('claim es un update condicional por estado (idempotente ante IPN duplicado)', async () => {
    const { service, prisma } = setup();
    prisma.membershipCheckout.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.claim(prisma as never, 'chk1')).resolves.toBe(false);
    expect(prisma.membershipCheckout.updateMany).toHaveBeenCalledWith({
      where: { id: 'chk1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'COMPLETED', completedAt: expect.any(Date) },
    });
  });

  it('pago fallido: marca FAILED y no activa nada', async () => {
    const { service, prisma } = setup();
    await service.markFailed('chk1');
    expect(prisma.membershipCheckout.updateMany).toHaveBeenCalledWith({
      where: { id: 'chk1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(prisma.membership.create).not.toHaveBeenCalled();
    expect(prisma.membershipPeriod.create).not.toHaveBeenCalled();
  });
});

describe('camino de pago compartido (PaymentService)', () => {
  function paymentSetup() {
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
      paymentIntent: { updateMany: jest.fn() },
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
      paymentIntent: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new PaymentService(
      prisma as never,
      {} as never,
      {} as never,
      { log: jest.fn() } as never
    );
    const banorte = { handleWebhook: jest.fn() };
    (service as unknown as { banorte: typeof banorte }).banorte = banorte;
    const charge: ExternalCharge = {
      id: 'chk1',
      publicId: 'MEM-ABC',
      organizationId: 'org-a',
      status: 'PENDING',
      amount: 2499,
      currency: 'MXN',
      paymentMethod: 'CARD',
    };
    const handler = {
      kind: 'membership',
      find: jest
        .fn()
        .mockImplementation((ref: string) => (ref === 'chk1' || ref === 'MEM-ABC' ? charge : null)),
      claim: jest.fn().mockResolvedValue(true),
      activate: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markPendingRefund: jest.fn().mockResolvedValue(undefined),
    };
    service.registerExternalCharge(handler);
    return { service, prisma, tx, banorte, handler };
  }

  afterEach(() => {
    delete process.env.PAYMENT_STRICT_SETTLEMENT;
  });

  it('una orden normal sigue completándose por completeOrder (sin tocar membresías)', async () => {
    const { service, prisma, banorte, handler } = paymentSetup();
    prisma.order.findUnique.mockResolvedValueOnce({ id: 'ord1', publicId: 'ORD-1' });
    banorte.handleWebhook.mockResolvedValue({
      orderId: 'ord1',
      intentId: 'banorte_x',
      status: 'completed',
      amount: 500,
      currency: 'MXN',
    });
    const complete = jest
      .spyOn(service, 'completeOrder')
      .mockResolvedValue({ alreadyCompleted: false } as never);

    await expect(service.handleBanorteWebhook({})).resolves.toEqual({
      received: true,
      status: 'completed',
    });
    expect(complete).toHaveBeenCalledWith('ord1', 'banorte_x', {
      amount: 500,
      currency: 'MXN',
      rawCode: undefined,
      source: 'banorte_ipn',
    });
    expect(handler.find).not.toHaveBeenCalled();
    expect(handler.activate).not.toHaveBeenCalled();
  });

  it('el IPN de una membresía crea el Payment y activa en la misma transacción', async () => {
    const { service, banorte, handler, tx } = paymentSetup();
    banorte.handleWebhook.mockResolvedValue({
      orderId: 'chk1',
      intentId: 'banorte_m',
      status: 'completed',
      amount: 2499,
      currency: 'MXN',
    });

    await service.handleBanorteWebhook({});

    expect(handler.claim).toHaveBeenCalledWith(tx, 'chk1');
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalId: 'banorte_m', amount: 2499, status: 'COMPLETED' }),
    });
    expect(tx.paymentIntent.updateMany).toHaveBeenCalledWith({
      where: { idempotencyKey: 'membership:chk1', status: 'PENDING' },
      data: { status: 'COMPLETED' },
    });
    expect(handler.activate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 'chk1' }),
      'pay-1'
    );
  });

  it('IPN duplicado: si otro ya lo reclamó, no crea un segundo Payment ni activa', async () => {
    const { service, banorte, handler, tx } = paymentSetup();
    handler.claim.mockResolvedValue(false);
    banorte.handleWebhook.mockResolvedValue({ orderId: 'MEM-ABC', status: 'completed' });

    await service.handleBanorteWebhook({});

    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(handler.activate).not.toHaveBeenCalled();
  });

  it('IPN fallido: marca el checkout FAILED y no activa', async () => {
    const { service, banorte, handler, tx } = paymentSetup();
    banorte.handleWebhook.mockResolvedValue({ orderId: 'chk1', status: 'failed' });

    await service.handleBanorteWebhook({});

    expect(handler.markFailed).toHaveBeenCalledWith('chk1');
    expect(handler.claim).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(handler.activate).not.toHaveBeenCalled();
  });

  it('descuadre de importe en modo estricto: no activa y queda PENDING_REFUND', async () => {
    process.env.PAYMENT_STRICT_SETTLEMENT = 'true';
    const { service, banorte, handler, tx } = paymentSetup();
    banorte.handleWebhook.mockResolvedValue({
      orderId: 'chk1',
      intentId: 'banorte_m',
      status: 'completed',
      amount: 100,
      currency: 'MXN',
    });

    await expect(service.handleBanorteWebhook({})).rejects.toThrow(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(handler.activate).not.toHaveBeenCalled();
    expect(handler.markPendingRefund).toHaveBeenCalledWith(
      'chk1',
      'payment.settlement_mismatch',
      expect.objectContaining({ expectedAmount: 2499, settledAmount: 100 })
    );
  });

  it('descuadre en modo observación: audita y sigue, como completeOrder', async () => {
    const { service, banorte, handler, tx } = paymentSetup();
    banorte.handleWebhook.mockResolvedValue({
      orderId: 'chk1',
      intentId: 'banorte_m',
      status: 'completed',
      amount: 100,
      currency: 'MXN',
    });

    await service.handleBanorteWebhook({});

    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'payment.settlement_mismatch' }),
    });
    expect(handler.activate).toHaveBeenCalled();
  });
});
