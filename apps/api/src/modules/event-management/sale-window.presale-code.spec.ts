import { EventStatus, SalePhaseStatus, SalesChannel } from '@boletera/database';
import { SaleWindowService } from './sale-window.service';

/** Preventa con código: sin código, código malo y código bueno (en minúsculas). */
describe('SaleWindowService · código de preventa', () => {
  const at = new Date('2026-12-01T18:00:00Z');
  const phase = {
    id: 'ph1',
    name: 'Preventa fans',
    kind: 'PRESALE',
    startsAt: new Date('2026-11-30T00:00:00Z'),
    endsAt: new Date('2026-12-05T00:00:00Z'),
    status: SalePhaseStatus.ACTIVE,
    channels: [] as SalesChannel[],
    maxPerOrder: 4,
    discountPercent: null,
    allocationPercent: null,
    code: 'FANS2026',
    priority: 1,
  };
  const event = {
    id: 'ev1',
    status: EventStatus.LIVE,
    startsAt: new Date('2026-12-20T02:00:00Z'),
    totalCapacity: 1000,
    salesStartAt: null,
    salesEndAt: null,
    salePhases: [phase],
  };

  function build() {
    const prisma = { event: { findUnique: jest.fn().mockResolvedValue(event) } };
    const profeco = { check: jest.fn().mockResolvedValue({ compliant: true }) };
    return new SaleWindowService(
      prisma as never,
      { reserve: jest.fn(), release: jest.fn() } as never,
      {} as never,
      profeco as never
    );
  }

  it('sin código pide el código', async () => {
    const d = await build().checkSaleWindow('ev1', { at, channel: SalesChannel.WEB });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('CODE_REQUIRED');
  });

  it('con código equivocado dice que no es válido', async () => {
    const d = await build().checkSaleWindow('ev1', { at, code: 'OTRO' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('CODE_INVALID');
  });

  it('con el código correcto abre la venta sin importar mayúsculas', async () => {
    const d = await build().checkSaleWindow('ev1', { at, code: ' fans2026 ' });
    expect(d.allowed).toBe(true);
    expect(d.phase?.id).toBe('ph1');
  });
});
