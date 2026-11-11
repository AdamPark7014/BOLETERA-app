const {
  generateTheaterTemplate,
  buildEgressReport,
  summarizeEgressReport,
  exportEgressOverviewCsv,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const STATUSES = new Set(['ok', 'warn', 'critical', 'no-network', 'empty']);

const theater = generateTheaterTemplate();
const stage = theater.venue.stage;
const cx = stage.x + stage.width / 2;
const withAisles = {
  ...theater,
  venue: {
    ...theater.venue,
    scale: 40,
    aisles: [
      {
        id: 'main',
        width: 12,
        points: [
          [cx, stage.y + 30],
          [cx, 380],
        ],
      },
    ],
    egressPolicy: {
      slowClearanceMinutes: 2,
      longPathUnits: 200,
      bottleneckUtilization: 0.5,
      bottleneckSeatLoad: 40,
    },
  },
};

const networked = summarizeEgressReport(buildEgressReport(withAisles, { venueName: 'Con red' }));
assert(STATUSES.has(networked.status), `bad status ${networked.status}`);
assert(networked.hasNetwork === true, 'hasNetwork');
assert(typeof networked.statusReason === 'string' && networked.statusReason.length > 0, 'reason');

const noNet = summarizeEgressReport(
  buildEgressReport(
    { ...theater, venue: { ...theater.venue, aisles: undefined, stairs: undefined } },
    { venueName: 'Sin red' }
  )
);
assert(noNet.status === 'no-network', `expected no-network got ${noNet.status}`);
assert(noNet.sections > 0, 'noNet should still count sections');

const empty = summarizeEgressReport(
  buildEgressReport(
    { version: 3, sections: [], viewport: { width: 100, height: 100 } },
    { venueName: 'Vacío' }
  )
);
assert(empty.status === 'empty', `empty status ${empty.status}`);

const csv = exportEgressOverviewCsv([
  { ...networked, venueId: 'v1' },
  { ...noNet, venueId: 'v2' },
  { ...empty, venueId: 'v3' },
]);
assert(csv.startsWith('venueId,venueName,status'), 'csv header');
assert(csv.includes('\nv1,'), 'csv row v1');
assert(csv.includes(networked.status), 'csv status');
assert(csv.includes('Sin red') || csv.includes(noNet.venueName), 'csv venue name');

console.log('EGRESS_OVERVIEW_SMOKE_OK', {
  networked: networked.status,
  noNet: noNet.status,
  empty: empty.status,
  csvLines: csv.trim().split('\n').length,
});
