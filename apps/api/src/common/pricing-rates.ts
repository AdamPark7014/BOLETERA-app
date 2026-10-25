/**
 * Cargos e impuestos — fuente única de verdad.
 *
 * Estaban escritos a mano dentro de `pricing.service` (`subtotal.mul(0.1)` y
 * `subtotal.mul(0.16)`) y en ningún otro sitio, con dos consecuencias:
 *
 * 1. El precio «desde» que ve el comprador en el catálogo y en la ficha del
 *    evento salía de `Offer.basePrice`, SIN cargos ni IVA. Con las tarifas
 *    actuales eso es un 26% por debajo de lo que realmente se cobra: se anuncia
 *    «Desde $1,000» y en el checkout aparecen $1,260.
 *
 *    Eso es exactamente el *drip pricing* que la FTC prohibió en mayo de 2025 y
 *    por el que demandó a Ticketmaster en septiembre de ese año, y lo que la
 *    LFPC exige mostrar como precio total en México. Es también la queja de
 *    consumidor más repetida del sector.
 *
 * 2. Cambiar una tarifa obligaba a tocar código.
 *
 * El precio que se anuncia y el que se cobra salen ahora del mismo sitio.
 */

function envRate(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  // Una tarifa negativa o mayor que 1 casi siempre es un dedazo (16 en vez de
  // 0.16): mejor ignorarla que multiplicar por 16 el precio de un boleto.
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

/** Cargo por servicio de la plataforma. Vacío en la organización = este número. */
export const SERVICE_FEE_RATE = envRate('PRICING_SERVICE_FEE_RATE', 0.1);

/** IVA. 16% general en México. Vacío en la organización = este número. */
export const TAX_RATE = envRate('PRICING_TAX_RATE', 0.16);

/** Llaves dentro de `Organization.settings`. Vacío = la tasa de entorno. */
export const RATE_SETTING_KEYS = {
  serviceFee: 'serviceFeeRate',
  tax: 'taxRate',
} as const;

export type OrgPricingRates = {
  serviceFeeRate: number;
  taxRate: number;
  serviceFeeSaved: boolean;
  taxSaved: boolean;
};

export type RatePatch = {
  serviceFeeRate?: number;
  taxRate?: number;
};

export interface PriceBreakdown {
  /** Lo que recibe el promotor por el boleto. */
  base: number;
  /** Cargo por servicio. */
  fees: number;
  /** Impuesto. */
  taxes: number;
  /** Lo que el comprador paga de verdad. Es el número que debe anunciarse. */
  total: number;
}

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

/** Tasa guardada. Ausente o fuera de 0–1 no cuenta: sigue el entorno. */
function storedRate(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

/**
 * Tasas que leen el cálculo, el checkout y el precio anunciado.
 * Si la llave no está en `Organization.settings`, queda la del entorno.
 */
export function ratesFromSettings(settings: unknown): OrgPricingRates {
  const record = settingsRecord(settings);
  const serviceFee = storedRate(record[RATE_SETTING_KEYS.serviceFee]);
  const tax = storedRate(record[RATE_SETTING_KEYS.tax]);
  return {
    serviceFeeRate: serviceFee ?? SERVICE_FEE_RATE,
    taxRate: tax ?? TAX_RATE,
    serviceFeeSaved: serviceFee != null,
    taxSaved: tax != null,
  };
}

/** Conserva el resto del JSON (PIN, plazos, umbral) y escribe solo lo que llega. */
export function mergeRateSettings(settings: unknown, patch: RatePatch): Record<string, unknown> {
  const next = { ...settingsRecord(settings) };
  if (patch.serviceFeeRate != null) {
    next[RATE_SETTING_KEYS.serviceFee] = patch.serviceFeeRate;
  }
  if (patch.taxRate != null) {
    next[RATE_SETTING_KEYS.tax] = patch.taxRate;
  }
  return next;
}

/** Desglose completo a partir del precio base. La fórmula es base + cargo + IVA. */
export function priceBreakdown(
  base: number,
  rates?: Pick<OrgPricingRates, 'serviceFeeRate' | 'taxRate'>,
): PriceBreakdown {
  const safeBase = Number.isFinite(base) && base > 0 ? base : 0;
  const feeRate = rates?.serviceFeeRate ?? SERVICE_FEE_RATE;
  const taxRate = rates?.taxRate ?? TAX_RATE;
  const fees = round2(safeBase * feeRate);
  const taxes = round2(safeBase * taxRate);
  return { base: round2(safeBase), fees, taxes, total: round2(safeBase + fees + taxes) };
}

/** Precio final al comprador. Es el que va en «desde $X». */
export function allInPrice(
  base: number,
  rates?: Pick<OrgPricingRates, 'serviceFeeRate' | 'taxRate'>,
): number {
  return priceBreakdown(base, rates).total;
}

/** Redondeo a centavos, evitando el arrastre binario de los flotantes. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
