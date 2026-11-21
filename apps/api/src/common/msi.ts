/**
 * Meses sin intereses (presentación en checkout).
 *
 * Banorte Payworks aún no expone MSI en el adaptador de este repo: el plan
 * elegido se guarda en `PaymentIntent.installments` para liquidación/UI, sin
 * inventar llamadas al proveedor.
 */

export const DEFAULT_MSI_MIN_TOTAL = 1500;
export const MSI_PLANS = [1, 3, 6, 9, 12] as const;
export type MsiPlan = (typeof MSI_PLANS)[number];

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

/** Umbral en MXN para ofrecer MSI. Vacío en settings → $1,500. */
export function msiMinTotalFromSettings(settings: unknown): number {
  const raw = settingsRecord(settings).msiMinTotal;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MSI_MIN_TOTAL;
}

export function isMsiPlan(value: unknown): value is MsiPlan {
  return typeof value === 'number' && (MSI_PLANS as readonly number[]).includes(value);
}

/**
 * Plan a persistir. Bajo el umbral → null (no aplica).
 * Pedido inválido → 1 (de contado).
 */
export function resolveInstallments(
  total: number,
  requested: unknown,
  settings?: unknown
): number | null {
  const min = msiMinTotalFromSettings(settings);
  if (!Number.isFinite(total) || total < min) return null;
  if (isMsiPlan(requested)) return requested;
  const asNumber = typeof requested === 'number' ? requested : Number(requested);
  if (isMsiPlan(asNumber)) return asNumber;
  return 1;
}
