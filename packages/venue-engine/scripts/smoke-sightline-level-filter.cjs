const {
  resolveGeometry,
  calculateSightlines,
  applySightlinesToScene,
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
        { id: 'p1', label: 'P1', x: 100, y: 180 },
        { id: 'p2', label: 'P2', x: 130, y: 180 },
        { id: 'p3', label: 'P3', x: 160, y: 180 },
      ],
    },
    {
      id: 'balc',
      name: 'Balcón',
      slug: 'balc',
      color: '#c45c6a',
      levelId: 'lvl-balc',
      seats: [
        {
          id: 'b1',
          label: 'B1',
          x: 100,
          y: 60,
          elevation: 120,
          visibility: { premiumView: true },
          metadata: { sightline: { score: 0.99, grade: 'premium' } },
        },
        { id: 'b2', label: 'B2', x: 130, y: 60, elevation: 120 },
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
const all = calculateSightlines(scene);
assert(all.scores.length === 5, 'all seats scored');

const floor = calculateSightlines(scene, { levelId: 'lvl-floor' });
assert(floor.scores.length === 3, 'floor scores only');
assert(
  floor.scores.every((s) => s.seatId.startsWith('p')),
  'floor seat ids'
);
assert(
  floor.summary.premium +
    floor.summary.good +
    floor.summary.fair +
    floor.summary.restricted +
    floor.summary.blocked ===
    3,
  'floor summary count'
);

const balc = calculateSightlines(scene, { levelId: 'lvl-balc' });
assert(balc.scores.length === 2, 'balc scores only');
assert(
  balc.scores.every((s) => s.seatId.startsWith('b')),
  'balc seat ids'
);

const applied = applySightlinesToScene(scene, { levelId: 'lvl-floor' });
assert(applied.result.scores.length === 3, 'apply floor scores');
const b1 = applied.scene.seats.find((s) => s.id === 'b1');
assert(b1?.visibility?.premiumView === true, 'balc visibility preserved');
assert(b1?.metadata?.sightline?.score === 0.99, 'balc metadata preserved');
const p1 = applied.scene.seats.find((s) => s.id === 'p1');
assert(p1?.metadata?.sightline?.grade, 'floor seat got sightline metadata');
assert(typeof p1.metadata.sightline.score === 'number', 'floor score number');

console.log('SIGHTLINE_LEVEL_FILTER_SMOKE_OK', {
  all: all.scores.length,
  floor: floor.scores.length,
  balc: balc.scores.length,
  applyPreservedBalc: true,
});
