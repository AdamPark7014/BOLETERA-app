const {
  resolveGeometry,
  buildEgressPathOverlays,
  projectEgressOverlaysTo3D,
  analyzeCirculation,
} = require('../dist/index.js');

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
      seats: [
        { id: 'p1', label: 'P1', x: 100, y: 160 },
        { id: 'p2', label: 'P2', x: 130, y: 160 },
      ],
    },
    {
      id: 'balc',
      name: 'Balcón',
      slug: 'balc',
      color: '#c45c6a',
      levelId: 'lvl-balc',
      seats: [
        { id: 'b1', label: 'B1', x: 100, y: 50, elevation: 120 },
        { id: 'b2', label: 'B2', x: 130, y: 50, elevation: 120 },
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
    aisles: [
      {
        id: 'a-floor',
        levelId: 'lvl-floor',
        width: 16,
        points: [
          [115, 30],
          [115, 200],
        ],
      },
      {
        id: 'a-balc',
        levelId: 'lvl-balc',
        width: 14,
        points: [
          [115, 20],
          [115, 70],
        ],
      },
    ],
    stairs: [
      {
        id: 'st1',
        kind: 'stairs',
        fromLevelId: 'lvl-floor',
        toLevelId: 'lvl-balc',
        points: [
          [115, 90],
          [115, 70],
        ],
      },
    ],
    exits: [
      { id: 'ex-f', label: 'Calle', levelId: 'lvl-floor', points: [[115, 200]], width: 36 },
      { id: 'ex-b', label: 'Foyer', levelId: 'lvl-balc', points: [[115, 20]], width: 28 },
    ],
  },
};

const scene = resolveGeometry(map);
const analysis = analyzeCirculation(scene);
assert(analysis.hasNetwork, 'network');

const all = buildEgressPathOverlays(scene, { analysis });
assert(all.paths.length >= 2, `all paths ${all.paths.length}`);

const floorOnly = buildEgressPathOverlays(scene, { analysis, levelId: 'lvl-floor' });
assert(
  floorOnly.paths.every((p) => !p.levelId || p.levelId === 'lvl-floor'),
  'floor filter'
);
assert(
  floorOnly.paths.some((p) => p.sectionId === 'pit'),
  'pit path'
);
assert(!floorOnly.paths.some((p) => p.sectionId === 'balc'), 'no balc on floor filter');

const balcOnly = buildEgressPathOverlays(scene, { analysis, levelId: 'lvl-balc' });
assert(
  balcOnly.paths.some((p) => p.sectionId === 'balc'),
  'balc path'
);
assert(!balcOnly.paths.some((p) => p.sectionId === 'pit'), 'no pit on balc filter');

const p3Floor = projectEgressOverlaysTo3D(scene, { analysis, levelId: 'lvl-floor' });
const p3Balc = projectEgressOverlaysTo3D(scene, { analysis, levelId: 'lvl-balc' });
assert(p3Floor.paths.length >= 1 && p3Balc.paths.length >= 1, '3d filtered');

const floorY = Math.max(...p3Floor.paths.flatMap((p) => p.points.map((pt) => pt[1])));
const balcY = Math.max(...p3Balc.paths.flatMap((p) => p.points.map((pt) => pt[1])));
assert(balcY > floorY + 0.5, `balc elev ${balcY} > floor ${floorY}`);

const pitPath = all.paths.find((p) => p.sectionId === 'pit');
assert(pitPath?.pointLevels?.length === pitPath.points.length, 'pointLevels');

console.log('EGRESS_LEVEL_FILTER_SMOKE_OK', {
  all: all.paths.map((p) => ({ id: p.sectionId, levelId: p.levelId })),
  floor: floorOnly.paths.length,
  balc: balcOnly.paths.length,
  elev: { floorY: +floorY.toFixed(3), balcY: +balcY.toFixed(3) },
});
