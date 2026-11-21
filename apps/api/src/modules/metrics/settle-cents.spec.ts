import { settleEventCents } from './settle-cents';

describe('settleEventCents', () => {
  it('compra + reventa + reembolso cuadran al centavo', () => {
    const r = settleEventCents({
      orderTotal: 1160.0, // boleto all-in
      orderFees: 100.0,
      platformCommission: 80.0,
      refundAmount: 1160.0, // reembolso total de otra orden
      resaleFee: 80.0, // comisión de reventa (ingreso plataforma)
      membershipAmount: 499.0,
    });
    expect(r.identityHolds).toBe(true);
    expect(cents(r.netToOrganizer)).toBe(cents(1160 + 499 - 1160 - 80));
    expect(cents(r.sold + r.memberships + r.resaleFees)).toBe(
      cents(r.netToOrganizer + r.commissions + r.refunds + r.resaleFees)
    );
  });
});

function cents(n: number) {
  return Math.round((n + Number.EPSILON) * 100);
}
