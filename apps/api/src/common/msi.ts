/**
 * Meses sin intereses (checkout + Payworks).
 *
 * Configuración por organización en `settings.msi`:
 * `{ minTotal?: number, plans?: number[] }`.
 * También se acepta el legacy `settings.msiMinTotal`.
 * El plan elegido se guarda en `PaymentIntent.installments` y se envía a Banorte
 * vía campos configurables (`BANORTE_MSI_FIELD_*`).
 */

export const DEFAULT_MSI_MIN_TOTAL = 1500;
export const MSI_PLANS = [1, 3, 6, 9, 12] as const;
export type MsiPlan = (typeof MSI_PLANS)[number];

export type MsiConfig = {
  minTotal: number;
  plans: MsiPlan[];
};

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

function msiBlock(settings: unknown): Record<string, unknown> {
  const raw = settingsRecord(settings).msi;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePlans(raw: unknown): MsiPlan[] | null {
  if (!Array.isArray(raw)) return null;
  const plans = raw
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v): v is MsiPlan => isMsiPlan(v));
  const unique = [...new Set(plans)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : null;
}

/** Umbral + plazos ofrecidos (defaults si la org no configuró). */
export function msiConfigFromSettings(settings: unknown): MsiConfig {
  const block = msiBlock(settings);
  const fromBlock = positiveNumber(block.minTotal);
  const legacy = positiveNumber(settingsRecord(settings).msiMinTotal);
  const minTotal = fromBlock ?? legacy ?? DEFAULT_MSI_MIN_TOTAL;
  const plans = parsePlans(block.plans) ?? [...MSI_PLANS];
  // De contado siempre está disponible para no atrapar al comprador.
  if (!plans.includes(1)) plans.unshift(1);
  return { minTotal, plans };
}

/** Umbral en MXN para ofrecer MSI. Vacío → $1,500. */
export function msiMinTotalFromSettings(settings: unknown): number {
  return msiConfigFromSettings(settings).minTotal;
}

export function allowedMsiPlans(settings: unknown): MsiPlan[] {
  return msiConfigFromSettings(settings).plans;
}

export function isMsiPlan(value: unknown): value is MsiPlan {
  return typeof value === 'number' && (MSI_PLANS as readonly number[]).includes(value);
}

/**
 * Plan a persistir. Bajo el umbral → null (no aplica).
 * Pedido inválido o no ofrecido por la org → 1 (de contado).
 */
export function resolveInstallments(
  total: number,
  requested: unknown,
  settings?: unknown
): number | null {
  const { minTotal, plans } = msiConfigFromSettings(settings);
  if (!Number.isFinite(total) || total < minTotal) return null;
  const asNumber = typeof requested === 'number' ? requested : Number(requested);
  if (isMsiPlan(asNumber) && plans.includes(asNumber)) return asNumber;
  return 1;
}
