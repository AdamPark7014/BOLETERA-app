const {
  generateTheaterTemplate,
  resolveGeometry,
  analyzeCirculation,
  validateGeometry,
  buildEgressReport,
  exportSeatMapToSvg,
  importSvgToSeatMap,
  migrateToV3,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const theater = generateTheaterTemplate();
const stage = theater.venue.stage;
const cx = stage.x + stage.width / 2;

// Baseline: aisles only → seeds from stage
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
  },
};

const stageSeeded = analyzeCirculation(resolveGeometry(withAisles));
assert(stageSeeded.seedMode === 'stage', `expected stage seed got ${stageSeeded.seedMode}`);
assert(stageSeeded.exitCount === 0, 'no exits yet');
assert(
  validateGeometry(resolveGeometry(withAisles)).issues.some((i) => i.code === 'no_exits'),
  'no_exits warning'
);

// Authored exits at corridor ends → true egress seeds
const withExits = {
  ...withAisles,
  venue: {
    ...withAisles.venue,
    exits: [
      { id: 'exit-n', label: 'Norte', points: [[cx, 380]], width: 36 },
      { id: 'exit-s', label: 'Sur', points: [[cx, stage.y + 40]], width: 28 },
    ],
  },
};

const exitSeeded = analyzeCirculation(resolveGeometry(withExits));
assert(exitSeeded.seedMode === 'exits', `expected exits seed got ${exitSeeded.seedMode}`);
assert(exitSeeded.exitCount === 2, `exitCount ${exitSeeded.exitCount}`);
assert(exitSeeded.hasNetwork, 'network with exits');
assert(
  !validateGeometry(resolveGeometry(withExits)).issues.some((i) => i.code === 'no_exits'),
  'no_exits cleared'
);

const report = buildEgressReport(withExits, { venueName: 'Con salidas' });
assert(report.summary.seedMode === 'exits', 'report seedMode');
assert(report.summary.exitCount === 2, 'report exitCount');

// Furniture door fallback when no authored exits
const withDoor = {
  ...withAisles,
  venue: {
    ...withAisles.venue,
    exits: undefined,
    furniture: [{ id: 'd1', type: 'door', x: cx, y: 370 }],
  },
};
const doorSeeded = analyzeCirculation(resolveGeometry(withDoor));
assert(doorSeeded.seedMode === 'exits', `door furniture seeds exits got ${doorSeeded.seedMode}`);
assert(doorSeeded.exitCount >= 1, 'door exit count');

// SVG round-trip of exits
const svg = exportSeatMapToSvg(withExits);
assert(svg.includes('data-role="exit"'), 'svg exit role');
const reimported = importSvgToSeatMap(svg, { sections: [], version: 3 }, { mode: 'replace-meta' });
assert(reimported.stats.exits >= 1, `svg reimport exits ${reimported.stats.exits}`);
const mig = migrateToV3(reimported.map);
assert((mig.venue?.exits?.length ?? 0) >= 1, 'migrated exits');

console.log('EGRESS_EXITS_SMOKE_OK', {
  stageSeed: stageSeeded.seedMode,
  exitSeed: exitSeeded.seedMode,
  doorSeed: doorSeeded.seedMode,
  svgExits: reimported.stats.exits,
});
