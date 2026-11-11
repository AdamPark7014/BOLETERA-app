/**
 * Smoke: service-level egress report helpers used by the API layer.
 * (Does not boot Nest — validates report shape the controller returns.)
 */
const {
  generateTheaterTemplate,
  buildEgressReport,
  exportEgressReportToCsv,
  egressReportFilename,
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
      width: 20,
      points: [
        [cx, stage.y + 30],
        [cx, 380],
      ],
    },
  ],
};

const report = buildEgressReport(map, { venueName: 'API Venue' });
const jsonPayload = { format: 'json', report, filename: egressReportFilename(report.venueName) };
assert(jsonPayload.format === 'json', 'json format');
assert(jsonPayload.report.summary.hasNetwork, 'network');
assert(jsonPayload.filename.endsWith('.csv'), 'filename');

const csvPayload = {
  format: 'csv',
  csv: exportEgressReportToCsv(report),
  filename: jsonPayload.filename,
  report,
};
assert(csvPayload.csv.includes('meta,venueName,API Venue'), 'csv body');
assert(csvPayload.csv.includes('type,sectionId'), 'sections');

console.log('API egress payload ok', {
  filename: csvPayload.filename,
  csvBytes: csvPayload.csv.length,
  clearance: report.summary.clearanceMinutes,
});
console.log('EGRESS_API_SMOKE_OK');
