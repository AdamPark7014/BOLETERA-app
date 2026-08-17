const {
  expandRecurrence,
  describeRecurrence,
  resolveSaleStatus,
  detectScheduleConflicts,
  zonedTimeToUtc,
  getTimezoneOffsetMinutes,
  formatLocalDateTime,
  MAX_OCCURRENCES,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- timezone core --------------------------------------------------------
const mx = zonedTimeToUtc({ year: 2026, month: 7, day: 30, hour: 20, minute: 0 }, 'America/Mexico_City');
assert(mx.toISOString() === '2026-07-31T02:00:00.000Z', `mx instant ${mx.toISOString()}`);
assert(getTimezoneOffsetMinutes(mx, 'America/Mexico_City') === -360, 'mexico is fixed -06:00');

// --- weekly across a DST boundary (Madrid springs forward 2026-03-29) ------
const madrid = expandRecurrence({
  frequency: 'WEEKLY',
  startLocal: '2026-03-20T21:00',
  timezone: 'Europe/Madrid',
  byWeekday: [5],
  count: 3,
});
assert(madrid.length === 3, `madrid count ${madrid.length}`);
assert(
  madrid.every((o) => o.localTime === '21:00'),
  'local time must stay at 21:00 across DST',
);
assert(madrid[0].utcOffsetMinutes === 60, `pre-DST offset ${madrid[0].utcOffsetMinutes}`);
assert(madrid[2].utcOffsetMinutes === 120, `post-DST offset ${madrid[2].utcOffsetMinutes}`);
// The absolute instant shifts one hour, the wall clock does not.
assert(madrid[0].startsAt === '2026-03-20T20:00:00.000Z', madrid[0].startsAt);
assert(madrid[2].startsAt === '2026-04-03T19:00:00.000Z', madrid[2].startsAt);
console.log('dst:', madrid.map((o) => `${o.localDate} ${o.localTime} (${o.utcOffsetMinutes})`));

// --- weekly with several weekdays + exceptions -----------------------------
const weekly = expandRecurrence({
  frequency: 'WEEKLY',
  startLocal: '2026-08-03T20:30',
  timezone: 'America/Mexico_City',
  byWeekday: [1, 4],
  count: 5,
  exceptions: ['2026-08-10'],
});
assert(weekly.length === 5, `weekly count ${weekly.length}`);
assert(
  weekly.map((o) => o.localDate).join(',') ===
    '2026-08-03,2026-08-06,2026-08-13,2026-08-17,2026-08-20',
  weekly.map((o) => o.localDate).join(','),
);
assert(weekly.every((o) => o.localTime === '20:30'), 'weekly keeps time of day');

// --- biweekly interval ----------------------------------------------------
const biweekly = expandRecurrence({
  frequency: 'WEEKLY',
  startLocal: '2026-09-04T21:00',
  timezone: 'America/Mexico_City',
  interval: 2,
  count: 3,
});
assert(
  biweekly.map((o) => o.localDate).join(',') === '2026-09-04,2026-09-18,2026-10-02',
  biweekly.map((o) => o.localDate).join(','),
);

// --- monthly day-of-month clamps to short months --------------------------
const monthly = expandRecurrence({
  frequency: 'MONTHLY',
  startLocal: '2026-01-31T19:00',
  timezone: 'America/Mexico_City',
  count: 3,
});
assert(
  monthly.map((o) => o.localDate).join(',') === '2026-01-31,2026-02-28,2026-03-31',
  monthly.map((o) => o.localDate).join(','),
);
assert(monthly[1].clamped === true, 'february occurrence is flagged as clamped');

// --- monthly nth weekday (last Friday) ------------------------------------
const lastFriday = expandRecurrence({
  frequency: 'MONTHLY',
  startLocal: '2026-08-01T22:00',
  timezone: 'America/Mexico_City',
  monthlyMode: 'NTH_WEEKDAY',
  nth: -1,
  nthWeekday: 5,
  count: 3,
});
assert(
  lastFriday.map((o) => o.localDate).join(',') === '2026-08-28,2026-09-25,2026-10-30',
  lastFriday.map((o) => o.localDate).join(','),
);

// --- until + extra dates + dedupe ----------------------------------------
const untilRule = expandRecurrence({
  frequency: 'DAILY',
  startLocal: '2026-05-01T18:00',
  timezone: 'America/Mexico_City',
  untilLocal: '2026-05-04',
  extraDates: ['2026-05-09T18:00', '2026-05-01T18:00'],
});
assert(
  untilRule.map((o) => o.localDate).join(',') === '2026-05-01,2026-05-02,2026-05-03,2026-05-04,2026-05-09',
  untilRule.map((o) => o.localDate).join(','),
);
assert(untilRule[4].source === 'EXTRA', 'extra date is tagged');
assert(untilRule.every((o, i) => o.index === i), 'occurrences are re-indexed after sort');

// --- runaway rules are capped --------------------------------------------
const capped = expandRecurrence({
  frequency: 'DAILY',
  startLocal: '2026-01-01T10:00',
  timezone: 'America/Mexico_City',
  count: 9999,
});
assert(capped.length === MAX_OCCURRENCES, `cap ${capped.length}`);

console.log('describe:', describeRecurrence({
  frequency: 'WEEKLY',
  startLocal: '2026-08-03T20:30',
  timezone: 'America/Mexico_City',
  byWeekday: [1, 4],
  count: 8,
}));

// --- sale windows ---------------------------------------------------------
const base = {
  status: 'SCHEDULED',
  startsAt: '2026-12-01T02:00:00.000Z',
  salesStartAt: '2026-08-01T15:00:00.000Z',
  salesEndAt: '2026-11-30T23:00:00.000Z',
};

const beforeOnSale = resolveSaleStatus(base, new Date('2026-07-30T10:00:00Z'));
assert(beforeOnSale.state === 'ANNOUNCED' && !beforeOnSale.canPurchase, `pre-onsale ${beforeOnSale.state}`);
assert(beforeOnSale.nextChangeAt === '2026-08-01T15:00:00.000Z', beforeOnSale.nextChangeAt);

const onSale = resolveSaleStatus(base, new Date('2026-09-01T10:00:00Z'));
assert(onSale.state === 'ON_SALE' && onSale.canPurchase, `onsale ${onSale.state}`);

const closed = resolveSaleStatus(base, new Date('2026-11-30T23:30:00Z'));
assert(closed.state === 'CLOSED' && closed.reason === 'SALES_CLOSED', `closed ${closed.state}`);

const draft = resolveSaleStatus({ ...base, status: 'DRAFT' }, new Date('2026-09-01T10:00:00Z'));
assert(draft.state === 'DRAFT' && !draft.canPurchase, 'draft is never purchasable');

const scheduledPublish = resolveSaleStatus(
  { ...base, status: 'DRAFT', publishAt: '2026-08-20T15:00:00.000Z' },
  new Date('2026-09-01T10:00:00Z'),
);
assert(scheduledPublish.state === 'ON_SALE', `auto publish ${scheduledPublish.state}`);

const presale = resolveSaleStatus(
  {
    ...base,
    salesStartAt: '2026-10-01T15:00:00.000Z',
    phases: [
      { kind: 'PRESALE', code: 'BANORTE', startsAt: '2026-09-01T15:00:00.000Z', endsAt: '2026-09-03T15:00:00.000Z' },
    ],
  },
  new Date('2026-09-02T10:00:00Z'),
);
assert(presale.state === 'PRESALE' && !presale.canPurchase, `presale gate ${presale.state}`);
assert(presale.gatedPhases.length === 1 && presale.gatedPhases[0].code === 'BANORTE', 'gated phase exposed');

const openPresale = resolveSaleStatus(
  {
    ...base,
    salesStartAt: '2026-10-01T15:00:00.000Z',
    phases: [{ kind: 'MEMBERS', startsAt: '2026-09-01T15:00:00.000Z', endsAt: '2026-09-03T15:00:00.000Z' }],
  },
  new Date('2026-09-02T10:00:00Z'),
);
assert(openPresale.state === 'PRESALE' && openPresale.canPurchase, 'codeless phase opens sales');

const cancelled = resolveSaleStatus({ ...base, status: 'CANCELLED' }, new Date('2026-09-01T10:00:00Z'));
assert(cancelled.state === 'CANCELLED' && cancelled.reason === 'EVENT_CANCELLED', 'cancelled');

const past = resolveSaleStatus(base, new Date('2027-01-01T00:00:00Z'));
assert(past.state === 'PAST', 'past events are closed');

// --- conflicts ------------------------------------------------------------
const booked = [
  { id: 'ev1', title: 'Concierto A', startsAt: '2026-08-03T02:00:00.000Z', durationMinutes: 180 },
];
const candidates = [
  { startsAt: '2026-08-03T02:00:00.000Z', durationMinutes: 180 }, // duplicate
  { startsAt: '2026-08-03T06:00:00.000Z', durationMinutes: 180 }, // 60 min turnaround
  { startsAt: '2026-08-04T02:00:00.000Z', durationMinutes: 180 }, // clean
];
const conflicts = detectScheduleConflicts(candidates, booked, { turnaroundMinutes: 90 });
assert(conflicts.get(0)?.[0].kind === 'DUPLICATE', 'duplicate detected');
assert(conflicts.get(1)?.[0].kind === 'TURNAROUND', 'turnaround detected');
assert(!conflicts.has(2), 'clean slot has no conflicts');

const blackout = detectScheduleConflicts(
  [{ startsAt: '2026-08-10T02:00:00.000Z', durationMinutes: 120 }],
  [],
  {
    turnaroundMinutes: 0,
    blackouts: [
      { id: 'bk1', title: 'Mantenimiento', startsAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-11T00:00:00.000Z' },
    ],
  },
);
assert(blackout.get(0)?.[0].kind === 'BLACKOUT', 'blackout detected');

assert(
  formatLocalDateTime(new Date('2026-07-31T02:00:00.000Z'), 'America/Mexico_City') === '2026-07-30T20:00',
  'formatLocalDateTime round-trip',
);

console.log('SCHEDULING_SMOKE_OK');
