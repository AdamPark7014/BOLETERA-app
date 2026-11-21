/** Conciliación al centavo: vendido − reembolsos − comisión + cargos de reventa (plataforma). */
export type SettleInput = {
  orderTotal: number;
  orderFees: number;
  platformCommission: number;
  refundAmount: number;
  resaleFee: number;
  membershipAmount: number;
};

export type SettleResult = {
  sold: number;
  fees: number;
  commissions: number;
  refunds: number;
  resaleFees: number;
  memberships: number;
  /** Neto a liquidar al organizador */
  netToOrganizer: number;
  /** Debe cuadrar: sold + memberships + resaleFees = net + commissions + refunds + (resaleFees si son de plataforma) */
  identityHolds: boolean;
};

function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100);
}

export function settleEventCents(input: SettleInput): SettleResult {
  const sold = cents(input.orderTotal);
  const fees = cents(input.orderFees);
  const commissions = cents(input.platformCommission);
  const refunds = cents(input.refundAmount);
  const resaleFees = cents(input.resaleFee);
  const memberships = cents(input.membershipAmount);
  const netToOrganizer = sold + memberships - refunds - commissions;
  // Identidad: bruto (órdenes+membresías) + fee reventa = neto org + comisión + reembolsos + fee reventa
  const left = sold + memberships + resaleFees;
  const right = netToOrganizer + commissions + refunds + resaleFees;
  return {
    sold: sold / 100,
    fees: fees / 100,
    commissions: commissions / 100,
    refunds: refunds / 100,
    resaleFees: resaleFees / 100,
    memberships: memberships / 100,
    netToOrganizer: netToOrganizer / 100,
    identityHolds: left === right,
  };
}
