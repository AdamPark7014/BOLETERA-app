const {
  generateTheaterTemplate,
  regenerateSeatsFromBlocks,
  exportSeatMapToSvg,
  importSvgToSeatMap,
  resolveGeometry,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = generateTheaterTemplate();
const withBlocks = map.sections.filter((s) => s.blocks?.length);
console.log(
  'sections with blocks:',
  withBlocks.length,
  withBlocks.map((s) => ({
    id: s.id,
    seats: s.seats.length,
    skip: s.blocks[0].skipColumns,
  }))
);

const target = withBlocks[0];
const expected =
  target.blocks[0].rows * target.blocks[0].seatsPerRow -
  (target.blocks[0].skipColumns?.length ?? 0) * target.blocks[0].rows;

const mutated = {
  ...map,
  sections: map.sections.map((s) =>
    s.id === target.id
      ? { ...s, seats: s.seats.map((seat, i) => (i === 0 ? { ...seat, x: seat.x + 999 } : seat)) }
      : s
  ),
};
const before = mutated.sections.find((s) => s.id === target.id).seats[0].x;
const regen = regenerateSeatsFromBlocks(mutated, { sectionId: target.id });
const after = regen.sections.find((s) => s.id === target.id);
assert(Math.abs(after.seats[0].x - before) > 100, 'regen should restore moved seat');
assert(after.seats.length === expected, `seat count ${after.seats.length} !== ${expected}`);
console.log('regen ok:', { seatCount: after.seats.length, expected });

const rich = {
  ...regen,
  venue: {
    ...(regen.venue || {}),
    aisles: [
      {
        id: 'a1',
        points: [
          [100, 100],
          [100, 400],
        ],
      },
    ],
    obstacles: [
      {
        id: 'o1',
        type: 'barrier',
        points: [
          [300, 50],
          [360, 50],
          [360, 90],
          [300, 90],
        ],
        height: 120,
      },
    ],
    stairs: [
      {
        id: 'st1',
        kind: 'stairs',
        points: [
          [200, 200],
          [200, 280],
        ],
      },
    ],
  },
  sections: regen.sections.map((s, i) =>
    i === 0
      ? {
          ...s,
          shape: {
            points: [
              [150, 100],
              [450, 100],
              [450, 280],
              [150, 280],
            ],
          },
        }
      : s
  ),
};

const svg = exportSeatMapToSvg(rich);
assert(svg.includes('data-role="stage"'), 'svg stage');
assert(svg.includes('data-role="aisle"'), 'svg aisle');
assert(svg.includes('data-role="obstacle"'), 'svg obstacle');
assert(svg.includes('data-role="stairs"'), 'svg stairs');
assert(svg.includes('data-role="section"'), 'svg section');
console.log('svg export ok', { bytes: svg.length });

const { map: re, stats } = importSvgToSeatMap(
  svg,
  { sections: [], version: 3 },
  { mode: 'replace-meta' }
);
assert(stats.stage, 'reimport stage');
assert(stats.aisles >= 1, 'reimport aisle');
assert(stats.obstacles >= 1, 'reimport obstacle');
assert(stats.stairs >= 1, 'reimport stairs');
assert(stats.sections >= 1, 'reimport section');
console.log('reimport ok', stats, { sections: re.sections.length });

const resolved = resolveGeometry(regen);
const seatN =
  resolved.scene?.seats?.length ??
  resolved.seats?.length ??
  resolved.sections?.reduce((n, s) => n + s.seats.length, 0);
assert(seatN > 0, 'resolve seats');
console.log('resolve ok', { seatN });
console.log('SMOKE_OK');
