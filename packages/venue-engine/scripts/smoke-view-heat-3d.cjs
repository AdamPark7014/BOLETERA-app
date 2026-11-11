const {
  resolveGeometry,
  calculateSightlines,
  sightlineHeatColor,
  generateTheaterTemplate,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = generateTheaterTemplate({ capacity: 60, sectionCount: 3 });
map.venue = {
  ...(map.venue ?? {}),
  levels: [
    { id: 'lvl-floor', name: 'Platea', elevation: 0, zIndex: 0 },
    { id: 'lvl-balc', name: 'Balcón', elevation: 120, zIndex: 1 },
  ],
};
if (map.sections[0]) map.sections[0].levelId = 'lvl-floor';
if (map.sections[1]) map.sections[1].levelId = 'lvl-balc';

const scene = resolveGeometry(map);
const all = calculateSightlines(scene);
assert(all.scores.length > 10, 'scores');

const heat = new Map();
for (const s of all.scores) {
  const c = sightlineHeatColor(s.score);
  assert(/^rgb\(/.test(c), `color for ${s.seatId}`);
  heat.set(s.seatId, c);
}
assert(heat.size === all.scores.length, 'heat map size');

const floor = calculateSightlines(scene, { levelId: 'lvl-floor' });
assert(floor.scores.length < all.scores.length, 'level filter fewer');
assert(
  floor.scores.every((s) => {
    const seat = scene.seats.find((x) => x.id === s.seatId);
    return !seat?.levelId || seat.levelId === 'lvl-floor';
  }),
  'floor seats only'
);

console.log('VIEW_HEAT_3D_SMOKE_OK', {
  all: all.scores.length,
  floor: floor.scores.length,
  sample: all.scores.slice(0, 2).map((s) => ({
    id: s.seatId,
    grade: s.grade,
    color: heat.get(s.seatId),
  })),
});
