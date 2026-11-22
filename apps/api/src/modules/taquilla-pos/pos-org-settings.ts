export const DEFAULT_POS_CASH_VARIANCE_PIN_THRESHOLD = 50;
export const DEFAULT_POS_EVENTS_LOOKBACK_HOURS = 12;

export type PosOrgSettings = {
  cashVariancePinThreshold: number;
  eventsLookbackHours: number;
};

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

function nonNegNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function posOrgSettingsFrom(settings: unknown): PosOrgSettings {
  const s = settingsRecord(settings);
  const hoursRaw = nonNegNumber(s.posEventsLookbackHours, DEFAULT_POS_EVENTS_LOOKBACK_HOURS);
  const hours = Math.min(168, Math.max(1, Math.round(hoursRaw) || DEFAULT_POS_EVENTS_LOOKBACK_HOURS));
  return {
    cashVariancePinThreshold: nonNegNumber(s.posCashVariancePinThreshold, DEFAULT_POS_CASH_VARIANCE_PIN_THRESHOLD),
    eventsLookbackHours: hours,
  };
}

export function mergePosOrgSettings(
  settings: unknown,
  patch: { posCashVariancePinThreshold?: number; posEventsLookbackHours?: number }
): Record<string, unknown> {
  const base = { ...settingsRecord(settings) };
  if (patch.posCashVariancePinThreshold !== undefined) {
    const n = Number(patch.posCashVariancePinThreshold);
    if (!Number.isFinite(n) || n < 0) throw new Error('posCashVariancePinThreshold inválido');
    base.posCashVariancePinThreshold = n;
  }
  if (patch.posEventsLookbackHours !== undefined) {
    const n = Number(patch.posEventsLookbackHours);
    if (!Number.isFinite(n) || n < 1 || n > 168) throw new Error('posEventsLookbackHours inválido');
    base.posEventsLookbackHours = Math.round(n);
  }
  return base;
}

export function roundMoney2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}