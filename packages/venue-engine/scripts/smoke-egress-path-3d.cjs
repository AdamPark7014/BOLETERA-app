const {
  generateTheaterTemplate,
  resolveGeometry,
  buildEgressPathOverlays,
  projectEgressOverlaysTo3D,
  projectTo3D,
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
const overlay2d = buildEgressPathOverlays(scene);
const overlay3d = projectEgressOverlaysTo3D(scene);
const p3 = projectTo3D(scene);

assert(overlay3d.hasNetwork, '3d has network');
assert(overlay3d.paths.length === overlay2d.paths.length, 'same path count');
assert(overlay3d.paths.length >= 1, 'paths');
assert(
  overlay3d.paths.every((p) => p.points.length >= 2 && p.points.every((pt) => pt.length === 3)),
  'xyz polylines'
);
assert(
  overlay3d.bottlenecks.every((b) => b.points.every((pt) => pt.length === 3)),
  'bn xyz'
);

// Same plan transform as seats: first path point X should match map→world of 2d point
const first2 = overlay2d.paths[0].points[0];
const first3 = overlay3d.paths[0].points[0];
const seat = p3.seats[0];
assert(Number.isFinite(first3[0]) && Number.isFinite(first3[2]), 'finite xz');
assert(Math.abs(first3[1] - 0.1) < 1e-6, 'path elev');
// World span shared — path xz magnitude in same order as seats
assert(Math.abs(first3[0]) < 20 && Math.abs(first3[2]) < 20, 'in world span');
assert(Math.abs(seat.px) < 20, 'seat in span');
void first2;

const empty = projectEgressOverlaysTo3D(resolveGeometry({ version: 3, sections: [] }));
assert(empty.paths.length === 0, 'empty seats → no 3d paths');

console.log('EGRESS_PATH_3D_SMOKE_OK', {
  paths: overlay3d.paths.length,
  bottlenecks: overlay3d.bottlenecks.length,
  sample: overlay3d.paths[0]?.points[0],
});
