import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderStatus, ResaleStatus, TicketStatus } from '@prisma/client';
import { ExternalChargeBlockedError } from '../payment/payment.service';
import { ResaleCheckoutService } from './resale-checkout.service';

const future = new Date(Date.now() + 7 * 86_400_000);

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    sellerId: 'seller',
    status: ResaleStatus.ACTIVE,
    delisted: false,
    askingPrice: 1000,
    fee: 80,
    currency: 'MXN',
    ticket: {
      id: 't1',
      eventId: 'e1',
      offerId: 'o1',
      status: TicketStatus.RESOLD,
      event: { organizationId: 'org', title: 'Concierto', startsAt: future },
    },
    ...overrides,
  };
}

function build(prisma: Record<string, unknown>) {
  const payments = {
    registerExternalCharge: jest.fn(),
    createExternalPaymentIntent: jest.fn().mockResolvedValue({ redirectUrl: 'https://pago' }),
  };
  const audit = { log: jest.fn() };
  return {
    service: new ResaleCheckoutService(prisma as never, audit as never, payments as never),
    payments,
  };
}

describe('ResaleCheckoutService', () => {
  it('no deja comprar el propio anuncio', async () => {
    const { service } = build({
      resaleListing: { findUnique: jest.fn().mockResolvedValue(listing()) },
    });
    await expect(service.start('seller', 'l1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un anuncio vendido ya no se puede comprar', async () => {
    const { service } = build({
      resaleListing: {
        findUnique: jest.fn().mockResolvedValue(listing({ status: ResaleStatus.SOLD })),
      },
    });
    await expect(service.start('buyer', 'l1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cobra precio + cargo y aparta el anuncio con un cobro con tarjeta', async () => {
    const created = {
      id: 'c1',
      publicId: 'RSL-X',
      organizationId: 'org',
      status: OrderStatus.PENDING,
      amount: { toString: () => '1080' },
      fee: { toString: () => '80' },
      currency: 'MXN',
      paymentMethod: 'CARD',
      expiresAt: new Date(),
    };
    const tx = {
      resaleCheckout: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const { service, payments } = build({
      resaleListing: { findUnique: jest.fn().mockResolvedValue(listing()) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ email: 'b@x.mx', firstName: 'Ana', lastName: '' }),
      },
      resaleCheckout: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    });
    const res = await service.start('buyer', 'l1');
    const data = tx.resaleCheckout.create.mock.calls[0][0].data;
    expect(Number(data.amount)).toBe(1080);
    expect(Number(data.sellerPayout)).toBe(1000);
    expect(data.paymentMethod).toBe('CARD');
    expect(payments.createExternalPaymentIntent).toHaveBeenCalled();
    expect(res.payment.redirectUrl).toBe('https://pago');
  });

  it('si el anuncio ya no estaba activo al cobrar, no entrega y manda a devolución', async () => {
    const tx = {
      resaleCheckout: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          publicId: 'RSL-X',
          listing: listing(),
        }),
      },
      resaleListing: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const { service } = build({});
    await expect(
      service.activate(tx as never, { id: 'c1' } as never, 'pay1')
    ).rejects.toBeInstanceOf(ExternalChargeBlockedError);
  });
});
