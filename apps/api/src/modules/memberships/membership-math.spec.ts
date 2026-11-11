import {
  activeCount,
  addMonths,
  monthlyRecurring,
  nextPeriod,
  renewalCounts,
  renewalRate,
  renewalStatus,
  retention12m,
  retentionSeries,
  revenueSince,
  type MembershipLite,
} from './membership-math';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-11T12:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);

function member(
  id: string,
  periods: Array<[number, number, number?]>,
  extra: Partial<MembershipLite> = {}
): MembershipLite {
  const list = periods.map(([startAgo, endAgo, amount]) => ({
    startsAt: ago(startAgo),
    endsAt: ago(endAgo),
    amount: amount ?? 1200,
  }));
  return {
    id,
    planId: 'p1',
    expiresAt: list.length ? list[list.length - 1].endsAt : now,
    cancelledAt: null,
    periods: list,
    ...extra,
  };
}

describe('cálculos de membresías', () => {
  it('sin datos: ceros y null, nunca relleno', () => {
    expect(activeCount([], now)).toBe(0);
    expect(renewalRate([], now)).toBeNull();
    expect(retention12m([], now)).toBeNull();
    expect(retentionSeries([], now)).toEqual([]);
    expect(revenueSince([], ago(365))).toBe(0);
    expect(monthlyRecurring([], now)).toBe(0);
  });

  it('vigencia por periodos y cancelación', () => {
    const active = member('a', [[10, -355]]);
    const cancelled = member('b', [[10, -355]], { cancelledAt: ago(1) });
    const expired = member('c', [[400, 35]]);
    expect(activeCount([active, cancelled, expired], now)).toBe(1);
  });

  it('renovación: renovado, no renovado juzgable y en gracia no cuentan igual', () => {
    const renewed = member('a', [
      [400, 35],
      [35, -330],
    ]);
    const lost = member('b', [[400, 35]]);
    const inGrace = member('c', [[370, 5]]); // venció hace 5 días: aún no se juzga
    expect(renewalCounts([renewed, lost, inGrace], now)).toEqual({ renewed: 1, eligible: 2 });
    expect(renewalRate([renewed, lost, inGrace], now)).toBe(0.5);
  });

  it('retención a 12 meses', () => {
    const kept = member('a', [
      [500, 135],
      [135, -230],
    ]);
    const gone = member('b', [[500, 135]]);
    const newer = member('c', [[100, -265]]);
    expect(retention12m([kept, gone, newer], now)).toBe(0.5);
  });

  it('serie mensual solo con meses que tienen base', () => {
    const series = retentionSeries([member('a', [[45, -320]])], now);
    expect(series.length).toBeGreaterThan(0);
    expect(series.every((point) => point.value === 1)).toBe(true);
  });

  it('ingreso de 12 meses y MRR', () => {
    const a = member('a', [
      [500, 135, 1000],
      [135, -230, 1200],
    ]);
    expect(revenueSince([a], ago(365))).toBe(1200);
    expect(monthlyRecurring([a], now)).toBe(100);
  });

  it('estado de renovación por días al vencimiento', () => {
    const at = (days: number) =>
      renewalStatus({ ...member('x', []), expiresAt: new Date(now.getTime() + days * DAY) }, now);
    expect(at(20)).toBe('UPCOMING');
    expect(at(3)).toBe('DUE');
    expect(at(-3)).toBe('OVERDUE');
    expect(at(-60)).toBe('LAPSED');
    expect(at(-200)).toBeNull();
    expect(at(200)).toBeNull();
  });

  it('renovada hace poco aparece como RENEWED', () => {
    const m = member('x', [
      [360, 5],
      [5, -360],
    ]);
    m.periods[1].kind = 'RENEWAL';
    m.periods[1].createdAt = ago(2);
    expect(renewalStatus(m, now)).toBe('RENEWED');
  });

  it('siguiente periodo: encadena o, si caducó, arranca hoy como alta', () => {
    const chained = nextPeriod(ago(-3), 'ANNUAL', now);
    expect(chained.kind).toBe('RENEWAL');
    expect(chained.startsAt).toEqual(ago(-3));
    expect(chained.endsAt).toEqual(addMonths(ago(-3), 12));
    const lapsed = nextPeriod(ago(60), 'MONTHLY', now);
    expect(lapsed.kind).toBe('NEW');
    expect(lapsed.startsAt).toEqual(now);
  });

  it('sumar meses no se pasa de fin de mes', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z'
    );
  });
});
