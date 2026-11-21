import { applyQuotedCap, sumQuotedTotals } from './quoted-total';

describe('quoted total PROFECO', () => {
  it('el total no supera el cotizado si el dinámico subió', () => {
    const quoted = sumQuotedTotals([{ quotedTotal: 1160 }, { quotedTotal: 1160 }]);
    expect(quoted).toBe(2320);
    expect(applyQuotedCap(2500, quoted)).toBe(2320);
  });

  it('si el precio bajó, cobra lo menor', () => {
    expect(applyQuotedCap(1000, 1160)).toBe(1000);
  });

  it('sin cotización, no inventa tope', () => {
    expect(sumQuotedTotals([{ quotedTotal: 10 }, { quotedTotal: null }])).toBeNull();
    expect(applyQuotedCap(900, null)).toBe(900);
  });
});
