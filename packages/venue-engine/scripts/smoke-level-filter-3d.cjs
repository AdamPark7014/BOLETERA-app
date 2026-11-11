const { resolveGeometry, projectTo3D } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = {
  version: 3,
  sections: [
    {
      id: 'pit',
      name: 'Pit',
      slug: 'pit',
      color: '#5b9fd4',
      levelId: 'lvl-floor',
      seats: [
        { id: 'p1', label: 'P1', x: 100, y: 140, levelId: 'lvl-floor' },
        { id: 'p2', label: 'P2', x: 120, y: 140, levelId: 'lvl-floor' },
      ],
    },
    {
      id: 'balcony',
      name: 'Balcony',
      slug: 'balcony',
      color: '#c45c6a',
      levelId: 'lvl-balc',
      seats: [
        { id: 'b1', label: 'B1', x: 100, y: 60, levelId: 'lvl-balc', elevation: 120 },
        { id: 'b2', label: 'B2', x: 120, y: 60, levelId: 'lvl-balc', elevation: 120 },
      ],
    },
  ],
  venue: {
    scale: 40,
    stage: { x: 80, y: 20, width: 120, elevation: 40 },
    levels: [
      { id: 'lvl-floor', name: 'Platea', elevation: 0, zIndex: 0 },
      { id: 'lvl-balc', name: 'Balcón', elevation: 120, zIndex: 1 },
    ],
    aisles: [
      {
        id: 'a-floor',
        points: [
          [140, 40],
          [140, 200],
        ],
        width: 20,
        levelId: 'lvl-floor',
      },
      {
        id: 'a-balc',
        points: [
          [60, 40],
          [60, 80],
        ],
        width: 18,
        levelId: 'lvl-balc',
      },
    ],
    exits: [
      { id: 'ex-floor', label: 'Calle', points: [[140, 200]], width: 36, levelId: 'lvl-floor' },
      { id: 'ex-balc', label: 'Foyer', points: [[60, 40]], width: 28, levelId: 'lvl-balc' },
    ],
    stairs: [
      {
        id: 'st1',
        kind: 'stairs',
        points: [
          [90, 100],
          [90, 80],
        ],
        fromLevelId: 'lvl-floor',
        toLevelId: 'lvl-balc',
      },
    ],
    furniture: [
      { id: 'led-f', type: 'led', x: 80, y: 40, levelId: 'lvl-floor' },
      { id: 'spk-b', type: 'speaker', x: 40, y: 50, levelId: 'lvl-balc' },
    ],
  },
};

const scene = resolveGeometry(map);
const p3 = projectTo3D(scene);

assert(
  p3.seats.every((s) => typeof s.levelId === 'string'),
  'seat levelId'
);
assert(p3.seats.filter((s) => s.levelId === 'lvl-floor').length === 2, 'floor seats');
assert(p3.seats.filter((s) => s.levelId === 'lvl-balc').length === 2, 'balc seats');
assert(
  p3.aisles.every((a) => a.levelId),
  'aisle levelId'
);
assert(
  p3.exits.every((e) => e.levelId),
  'exit levelId'
);
assert(
  p3.furniture.every((f) => f.levelId),
  'furniture levelId'
);
assert(
  p3.stairs[0].fromLevelId === 'lvl-floor' && p3.stairs[0].toLevelId === 'lvl-balc',
  'stair levels'
);
assert(
  p3.plates.some((pl) => pl.levelId === 'lvl-floor'),
  'plate level'
);

const floorSeats = p3.seats.filter((s) => !s.levelId || s.levelId === 'lvl-floor');
const balcSeats = p3.seats.filter((s) => !s.levelId || s.levelId === 'lvl-balc');
assert(floorSeats.length === 2 && balcSeats.length === 2, 'filter split');

console.log('LEVEL_FILTER_3D_SMOKE_OK', {
  seats: p3.seats.map((s) => ({ id: s.id, levelId: s.levelId })),
  aisles: p3.aisles.map((a) => a.levelId),
  exits: p3.exits.map((e) => e.levelId),
  furniture: p3.furniture.map((f) => ({ id: f.id, levelId: f.levelId })),
});
