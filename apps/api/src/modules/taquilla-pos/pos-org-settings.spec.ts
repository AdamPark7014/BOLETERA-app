import {
  DEFAULT_POS_CASH_VARIANCE_PIN_THRESHOLD,
  DEFAULT_POS_EVENTS_LOOKBACK_HOURS,
  mergePosOrgSettings,
  posOrgSettingsFrom,
  roundMoney2,
} from './pos-org-settings';

describe('posOrgSettingsFrom', () => {
  it('usa valores por omisión', () => {
    expect(posOrgSettingsFrom(null)).toEqual({
      cashVariancePinThreshold: DEFAULT_POS_CASH_VARIANCE_PIN_THRESHOLD,
      eventsLookbackHours: DEFAULT_POS_EVENTS_LOOKBACK_HOURS,
    });
  });

  it('lee settings de la organización', () => {
    expect(
      posOrgSettingsFrom({ posCashVariancePinThreshold: 20, posEventsLookbackHours: 24 })
    ).toEqual({ cashVariancePinThreshold: 20, eventsLookbackHours: 24 });
  });

  it('acota horas a 168', () => {
    expect(posOrgSettingsFrom({ posEventsLookbackHours: 999 }).eventsLookbackHours).toBe(168);
  });
});

describe('mergePosOrgSettings', () => {
  it('mergea sin borrar otras llaves', () => {
    const next = mergePosOrgSettings({ a: 1 }, { posCashVariancePinThreshold: 10 });
    expect(next.a).toBe(1);
    expect(next.posCashVariancePinThreshold).toBe(10);
  });

  it('rechaza umbral negativo', () => {
    expect(() => mergePosOrgSettings({}, { posCashVariancePinThreshold: -1 })).toThrow();
  });
});

describe('roundMoney2', () => {
  it('evita error de coma flotante', () => {
    expect(roundMoney2(0.1 + 0.2)).toBe(0.3);
  });
});