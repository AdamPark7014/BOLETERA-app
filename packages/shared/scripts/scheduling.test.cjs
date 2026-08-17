const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectScheduleConflicts,
  expandRecurrence,
  formatLocalDateTime,
  getTimezoneOffsetMinutes,
  resolveSaleStatus,
  zonedTimeToUtc,
} = require('../dist/scheduling.js');
const { PLATFORM_TIMEZONE } = require('../dist/locale.js');

const MX = PLATFORM_TIMEZONE;

describe('zonedTimeToUtc / Mexico City', () => {
  it('maps a 20:00 CDMX show to the correct UTC instant (UTC-6, no DST)', () => {
    const instant = zonedTimeToUtc(
      { year: 2025, month: 7, day: 15, hour: 20, minute: 0, second: 0 },
      MX,
    );
    assert.equal(instant.toISOString(), '2025-07-16T02:00:00.000Z');
    assert.equal(getTimezoneOffsetMinutes(instant, MX), -360);
    assert.equal(formatLocalDateTime(instant, MX), '2025-07-15T20:00');
  });

  it('keeps wall-clock time across a weekly recurrence (no DST drift)', () => {
    const rule = {
      frequency: 'WEEKLY',
      startLocal: '2025-03-01T20:00',
      timezone: MX,
      byWeekday: [6],
      count: 4,
    };
    const occ = expandRecurrence(rule);
    assert.equal(occ.length, 4);
    for (const item of occ) {
      assert.equal(item.localTime, '20:00');
      assert.equal(item.utcOffsetMinutes, -360);
    }
  });

  it('handles a historical Mexico DST spring-forward gap (Apr 2022)', () => {
    // Clocks jumped 02:00 → 03:00; 02:30 never existed. Resolve past the gap.
    const gap = zonedTimeToUtc(
      { year: 2022, month: 4, day: 3, hour: 2, minute: 30, second: 0 },
      MX,
    );
    const local = formatLocalDateTime(gap, MX);
    assert.notEqual(local, '2022-04-03T02:30');
    // Post-gap local time is 03:30 (same UTC math with CDT offset).
    assert.equal(local, '2022-04-03T03:30');
  });

  it('prefers the earlier occurrence on a historical fall-back (Oct 2021)', () => {
    const ambiguous = zonedTimeToUtc(
      { year: 2021, month: 10, day: 31, hour: 1, minute: 30, second: 0 },
      MX,
    );
    assert.equal(formatLocalDateTime(ambiguous, MX), '2021-10-31T01:30');
    assert.equal(ambiguous.toISOString(), '2021-10-31T06:30:00.000Z');
  });

  it('clamps monthly day-of-month for short months', () => {
    const rule = {
      frequency: 'MONTHLY',
      startLocal: '2025-01-31T19:00',
      timezone: MX,
      count: 3,
    };
    const occ = expandRecurrence(rule);
    assert.equal(occ[0].localDate, '2025-01-31');
    assert.equal(occ[1].localDate, '2025-02-28');
    assert.equal(occ[1].clamped, true);
    assert.equal(occ[2].localDate, '2025-03-31');
  });
});

describe('resolveSaleStatus', () => {
  const base = {
    status: 'SCHEDULED',
    startsAt: '2025-08-01T02:00:00.000Z',
    salesStartAt: '2025-07-01T00:00:00.000Z',
    salesEndAt: '2025-08-01T01:00:00.000Z',
  };

  it('opens general sales inside the window', () => {
    const status = resolveSaleStatus(base, new Date('2025-07-15T12:00:00.000Z'));
    assert.equal(status.state, 'ON_SALE');
    assert.equal(status.canPurchase, true);
  });

  it('blocks purchases after salesEndAt', () => {
    const status = resolveSaleStatus(base, new Date('2025-08-01T01:30:00.000Z'));
    assert.equal(status.state, 'CLOSED');
    assert.equal(status.canPurchase, false);
    assert.equal(status.reason, 'SALES_CLOSED');
  });

  it('keeps gated phases from opening general sales', () => {
    const status = resolveSaleStatus(
      {
        ...base,
        salesStartAt: '2025-07-20T00:00:00.000Z',
        phases: [
          {
            kind: 'PRESALE',
            startsAt: '2025-07-10T00:00:00.000Z',
            endsAt: '2025-07-20T00:00:00.000Z',
            code: 'VIP2025',
          },
        ],
      },
      new Date('2025-07-12T12:00:00.000Z'),
    );
    assert.equal(status.state, 'PRESALE');
    assert.equal(status.canPurchase, false);
    assert.equal(status.gatedPhases.length, 1);
  });
});

describe('detectScheduleConflicts', () => {
  it('flags overlaps and turnaround gaps in Spanish', () => {
    const conflicts = detectScheduleConflicts(
      [{ id: 'a', title: 'Show A', startsAt: '2025-07-01T02:00:00.000Z', durationMinutes: 180 }],
      [
        { id: 'b', title: 'Show B', startsAt: '2025-07-01T04:00:00.000Z', durationMinutes: 120 },
        { id: 'c', title: 'Show C', startsAt: '2025-07-01T06:00:00.000Z', durationMinutes: 120 },
      ],
      { turnaroundMinutes: 90 },
    );
    const list = conflicts.get(0) ?? [];
    assert.ok(list.some((c) => c.kind === 'VENUE_OVERLAP'));
    // A ends 05:00, C starts 06:00 → 60 min < 90 turnaround.
    assert.ok(list.some((c) => c.kind === 'TURNAROUND'));
    assert.match(list[0].message, /traslapa|margen|misma hora/i);
  });
});
