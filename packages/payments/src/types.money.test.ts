import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  moneyFromMinor,
  toGatewayAmountString,
  toMinorUnits,
  toCurrencyCode,
  type CurrencyCode,
  type MoneyAmount,
} from '../../shared/src/money.ts';

/**
 * Mirrors `resolveContextMoney` in types.ts — tested against shared money primitives
 * without loading `@boletera/shared` package entry (extensionless ESM re-exports).
 */
function resolveContextMoney(ctx: {
  amount: number;
  amountMinor?: number;
  currency: string;
}): MoneyAmount {
  const currency: CurrencyCode = toCurrencyCode(ctx.currency);
  if (ctx.amountMinor !== undefined) {
    return moneyFromMinor(ctx.amountMinor, currency);
  }
  return moneyFromMinor(toMinorUnits(ctx.amount, currency), currency);
}

describe('resolveContextMoney / gateway amount', () => {
  it('converts major floats via toMinorUnits', () => {
    const money = resolveContextMoney({ amount: 19.99, currency: 'MXN' });
    assert.equal(money.amountMinor, 1999);
    assert.equal(money.currency, 'MXN');
    assert.equal(toGatewayAmountString(money), '19.99');
  });

  it('prefers amountMinor when provided', () => {
    const money = resolveContextMoney({
      amount: 1,
      amountMinor: 50,
      currency: 'USD',
    });
    assert.equal(money.amountMinor, 50);
    assert.equal(money.currency, 'USD');
    assert.equal(toGatewayAmountString(money), '0.50');
  });

  it('handles 0.1+0.2 float drift for Payworks IMPORTE', () => {
    const money = resolveContextMoney({ amount: 0.1 + 0.2, currency: 'MXN' });
    assert.equal(money.amountMinor, 30);
    assert.equal(toGatewayAmountString(money), '0.30');
  });
});
