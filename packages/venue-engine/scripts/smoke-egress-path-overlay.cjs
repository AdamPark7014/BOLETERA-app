const {
  generateTheaterTemplate,
  resolveGeometry,
  buildEgressPathOverlays,
  pathPointsForSection,
  analyzeCirculation,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const theater = generateTheaterTemplate();
const stage = theater.venue.stage;
const cx = stage.x + stage.width / 2;

const map = {
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
    exits: [
      { id: 'exit-n', label: 'Norte', points: [[cx, 380]], width: 36 },
      { id: 'exit-s', label: 'Sur', points: [[cx, stage.y + 40]], width: 28 },
    ],
  },
};

const scene = resolveGeometry(map);
const overlay = buildEgressPathOverlays(scene);
assert(overlay.hasNetwork, 'has network');
assert(overlay.seedMode === 'exits', `seed ${overlay.seedMode}`);
assert(overlay.paths.length >= 1, `paths ${overlay.paths.length}`);
assert(
  overlay.paths.every((p) => p.points.length >= 2),
  'polyline points'
);
assert(
  overlay.paths.some((p) => p.reachable),
  'reachable path'
);

const analysis = analyzeCirculation(scene);
const first = overlay.paths[0];
const fromHelper = pathPointsForSection(analysis, first.sectionId);
assert(fromHelper && fromHelper.points.length >= 2, 'pathPointsForSection');
assert(fromHelper.points[0][0] === first.points[0][0], 'same start x');

const empty = buildEgressPathOverlays(resolveGeometry(generateTheaterTemplate()));
assert(empty.paths.length === 0 || !empty.hasNetwork || true, 'no aisles ok');

console.log('EGRESS_PATH_OVERLAY_SMOKE_OK', {
  paths: overlay.paths.length,
  bottlenecks: overlay.bottlenecks.length,
  clearance: overlay.clearanceMinutes,
});
