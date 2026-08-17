const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  addMoney,
  addVat,
  allocateMinor,
  applyRate,
  formatMoney,
  fromMinorUnits,
  money,
  moneyFromMinor,
  multiplyMoney,
  splitVatInclusive,
  subtractMoney,
  sumMoney,
  toGatewayAmountString,
  toMinorUnits,
} = require('../dist/money.js');

describe('money', () => {
  it('converts majors to minor units without floating-point loss', () => {
    assert.equal(toMinorUnits(19.99, 'MXN'), 1999);
    assert.equal(toMinorUnits(0.1 + 0.2, 'MXN'), 30);
    assert.equal(toMinorUnits(1234.5, 'MXN'), 123450);
    assert.equal(fromMinorUnits(1999, 'MXN'), 19.99);
  });

  it('rejects non-finite majors', () => {
    assert.throws(() => toMinorUnits(Number.NaN), /Importe no numérico/);
    assert.throws(() => toMinorUnits(Number.POSITIVE_INFINITY), /Importe no numérico/);
  });

  it('adds and subtracts in the same currency only', () => {
    const a = money(100, 'MXN');
    const b = money(25.5, 'MXN');
    assert.deepEqual(addMoney(a, b), moneyFromMinor(12550, 'MXN'));
    assert.deepEqual(subtractMoney(a, b), moneyFromMinor(7450, 'MXN'));
    assert.throws(() => addMoney(a, money(1, 'USD')), /MXN y USD/);
  });

  it('multiplies by integer quantities and sums lines', () => {
    const line = money(350, 'MXN');
    assert.deepEqual(multiplyMoney(line, 3), moneyFromMinor(105000, 'MXN'));
    assert.throws(() => multiplyMoney(line, 1.5), /Cantidad no entera/);
    assert.deepEqual(sumMoney([money(10), money(20.5), money(0.01)]), moneyFromMinor(3051, 'MXN'));
  });

  it('applies rates and IVA without losing a centavo', () => {
    const net = money(1000, 'MXN');
    assert.deepEqual(applyRate(net, 0.1), moneyFromMinor(10000, 'MXN'));
    assert.deepEqual(addVat(net), moneyFromMinor(116000, 'MXN'));
    const { net: back, tax } = splitVatInclusive(addVat(net));
    assert.deepEqual(back, net);
    assert.deepEqual(tax, moneyFromMinor(16000, 'MXN'));
    assert.equal(back.amountMinor + tax.amountMinor, 116000);
  });

  it('allocates remainders so parts sum exactly to the total', () => {
    assert.deepEqual(allocateMinor(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocateMinor(10, [2, 1]), [7, 3]);
    assert.deepEqual(allocateMinor(100, [0, 0, 0]), [34, 33, 33]);
    assert.equal(
      allocateMinor(999, [1, 2, 3]).reduce((a, b) => a + b, 0),
      999,
    );
  });

  it('formats MXN for es-MX and gateway payloads', () => {
    const amount = money(1234.5, 'MXN');
    assert.match(formatMoney(amount), /1,234\.50/);
    assert.equal(toGatewayAmountString(amount), '1234.50');
  });
});
