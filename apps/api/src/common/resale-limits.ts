/**
 * Topes de reventa desde Organization.settings.
 * Por omisión: precio original + 20 % (1.2). Techo absoluto: 200 % (2.0).
 */

export const DEFAULT_RESALE_MAX_PERCENT = 1.2;
export const ABSOLUTE_RESALE_MAX_PERCENT = 2.0;
export const MIN_RESALE_PRICE_PERCENT = 0.5;
export const DEFAULT_RESALE_FEE_PERCENT = 0.08;

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

/** Factor máximo asking/original. Vacío o inválido → 1.2; nunca por encima de 2.0. */
export function maxPercentFromSettings(settings: unknown): number {
  const raw = settingsRecord(settings).resaleMaxPercent;
  const value = typeof raw === 'number' ? raw : Number(raw);
  const base = Number.isFinite(value) ? value : DEFAULT_RESALE_MAX_PERCENT;
  return Math.min(ABSOLUTE_RESALE_MAX_PERCENT, Math.max(MIN_RESALE_PRICE_PERCENT, base));
}
