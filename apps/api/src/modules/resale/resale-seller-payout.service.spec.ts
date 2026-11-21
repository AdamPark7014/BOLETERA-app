import { BadRequestException } from '@nestjs/common';
import { ResaleSellerPayoutService } from './resale-seller-payout.service';

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    resaleCheckout: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ resalePayoutClabe: null }),
    },
    ...overrides,
  };
}

describe('ResaleSellerPayoutService', () => {
  const audit = { log: jest.fn() };

  it('rechaza CLABE inválida', async () => {
    const service = new ResaleSellerPayoutService(mockPrisma() as never, audit as never);
    await expect(service.saveSellerClabe('u1', '123')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marca pagado con referencia y auditoría', async () => {
    const row = {
      id: 'c1',
      payoutStatus: 'PENDING',
      sellerPayout: { toString: () => '1000' },
    };
    const prisma = mockPrisma({
      resaleCheckout: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({
          ...row,
          payoutStatus: 'PAID',
          payoutReference: 'SPEI-1',
          payoutPaidAt: new Date('2026-11-21T12:00:00Z'),
          sellerPayout: { toString: () => '1000' },
        }),
        updateMany: jest.fn(),
      },
    });
    const service = new ResaleSellerPayoutService(prisma as never, audit as never);
    const out = await service.markPaid(
      'org1',
      'c1',
      { id: 'admin1', role: 'FINANCE' },
      { reference: 'SPEI-1' }
    );
    expect(out.payoutStatus).toBe('PAID');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESALE_SELLER_PAYOUT_PAID' })
    );
  });
});
