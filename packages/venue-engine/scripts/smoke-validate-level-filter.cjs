const { resolveGeometry, validateGeometry } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = {
  version: 3,
  sections: [
    {
      id: 'pit',
      name: 'Platea',
      slug: 'pit',
      color: '#5b9fd4',
      levelId: 'lvl-floor',
      seatPitch: 26,
      seats: [
        { id: 'p1', label: 'P1', x: 100, y: 180 },
        { id: 'p2', label: 'P2', x: 112, y: 180 },
      ],
    },
    {
      id: 'balc',
      name: 'Balcón',
      slug: 'balc',
      color: '#c45c6a',
      levelId: 'lvl-balc',
      seatPitch: 26,
      seats: [
        // Same plan coords as p1 — stacked floors, not an overlap
        { id: 'b1', label: 'B1', x: 100, y: 180, elevation: 120 },
        { id: 'b2', label: 'B2', x: 200, y: 60, elevation: 120 },
      ],
    },
  ],
  venue: {
    scale: 40,
    stage: { x: 80, y: 10, width: 120, elevation: 40 },
    levels: [
      { id: 'lvl-floor', name: 'Platea', elevation: 0, zIndex: 0 },
      { id: 'lvl-balc', name: 'Balcón', elevation: 120, zIndex: 1 },
    ],
  },
};

const scene = resolveGeometry(map);
const all = validateGeometry(scene);
const cross = all.issues.filter(
  (i) => i.code === 'overlap' && i.seatIds.includes('p1') && i.seatIds.includes('b1')
);
assert(cross.length === 0, 'cross-level stack is not an overlap');

const sameLevel = all.issues.filter(
  (i) => i.code === 'overlap' && i.seatIds.includes('p1') && i.seatIds.includes('p2')
);
assert(sameLevel.length === 1, 'same-level close seats overlap');

const floor = validateGeometry(scene, { levelId: 'lvl-floor' });
assert(
  floor.issues.some((i) => i.code === 'overlap' && i.seatIds.includes('p1')),
  'floor still reports own overlaps'
);
assert(
  !floor.issues.some((i) => i.seatIds?.includes('b1') || i.seatIds?.includes('b2')),
  'floor validation ignores balc seats'
);

const balc = validateGeometry(scene, { levelId: 'lvl-balc' });
assert(!balc.issues.some((i) => i.code === 'overlap'), 'balc alone has no overlap');
assert(!balc.issues.some((i) => i.seatIds?.includes('p1')), 'balc validation ignores floor seats');

console.log('VALIDATE_LEVEL_FILTER_SMOKE_OK', {
  allOverlaps: all.issues.filter((i) => i.code === 'overlap').length,
  floorOverlaps: floor.issues.filter((i) => i.code === 'overlap').length,
  balcOverlaps: balc.issues.filter((i) => i.code === 'overlap').length,
});
