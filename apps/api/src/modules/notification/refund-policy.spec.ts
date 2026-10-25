import {
  DEFAULT_TRANSFER_DEADLINE_DAYS,
  deadlinesFromSettings,
  mergeDeadlineSettings,
} from './refund-policy';

const quiet = { get: () => undefined };

describe('plazos de la organización', () => {
  it('vacío usa 5, 10 y 7 días', () => {
    const policy = deadlinesFromSettings(null, quiet);
    expect(policy.settlementBusinessDays).toBe(5);
    expect(policy.bankBusinessDays).toBe(10);
    expect(policy.transferDeadlineDays).toBe(DEFAULT_TRANSFER_DEADLINE_DAYS);
    expect(policy.settlementSaved).toBe(false);
    expect(policy.bankSaved).toBe(false);
    expect(policy.transferSaved).toBe(false);
  });

  it('el entorno manda solo cuando no hay número guardado', () => {
    const policy = deadlinesFromSettings(
      { managerPinHash: 'pin' },
      {
        get: (key) => (key === 'REFUND_SETTLEMENT_BUSINESS_DAYS' ? '8' : undefined),
      }
    );
    expect(policy.settlementBusinessDays).toBe(8);
    expect(policy.bankBusinessDays).toBe(10);
    expect(policy.transferDeadlineDays).toBe(7);
    expect(policy.settlementSaved).toBe(false);
  });

  it('lo guardado gana al entorno y un número inválido no cuenta', () => {
    const policy = deadlinesFromSettings(
      {
        refundSettlementBusinessDays: 6,
        refundBankBusinessDays: 0,
        transferDeadlineDays: 14,
      },
      { get: (key) => (key === 'REFUND_SETTLEMENT_BUSINESS_DAYS' ? '9' : undefined) }
    );
    expect(policy.settlementBusinessDays).toBe(6);
    expect(policy.bankBusinessDays).toBe(10);
    expect(policy.transferDeadlineDays).toBe(14);
    expect(policy.settlementSaved).toBe(true);
    expect(policy.bankSaved).toBe(false);
    expect(policy.transferSaved).toBe(true);
  });

  it('guardar un plazo no borra el resto del JSON', () => {
    const next = mergeDeadlineSettings(
      { managerPinHash: 'pin', promoters: [{ email: 'a@b.c' }] },
      { transferDeadlineDays: 9 }
    );
    expect(next.managerPinHash).toBe('pin');
    expect(next.promoters).toEqual([{ email: 'a@b.c' }]);
    expect(next.transferDeadlineDays).toBe(9);
    expect(next.refundSettlementBusinessDays).toBeUndefined();
  });
});
