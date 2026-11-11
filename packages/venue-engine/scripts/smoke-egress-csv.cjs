const {
  generateTheaterTemplate,
  buildEgressReport,
  exportEgressReportToCsv,
  egressReportFilename,
  migrateToV3,
  resolveEgressPolicy,
  validateGeometry,
  resolveGeometry,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = generateTheaterTemplate();
const stage = map.venue.stage;
const cx = stage.x + stage.width / 2;
map.venue = {
  ...map.venue,
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
};

const migrated = migrateToV3(map);
assert(migrated.venue.egressPolicy.slowClearanceMinutes === 2, 'policy migrate');

const report = buildEgressReport(map, { venueName: 'Teatro Demo' });
assert(report.policy.slowClearanceMinutes === 2, 'report policy');
assert(report.summary.hasNetwork, 'network');
assert(report.analysis.egress.sections.length > 0, 'sections');

const csv = exportEgressReportToCsv(report);
assert(csv.includes('type,key,value'), 'meta header');
assert(csv.includes('meta,venueName,Teatro Demo'), 'venue name');
assert(csv.includes('type,sectionId,sectionName'), 'section header');
assert(csv.includes('type,edgeId,kind'), 'bn header');
assert(csv.includes('policy,slowClearanceMinutes,2'), 'policy row');
assert((csv.match(/^section,/gm) || []).length >= 1, 'section rows');

const name = egressReportFilename('Teatro Demo');
assert(/^egress-Teatro_Demo-\d{4}-\d{2}-\d{2}\.csv$/.test(name), `filename ${name}`);

const issues = validateGeometry(resolveGeometry(map)).issues;
assert(
  issues.some(
    (i) => i.code === 'slow_clearance' || i.code === 'egress_bottleneck' || i.code === 'long_egress'
  ),
  'policy triggers validate'
);

const relaxed = {
  ...map,
  venue: {
    ...map.venue,
    egressPolicy: {
      slowClearanceMinutes: 60,
      longPathUnits: 5000,
      bottleneckUtilization: 0.99,
      bottleneckSeatLoad: 5000,
    },
  },
};
const relaxedIssues = validateGeometry(resolveGeometry(relaxed)).issues.filter((i) =>
  ['slow_clearance', 'long_egress'].includes(i.code)
);
assert(relaxedIssues.length === 0, 'relaxed policy clears slow/long warnings');

const strictCount = issues.filter((i) =>
  ['slow_clearance', 'long_egress', 'egress_bottleneck'].includes(i.code)
).length;
const relaxedBn = validateGeometry(resolveGeometry(relaxed)).issues.filter(
  (i) => i.code === 'egress_bottleneck'
).length;
assert(strictCount >= relaxedBn, 'strict policy has at least as many egress issues');

console.log('csv bytes', csv.length, 'issues', [...new Set(issues.map((i) => i.code))]);
console.log('EGRESS_CSV_SMOKE_OK');
