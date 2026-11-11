/**
 * Motor de recomendaciones de precio. Determinista y sin modelos: las mismas
 * cifras de la base dan siempre la misma recomendación.
 *
 * Por oferta se miden tres señales reales:
 *
 *  - Ritmo de venta: vendido / inventario (`actualPace`) contra la parte de la
 *    ventana de venta ya transcurrida (`expectedPace`). La ventana va de
 *    `Offer.startDate` a la primera de `Offer.endDate` o `Event.startsAt`. Se
 *    supone venta lineal: a mitad de la ventana se esperaría la mitad vendida.
 *  - Inventario: proporción vendida del inventario de la oferta.
 *  - Tiempo restante: días hasta el cierre de la venta.
 *
 * Reglas (factor multiplicativo; 1 = no mueve el precio):
 *
 *  R0 Enfriamiento. Si a la oferta se le aplicó un precio hace menos de 24 h,
 *     se mantiene: las señales aún no reflejan el cambio y repetir la misma
 *     regla lo volvería a mover en la misma dirección.
 *  R1 Ritmo. Solo cuenta con ≥ 10 % de la ventana transcurrida.
 *     paceDelta ≥ +0.20 → ×1.10 · ≥ +0.10 → ×1.05
 *     paceDelta ≤ −0.25 → ×0.90 · ≤ −0.15 → ×0.95
 *  R2 Inventario. vendido ≥ 90 % → ×1.10 · ≥ 75 % → ×1.05
 *  R3 Tiempo. Faltan ≤ 7 días y vendido < 50 % → ×0.95 (liberar inventario).
 *  R4 Banda. El precio final queda entre 70 % y 150 % del precio de referencia
 *     (el precio con que la oferta salió antes de la primera recomendación
 *     aplicada), para que aplicar varias veces no lo dispare ni lo hunda.
 *  R5 Redondeo a pesos enteros. Un cambio menor a 1 % se reporta como «mantener».
 *
 * Aprobación: un cambio se aplica solo (`autoApplicable`) si el evento tiene el
 * precio dinámico activo, el cambio es de ±5 % o menos y la confianza no es
 * baja. Todo lo demás exige firma humana (`requiresApproval`).
 *
 * Confianza: alta con ≥ 30 % de la ventana transcurrida, media con ≥ 10 %,
 * baja antes de eso.
 *
 * Venta cerrada, oferta fuera de venta o inventario 0 → «mantener».
 */

export type PricingDirection = 'increase' | 'decrease' | 'hold';
export type PricingConfidence = 'high' | 'medium' | 'low';
export type PricingFactorCode = 'sales_pace' | 'occupancy' | 'time' | 'inventory' | 'price_band';

export type PricingFactor = {
  code: PricingFactorCode;
  contribution: number;
  detail: string;
  metricValue: number;
  threshold?: number;
};

export type PricingGuardrail = {
  floor: number;
  ceiling: number;
  clamped: boolean;
  preClampPrice: number;
  bandLabel: string;
};

export type OfferInput = {
  offerId: string;
  name: string;
  zone: string;
  currentPrice: number;
  /** Precio antes de la primera recomendación aplicada; si no hay, el actual. */
  referencePrice: number;
  totalQuantity: number;
  sold: number;
  saleStart: Date;
  saleEnd: Date;
  isAvailable: boolean;
  /** Última recomendación aplicada a la oferta, si la hay. */
  lastAppliedAt?: Date | null;
};

export type OfferRecommendation = {
  offerId: string;
  zone: string;
  name: string;
  basePrice: number;
  currentPrice: number;
  recommendedPrice: number;
  recommendedMultiplier: number;
  direction: PricingDirection;
  deltaPercent: number;
  factors: PricingFactor[];
  guardrail: PricingGuardrail;
  requiresApproval: boolean;
  autoApplicable: boolean;
  explanation: string;
  confidence: PricingConfidence;
};

export const RULES = {
  minElapsedForPace: 0.1,
  paceStrongUp: 0.2,
  paceUp: 0.1,
  paceStrongDown: -0.25,
  paceDown: -0.15,
  inventoryHigh: 0.9,
  inventoryMid: 0.75,
  lastDays: 7,
  lastDaysOccupancy: 0.5,
  bandFloor: 0.7,
  bandCeiling: 1.5,
  holdBelow: 0.01,
  autoMaxDelta: 0.05,
  confidenceHigh: 0.3,
  confidenceMedium: 0.1,
  cooldownHours: 24,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** Proporción de la ventana de venta ya transcurrida (0–1). */
export function elapsedShare(saleStart: Date, saleEnd: Date, now: Date): number {
  const span = saleEnd.getTime() - saleStart.getTime();
  if (span <= 0) return now.getTime() >= saleEnd.getTime() ? 1 : 0;
  return clamp01((now.getTime() - saleStart.getTime()) / span);
}

function confidenceOf(elapsed: number): PricingConfidence {
  if (elapsed >= RULES.confidenceHigh) return 'high';
  if (elapsed >= RULES.confidenceMedium) return 'medium';
  return 'low';
}

function holdResult(input: OfferInput, explanation: string, factors: PricingFactor[] = []) {
  const reference = input.referencePrice > 0 ? input.referencePrice : input.currentPrice;
  const result: OfferRecommendation = {
    offerId: input.offerId,
    zone: input.zone,
    name: input.name,
    basePrice: reference,
    currentPrice: input.currentPrice,
    recommendedPrice: input.currentPrice,
    recommendedMultiplier: 1,
    direction: 'hold',
    deltaPercent: 0,
    factors,
    guardrail: {
      floor: round2(reference * RULES.bandFloor),
      ceiling: round2(reference * RULES.bandCeiling),
      clamped: false,
      preClampPrice: input.currentPrice,
      bandLabel: bandLabel(),
    },
    requiresApproval: false,
    autoApplicable: false,
    explanation,
    confidence: 'low',
  };
  return result;
}

function bandLabel(): string {
  return `${Math.round(RULES.bandFloor * 100)}–${Math.round(RULES.bandCeiling * 100)} % del precio de referencia`;
}

export function recommendOffer(
  input: OfferInput,
  now: Date,
  opts: { enableDynamic: boolean }
): OfferRecommendation {
  if (!input.isAvailable)
    return holdResult(input, 'Oferta fuera de venta: no se recomienda cambio.');
  if (input.totalQuantity <= 0)
    return holdResult(input, 'Oferta sin inventario: no hay base para medir.');
  if (input.currentPrice <= 0)
    return holdResult(input, 'Oferta sin precio (cortesía): no se recomienda cambio.');
  if (now.getTime() >= input.saleEnd.getTime()) {
    return holdResult(input, 'La venta de esta oferta ya cerró.');
  }
  if (
    input.lastAppliedAt &&
    now.getTime() - input.lastAppliedAt.getTime() < RULES.cooldownHours * 60 * 60 * 1000
  ) {
    return holdResult(
      input,
      `Se cambió el precio hace menos de ${RULES.cooldownHours} h: se espera a ver su efecto.`
    );
  }

  const elapsed = elapsedShare(input.saleStart, input.saleEnd, now);
  const occupancy = clamp01(input.sold / input.totalQuantity);
  const paceDelta = occupancy - elapsed;
  const daysLeft = (input.saleEnd.getTime() - now.getTime()) / DAY_MS;
  const factors: PricingFactor[] = [];

  // R1 — ritmo de venta contra lo esperado.
  let pace = 1;
  if (elapsed >= RULES.minElapsedForPace) {
    if (paceDelta >= RULES.paceStrongUp) pace = 1.1;
    else if (paceDelta >= RULES.paceUp) pace = 1.05;
    else if (paceDelta <= RULES.paceStrongDown) pace = 0.9;
    else if (paceDelta <= RULES.paceDown) pace = 0.95;
  }
  factors.push({
    code: 'sales_pace',
    contribution: pace,
    metricValue: round2(paceDelta),
    detail:
      elapsed < RULES.minElapsedForPace
        ? `Solo ha pasado ${pct(elapsed)} de la ventana de venta: aún no cuenta.`
        : `Vendido ${pct(occupancy)} con ${pct(elapsed)} de la ventana transcurrida.`,
  });

  // R2 — inventario restante.
  let inventory = 1;
  if (occupancy >= RULES.inventoryHigh) inventory = 1.1;
  else if (occupancy >= RULES.inventoryMid) inventory = 1.05;
  factors.push({
    code: 'inventory',
    contribution: inventory,
    metricValue: round2(occupancy),
    threshold:
      inventory > 1 ? (inventory === 1.1 ? RULES.inventoryHigh : RULES.inventoryMid) : undefined,
    detail: `Quedan ${Math.max(0, input.totalQuantity - input.sold)} de ${input.totalQuantity}.`,
  });

  // R3 — tiempo restante.
  let time = 1;
  if (daysLeft <= RULES.lastDays && occupancy < RULES.lastDaysOccupancy) time = 0.95;
  factors.push({
    code: 'time',
    contribution: time,
    metricValue: round2(daysLeft),
    threshold: RULES.lastDays,
    detail:
      time < 1
        ? `Faltan ${Math.ceil(daysLeft)} días y se ha vendido menos de la mitad.`
        : `Faltan ${Math.ceil(daysLeft)} días para cerrar la venta.`,
  });

  const reference = input.referencePrice > 0 ? input.referencePrice : input.currentPrice;
  const multiplier = pace * inventory * time;
  const preClamp = round2(input.currentPrice * multiplier);
  const floor = round2(reference * RULES.bandFloor);
  const ceiling = round2(reference * RULES.bandCeiling);
  const clampedPrice = Math.min(ceiling, Math.max(floor, preClamp));
  const clamped = clampedPrice !== preClamp;
  if (clamped) {
    factors.push({
      code: 'price_band',
      contribution: round2(clampedPrice / preClamp),
      metricValue: clampedPrice,
      detail: `Recortado a la banda ${bandLabel()}.`,
    });
  }

  // R5 — pesos enteros; un cambio menor a 1 % no se propone.
  const rounded = Math.round(clampedPrice);
  const delta = rounded / input.currentPrice - 1;
  const confidence = confidenceOf(elapsed);
  if (Math.abs(delta) < RULES.holdBelow) {
    const held = holdResult(input, 'Las señales no justifican mover el precio.', factors);
    held.confidence = confidence;
    held.guardrail.clamped = clamped;
    held.guardrail.preClampPrice = preClamp;
    return held;
  }

  const direction: PricingDirection = delta > 0 ? 'increase' : 'decrease';
  // Tolerancia de coma flotante: 1050 / 1000 - 1 da 0.05000000000000004.
  const small = Math.abs(delta) <= RULES.autoMaxDelta + 1e-9;
  const autoApplicable = opts.enableDynamic && small && confidence !== 'low';
  const moving = factors
    .filter((factor) => factor.contribution !== 1)
    .map((factor) => factor.detail);

  return {
    offerId: input.offerId,
    zone: input.zone,
    name: input.name,
    basePrice: reference,
    currentPrice: input.currentPrice,
    recommendedPrice: rounded,
    recommendedMultiplier: round2(rounded / input.currentPrice),
    direction,
    deltaPercent: Math.round(delta * 10000) / 10000,
    factors,
    guardrail: { floor, ceiling, clamped, preClampPrice: preClamp, bandLabel: bandLabel() },
    requiresApproval: !autoApplicable,
    autoApplicable,
    explanation:
      `${direction === 'increase' ? 'Subir' : 'Bajar'} ${pct(Math.abs(delta))}. ${moving.join(' ')}`.trim(),
    confidence,
  };
}

export type BundleSignals = {
  daysUntilEvent: number;
  expectedPace: number;
  actualPace: number;
  paceDelta: number;
  occupancyPercent: number;
  soldTickets: number;
  totalCapacity: number;
};

/** Señales del evento: sumas de las ofertas, ritmo esperado ponderado por inventario. */
export function eventSignals(
  offers: readonly OfferInput[],
  eventStartsAt: Date,
  now: Date
): BundleSignals {
  const totalCapacity = offers.reduce((sum, offer) => sum + Math.max(0, offer.totalQuantity), 0);
  const soldTickets = offers.reduce((sum, offer) => sum + Math.max(0, offer.sold), 0);
  const expectedWeighted = offers.reduce(
    (sum, offer) =>
      sum + Math.max(0, offer.totalQuantity) * elapsedShare(offer.saleStart, offer.saleEnd, now),
    0
  );
  const expectedPace = totalCapacity > 0 ? expectedWeighted / totalCapacity : 0;
  const actualPace = totalCapacity > 0 ? soldTickets / totalCapacity : 0;
  return {
    daysUntilEvent: Math.round(((eventStartsAt.getTime() - now.getTime()) / DAY_MS) * 10) / 10,
    expectedPace: Math.round(expectedPace * 10000) / 10000,
    actualPace: Math.round(actualPace * 10000) / 10000,
    paceDelta: Math.round((actualPace - expectedPace) * 10000) / 10000,
    occupancyPercent: Math.round(actualPace * 10000) / 100,
    soldTickets,
    totalCapacity,
  };
}

export function bundleSummary(recommendations: readonly OfferRecommendation[]): string {
  if (recommendations.length === 0) return 'El evento no tiene ofertas.';
  const up = recommendations.filter((item) => item.direction === 'increase').length;
  const down = recommendations.filter((item) => item.direction === 'decrease').length;
  const hold = recommendations.length - up - down;
  return `${up} para subir, ${down} para bajar, ${hold} sin cambio.`;
}
