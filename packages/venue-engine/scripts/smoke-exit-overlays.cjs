const { resolveGeometry, projectTo2D, projectTo3D } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = {
  version: 3,
  sections: [
    {
      id: 's1',
      name: 'A',
      slug: 'a',
      color: '#5b9fd4',
      seats: [
        { id: 'a1', label: 'A1', x: 100, y: 120 },
        { id: 'a2', label: 'A2', x: 130, y: 120 },
      ],
    },
  ],
  venue: {
    scale: 40,
    stage: { x: 80, y: 20, width: 120, elevation: 40 },
    aisles: [
      {
        id: 'main',
        points: [
          [140, 40],
          [140, 200],
        ],
        width: 20,
      },
    ],
    exits: [
      { id: 'exit-n', label: 'Norte', points: [[140, 200]], width: 36 },
      {
        id: 'exit-mouth',
        label: 'Boca',
        points: [
          [40, 180],
          [60, 180],
        ],
        width: 28,
      },
    ],
    furniture: [{ id: 'd1', type: 'door', x: 50, y: 50 }],
  },
};

const scene = resolveGeometry(map);
assert(scene.exits.length >= 2, `scene exits ${scene.exits.length}`);
// furniture door becomes exit when no authored? We have authored so doors stay furniture
assert(
  scene.furniture.some((f) => f.type === 'door'),
  'door furniture preserved'
);

const p2 = projectTo2D(scene);
assert(p2.exits.length === scene.exits.length, '2d exits');
assert(p2.exits[0].points.length >= 1, '2d exit points');

const p3 = projectTo3D(scene);
assert(p3.exits.length === scene.exits.length, '3d exits');
assert(p3.exits[0].points[0].length === 3, '3d xyz');
assert(typeof p3.exits[0].label === 'string' || p3.exits[0].label == null, 'label');

console.log('EXIT_OVERLAYS_SMOKE_OK', {
  exits2d: p2.exits.length,
  exits3d: p3.exits.length,
  labels: p3.exits.map((e) => e.label),
});
