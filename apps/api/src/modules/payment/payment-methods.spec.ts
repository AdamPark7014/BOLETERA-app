import {
  mergeMethodSettings,
  methodsFromSettings,
  offeredCheckoutMethods,
} from './payment-methods';

describe('métodos de checkout de la organización', () => {
  it('sin claves siguen activos tarjeta, SPEI y OXXO', () => {
    const flags = methodsFromSettings(null);
    expect(flags.tarjeta).toBe(true);
    expect(flags.SPEI).toBe(true);
    expect(flags.OXXO).toBe(true);
    expect(flags.tarjetaSaved).toBe(false);
    expect(flags.speiSaved).toBe(false);
    expect(flags.oxxoSaved).toBe(false);
    expect(flags.methods).toEqual(['CARD', 'SPEI', 'OXXO']);
  });

  it('false apaga solo ese método y un valor que no es booleano no cuenta', () => {
    const flags = methodsFromSettings({
      tarjeta: false,
      SPEI: 'no',
      OXXO: true,
      serviceFeeRate: 0.12,
    });
    expect(flags.tarjeta).toBe(false);
    expect(flags.SPEI).toBe(true);
    expect(flags.OXXO).toBe(true);
    expect(flags.tarjetaSaved).toBe(true);
    expect(flags.speiSaved).toBe(false);
    expect(flags.oxxoSaved).toBe(true);
    expect(offeredCheckoutMethods({ tarjeta: false })).toEqual(['SPEI', 'OXXO']);
  });

  it('guardar un interruptor no borra tasas, plazos ni el PIN', () => {
    const next = mergeMethodSettings(
      {
        managerPinHash: 'pin',
        serviceFeeRate: 0.12,
        taxRate: 0.16,
        refundSettlementBusinessDays: 6,
        transferDeadlineDays: 9,
        SPEI: false,
      },
      { tarjeta: false },
    );
    expect(next.managerPinHash).toBe('pin');
    expect(next.serviceFeeRate).toBe(0.12);
    expect(next.taxRate).toBe(0.16);
    expect(next.refundSettlementBusinessDays).toBe(6);
    expect(next.transferDeadlineDays).toBe(9);
    expect(next.SPEI).toBe(false);
    expect(next.tarjeta).toBe(false);
    expect(next.OXXO).toBeUndefined();
    expect(next.paypal).toBeUndefined();
  });
});
