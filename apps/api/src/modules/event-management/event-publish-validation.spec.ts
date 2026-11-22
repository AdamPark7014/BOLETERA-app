import { buildEventPublishValidation, hasCapacityExplanation } from './event-publish-validation';

function baseInput(over: Partial<Parameters<typeof buildEventPublishValidation>[0]> = {}) {
  return {
    eventId: 'ev1',
    venue: { id: 'v1', name: 'Foro' },
    map: {
      sectionCount: 2,
      seatCount: 100,
      geometryErrors: 0,
      geometryWarnings: 0,
      layoutPublishStatus: 'PUBLISHED',
    },
    pricing: { minPrice: 100, offerCount: 1, pricedOfferCount: 1, unpricedOfferCount: 0 },
    payment: { ready: true, demo: false, missing: [], warnings: [] },
    refund: { refundable: true, hasDocumentedTerms: true },
    images: { hasImage: true, hasBanner: false },
    channels: { configured: true, allocationTotal: 100, enabledCount: 2 },
    inventory: {
      published: false,
      ticketCount: 0,
      layoutSeatCount: 100,
      totalCapacity: 100,
    },
    salesWindow: { hasStart: true, hasEnd: true, valid: true },
    capacityMatch: {
      declared: 100,
      mapSeats: 100,
      matches: true,
      hasExplanation: false,
    },
    ...over,
  };
}

describe('buildEventPublishValidation (micro A)', () => {
  it('marca listo cuando cupo = mapa e imagen y ventana están', () => {
    const result = buildEventPublishValidation(baseInput());
    expect(result.ready).toBe(true);
    expect(result.checks.find((c) => c.id === 'capacity')?.status).toBe('ok');
    expect(result.checks.find((c) => c.id === 'images')?.status).toBe('ok');
    expect(result.checks.find((c) => c.id === 'sales_window')?.status).toBe('ok');
  });

  it('bloquea cupo ≠ mapa con acción sync_capacity', () => {
    const result = buildEventPublishValidation(
      baseInput({
        capacityMatch: {
          declared: 80,
          mapSeats: 100,
          matches: false,
          hasExplanation: false,
        },
        inventory: {
          published: false,
          ticketCount: 0,
          layoutSeatCount: 100,
          totalCapacity: 80,
        },
      })
    );
    expect(result.ready).toBe(false);
    const capacity = result.checks.find((c) => c.id === 'capacity');
    expect(capacity?.status).toBe('blocker');
    expect(capacity?.action?.id).toBe('sync_capacity');
    expect(capacity?.message).toMatch(/80/);
    expect(capacity?.message).toMatch(/100/);
  });

  it('con explicación el desfase es aviso, no bloqueo', () => {
    const result = buildEventPublishValidation(
      baseInput({
        capacityMatch: {
          declared: 80,
          mapSeats: 100,
          matches: false,
          hasExplanation: true,
        },
      })
    );
    expect(result.checks.find((c) => c.id === 'capacity')?.status).toBe('warning');
    expect(result.ready).toBe(true);
  });

  it('sin imagen bloquea con acción edit_image', () => {
    const result = buildEventPublishValidation(
      baseInput({ images: { hasImage: false, hasBanner: false } })
    );
    const images = result.checks.find((c) => c.id === 'images');
    expect(images?.status).toBe('blocker');
    expect(images?.action?.id).toBe('edit_image');
    expect(result.ready).toBe(false);
  });

  it('sin ventana de venta bloquea', () => {
    const result = buildEventPublishValidation(
      baseInput({ salesWindow: { hasStart: false, hasEnd: false, valid: true } })
    );
    expect(result.checks.find((c) => c.id === 'sales_window')?.status).toBe('blocker');
  });

  it('hasCapacityExplanation exige 20 caracteres', () => {
    expect(hasCapacityExplanation(null)).toBe(false);
    expect(hasCapacityExplanation({ capacityExplanation: 'corto' })).toBe(false);
    expect(
      hasCapacityExplanation({
        capacityExplanation: 'Vendemos solo platea; el mapa incluye gradas cerradas.',
      })
    ).toBe(true);
  });
});
