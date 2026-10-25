import {
  SERVICE_FEE_RATE,
  TAX_RATE,
  mergeRateSettings,
  priceBreakdown,
  ratesFromSettings,
} from './pricing-rates';

describe('tasas de la organización', () => {
  it('vacío usa la tasa de entorno', () => {
    const rates = ratesFromSettings(null);
    expect(rates.serviceFeeRate).toBe(SERVICE_FEE_RATE);
    expect(rates.taxRate).toBe(TAX_RATE);
    expect(rates.serviceFeeSaved).toBe(false);
    expect(rates.taxSaved).toBe(false);
  });

  it('lo guardado gana y un número inválido no cuenta', () => {
    const rates = ratesFromSettings({
      serviceFeeRate: 0.12,
      taxRate: 1.6,
      managerPinHash: 'pin',
    });
    expect(rates.serviceFeeRate).toBe(0.12);
    expect(rates.taxRate).toBe(TAX_RATE);
    expect(rates.serviceFeeSaved).toBe(true);
    expect(rates.taxSaved).toBe(false);
  });

  it('cero es una tasa guardada', () => {
    const rates = ratesFromSettings({ serviceFeeRate: 0, taxRate: 0 });
    expect(rates.serviceFeeRate).toBe(0);
    expect(rates.taxRate).toBe(0);
    expect(rates.serviceFeeSaved).toBe(true);
    expect(rates.taxSaved).toBe(true);
  });

  it('guardar una tasa no borra plazos ni el PIN', () => {
    const next = mergeRateSettings(
      {
        managerPinHash: 'pin',
        refundSettlementBusinessDays: 6,
        transferDeadlineDays: 9,
      },
      { serviceFeeRate: 0.12 },
    );
    expect(next.managerPinHash).toBe('pin');
    expect(next.refundSettlementBusinessDays).toBe(6);
    expect(next.transferDeadlineDays).toBe(9);
    expect(next.serviceFeeRate).toBe(0.12);
    expect(next.taxRate).toBeUndefined();
  });

  it('la fórmula sigue siendo base + cargo + IVA', () => {
    const row = priceBreakdown(1000, { serviceFeeRate: 0.12, taxRate: 0.16 });
    expect(row).toEqual({ base: 1000, fees: 120, taxes: 160, total: 1280 });
    const env = priceBreakdown(1000);
    expect(env.fees).toBe(Math.round(1000 * SERVICE_FEE_RATE * 100) / 100);
    expect(env.taxes).toBe(Math.round(1000 * TAX_RATE * 100) / 100);
    expect(env.total).toBe(env.base + env.fees + env.taxes);
  });
});
