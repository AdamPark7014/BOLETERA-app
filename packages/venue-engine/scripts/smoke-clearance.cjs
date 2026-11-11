const {
  resolveGeometry,
  analyzeCirculation,
  edgeFlowPerMinute,
  EGRESS_DEFAULTS,
  generateTheaterTemplate,
  validateGeometry,
  projectTo3D,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = generateTheaterTemplate();
map.venue = {
  ...map.venue,
  scale: 40,
  aisles: [
    {
      id: 'main',
      width: 12,
      points: [
        [map.venue.stage.x + map.venue.stage.width / 2, map.venue.stage.y + 30],
        [map.venue.stage.x + map.venue.stage.width / 2, 380],
      ],
    },
  ],
};

const scene = resolveGeometry(map);
const analysis = analyzeCirculation(scene);
assert(analysis.egress.clearanceMinutes != null, 'venue clearance');
assert(analysis.egress.maxWalkMinutes != null, 'max walk');
assert(
  analysis.egress.sections.some((s) => s.clearanceMinutes != null),
  'section clearance'
);
assert(analysis.egress.bottlenecks[0].flowPerMinute > 0, 'flow');
assert(analysis.egress.bottlenecks[0].clearanceMinutes > 0, 'bn clearance');

const narrowFlow = edgeFlowPerMinute(12, 'aisle', { mapUnitsPerMeter: 40 });
const wideFlow = edgeFlowPerMinute(48, 'aisle', { mapUnitsPerMeter: 40 });
assert(wideFlow > narrowFlow * 3, `flow scales with width ${wideFlow} vs ${narrowFlow}`);

console.log('clearance:', {
  venueMin: Number(analysis.egress.clearanceMinutes.toFixed(2)),
  maxWalk: Number(analysis.egress.maxWalkMinutes.toFixed(3)),
  topBn: {
    flow: Number(analysis.egress.bottlenecks[0].flowPerMinute.toFixed(1)),
    min: Number(analysis.egress.bottlenecks[0].clearanceMinutes.toFixed(2)),
  },
});

const projected = projectTo3D(scene);
assert(projected.aisles[0].width === 12, '3d aisle width');
assert(projected.aisles[0].points[0].length === 3, '3d points');

const issues = validateGeometry(scene).issues;
console.log('codes:', [...new Set(issues.map((i) => i.code))]);

assert(EGRESS_DEFAULTS.flowPerMeterLevel === 66, 'defaults');
console.log('CLEARANCE_SMOKE_OK');
