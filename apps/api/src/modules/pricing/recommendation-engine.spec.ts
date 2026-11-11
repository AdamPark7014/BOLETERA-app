import { eventSignals, recommendOffer, type OfferInput } from './recommendation-engine';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-11T12:00:00Z');

/** Ventana de 100 días; `elapsedDays` ya transcurridos. */
function offer(overrides: Partial<OfferInput> & { elapsedDays?: number } = {}): OfferInput {
  const elapsedDays = overrides.elapsedDays ?? 50;
  const { elapsedDays: _ignored, ...rest } = overrides;
  return {
    offerId: 'o1',
    name: 'Platea',
    zone: 'Platea',
    currentPrice: 1000,
    referencePrice: 1000,
    totalQuantity: 100,
    sold: 50,
    saleStart: new Date(now.getTime() - elapsedDays * DAY),
    saleEnd: new Date(now.getTime() + (100 - elapsedDays) * DAY),
    isAvailable: true,
    ...rest,
  };
}

describe('motor de recomendaciones', () => {
  it('a ritmo esperado mantiene el precio', () => {
    const r = recommendOffer(offer(), now, { enableDynamic: true });
    expect(r.direction).toBe('hold');
    expect(r.recommendedPrice).toBe(1000);
    expect(r.requiresApproval).toBe(false);
    expect(r.autoApplicable).toBe(false);
  });

  it('venta adelantada ≥ 20 puntos sube 10 % y pide aprobación (> 5 %)', () => {
    const r = recommendOffer(offer({ sold: 72 }), now, { enableDynamic: true });
    expect(r.direction).toBe('increase');
    expect(r.recommendedPrice).toBe(1100);
    expect(r.deltaPercent).toBeCloseTo(0.1);
    expect(r.requiresApproval).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('+5 % con dinámico activo se aplica solo; sin dinámico va a aprobación', () => {
    const on = recommendOffer(offer({ sold: 62 }), now, { enableDynamic: true });
    expect(on.recommendedPrice).toBe(1050);
    expect(on.autoApplicable).toBe(true);
    expect(on.requiresApproval).toBe(false);
    const off = recommendOffer(offer({ sold: 62 }), now, { enableDynamic: false });
    expect(off.autoApplicable).toBe(false);
    expect(off.requiresApproval).toBe(true);
  });

  it('venta atrasada baja el precio', () => {
    const r = recommendOffer(offer({ sold: 20 }), now, { enableDynamic: true });
    expect(r.direction).toBe('decrease');
    expect(r.recommendedPrice).toBe(900);
  });

  it('inventario casi agotado suma el factor de inventario', () => {
    const r = recommendOffer(offer({ sold: 95, elapsedDays: 90 }), now, { enableDynamic: true });
    const inventory = r.factors.find((f) => f.code === 'inventory');
    expect(inventory?.contribution).toBe(1.1);
    expect(r.recommendedPrice).toBe(1100);
  });

  it('última semana con menos de la mitad vendida combina ritmo y tiempo', () => {
    const r = recommendOffer(offer({ sold: 30, elapsedDays: 95 }), now, { enableDynamic: true });
    // ritmo ×0.90 · tiempo ×0.95
    expect(r.recommendedPrice).toBe(855);
    expect(r.factors.find((f) => f.code === 'time')?.contribution).toBe(0.95);
  });

  it('antes del 10 % de la ventana el ritmo no cuenta y la confianza es baja', () => {
    const r = recommendOffer(offer({ sold: 0, elapsedDays: 5 }), now, { enableDynamic: true });
    expect(r.direction).toBe('hold');
    expect(r.confidence).toBe('low');
  });

  it('la banda recorta contra el precio de referencia', () => {
    const r = recommendOffer(offer({ sold: 20, currentPrice: 720, referencePrice: 1000 }), now, {
      enableDynamic: true,
    });
    expect(r.guardrail.floor).toBe(700);
    expect(r.guardrail.clamped).toBe(true);
    expect(r.recommendedPrice).toBe(700);
    expect(r.factors.some((f) => f.code === 'price_band')).toBe(true);
  });

  it('mantiene si la venta cerró, la oferta no está a la venta o no tiene inventario', () => {
    expect(
      recommendOffer(offer({ elapsedDays: 120 }), now, { enableDynamic: true }).direction
    ).toBe('hold');
    expect(
      recommendOffer(offer({ isAvailable: false, sold: 90 }), now, { enableDynamic: true })
        .direction
    ).toBe('hold');
    expect(
      recommendOffer(offer({ totalQuantity: 0, sold: 0 }), now, { enableDynamic: true }).direction
    ).toBe('hold');
  });

  it('enfriamiento: un precio aplicado hace menos de 24 h se mantiene', () => {
    const recent = recommendOffer(
      offer({ sold: 20, lastAppliedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) }),
      now,
      { enableDynamic: true }
    );
    expect(recent.direction).toBe('hold');
    const old = recommendOffer(
      offer({ sold: 20, lastAppliedAt: new Date(now.getTime() - 2 * DAY) }),
      now,
      { enableDynamic: true }
    );
    expect(old.direction).toBe('decrease');
  });

  it('es determinista', () => {
    const a = recommendOffer(offer({ sold: 33 }), now, { enableDynamic: true });
    const b = recommendOffer(offer({ sold: 33 }), now, { enableDynamic: true });
    expect(a).toEqual(b);
  });

  it('señales del evento: ritmo esperado ponderado por inventario', () => {
    const signals = eventSignals(
      [
        offer({ totalQuantity: 100, sold: 50 }),
        offer({ offerId: 'o2', totalQuantity: 300, sold: 0, elapsedDays: 0 }),
      ],
      new Date(now.getTime() + 60 * DAY),
      now
    );
    expect(signals.totalCapacity).toBe(400);
    expect(signals.soldTickets).toBe(50);
    expect(signals.expectedPace).toBeCloseTo(0.125);
    expect(signals.occupancyPercent).toBeCloseTo(12.5);
  });

  it('sin ofertas las señales quedan en cero', () => {
    const signals = eventSignals([], now, now);
    expect(signals).toMatchObject({
      totalCapacity: 0,
      soldTickets: 0,
      expectedPace: 0,
      actualPace: 0,
    });
  });
});
