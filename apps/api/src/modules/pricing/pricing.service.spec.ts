import { Prisma } from '@prisma/client';
import { APPLIED_REASON_PREFIX } from './pricing-recommendations.service';
import { PricingService } from './pricing.service';

// Momento fijo del checkout: el evento empieza dos días después.
const now = new Date('2026-11-13T12:00:00Z');
const startsAt = new Date('2026-11-15T12:00:00Z');
const endsAt = new Date('2026-11-15T18:00:00Z');

// 85 de 100 vendidos (surge 1.3) y 2 días para el evento (×1.25): 1.625 si se ajusta.
const SURGE_X_TIME = 1.3 * 1.25;

type AppliedRow = {
  adjustedPrice: Prisma.Decimal;
  activeFrom: Date;
  activeTo: Date;
  createdAt: Date;
} | null;

function appliedRow(price: number, overrides: Partial<NonNullable<AppliedRow>> = {}): AppliedRow {
  return {
    adjustedPrice: new Prisma.Decimal(price),
    activeFrom: new Date(now.getTime() - 60 * 60 * 1000),
    activeTo: endsAt,
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    ...overrides,
  };
}

function setup(opts: { basePrice: number; applied: AppliedRow; enableDynamic?: boolean }) {
  const prisma = {
    event: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'ev1',
        enableDynamic: opts.enableDynamic ?? true,
        startsAt,
        endsAt,
        organization: { settings: null },
      }),
    },
    offer: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'of1',
        eventId: 'ev1',
        basePrice: new Prisma.Decimal(opts.basePrice),
        totalQuantity: 100,
      }),
    },
    ticket: { count: jest.fn().mockResolvedValue(85) },
    dynamicPrice: { findFirst: jest.fn().mockResolvedValue(opts.applied) },
    promotion: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const audit = { log: jest.fn() };
  const campaigns = { loyaltyChargeCode: jest.fn().mockResolvedValue(null) };
  const service = new PricingService(prisma as never, audit as never, campaigns as never);
  return { service, prisma };
}

const ctx = { eventId: 'ev1', offerId: 'of1', quantity: 1, timestamp: now, skipLoyalty: true };

describe('precio del checkout frente a una recomendación aplicada', () => {
  it('sin recomendación aplicada: surge y tiempo se aplican igual que antes', async () => {
    const { service } = setup({ basePrice: 1000, applied: null });
    const r = await service.calculatePrice(ctx);
    expect(r.dynamicMultiplier).toBeCloseTo(SURGE_X_TIME, 6);
    expect(Number(r.adjustedPrice)).toBeCloseTo(1000 * SURGE_X_TIME, 2);
  });

  it('con recomendación aplicada vigente: cobra basePrice tal cual, sin doble ajuste', async () => {
    // La recomendación ya subió la oferta de 1000 a 1100 (Offer.basePrice = 1100).
    const { service } = setup({ basePrice: 1100, applied: appliedRow(1100) });
    const r = await service.calculatePrice(ctx);
    expect(r.dynamicMultiplier).toBe(1);
    expect(Number(r.adjustedPrice)).toBe(1100);
    expect(Number(r.subtotal)).toBe(1100);
    expect(r.breakdown.appliedRules.some((x) => x.startsWith('Surge'))).toBe(false);
    expect(r.breakdown.appliedRules.some((x) => x.startsWith('Time-based'))).toBe(false);
  });

  it('con cambio manual posterior a la recomendación: vuelve a ajustarse', async () => {
    // La última aplicada dejó 1100, pero el promotor la cambió a mano a 1200.
    const { service } = setup({ basePrice: 1200, applied: appliedRow(1100) });
    const r = await service.calculatePrice(ctx);
    expect(r.dynamicMultiplier).toBeCloseTo(SURGE_X_TIME, 6);
    expect(Number(r.adjustedPrice)).toBeCloseTo(1200 * SURGE_X_TIME, 2);
  });

  it('recomendación cuyo periodo ya terminó: deja de contar y vuelve a ajustarse', async () => {
    const { service } = setup({
      basePrice: 1100,
      applied: appliedRow(1100, { activeTo: new Date(now.getTime() - 1000) }),
    });
    const r = await service.calculatePrice(ctx);
    expect(r.dynamicMultiplier).toBeCloseTo(SURGE_X_TIME, 6);
  });

  it('busca solo la última fila applied_recommendation de la oferta', async () => {
    const { service, prisma } = setup({ basePrice: 1100, applied: appliedRow(1100) });
    await service.calculatePrice(ctx);
    const args = prisma.dynamicPrice.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ offerId: 'of1', reason: { startsWith: APPLIED_REASON_PREFIX } });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('con precio dinámico apagado no consulta recomendaciones ni ajusta', async () => {
    const { service, prisma } = setup({ basePrice: 1000, applied: null, enableDynamic: false });
    const r = await service.calculatePrice(ctx);
    expect(r.dynamicMultiplier).toBe(1);
    expect(prisma.dynamicPrice.findFirst).not.toHaveBeenCalled();
  });
});
