const {
  applyCadPrimitivesToSeatMap,
  enforceCadLocksOnReview,
  isCadRoleLocked,
  activeCadLockLabels,
  commitCadImportReview,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = {
  version: 3,
  sections: [],
  venue: {
    cadLocks: { furniture: true, exits: true, aisles: true, focusPoints: true },
    furniture: [{ id: 'led-keep', type: 'led', x: 10, y: 10 }],
    exits: [{ id: 'ex-keep', points: [[0, 0]], label: 'Keep' }],
    focusPoints: [{ id: 'fp-keep', label: 'Centro', x: 40, y: 20, z: 50 }],
    aisles: [
      {
        id: 'a-keep',
        points: [
          [0, 0],
          [0, 50],
        ],
      },
    ],
    stage: { x: 100, y: 20, width: 200, elevation: 40 },
  },
};

assert(isCadRoleLocked('furniture', base.venue.cadLocks), 'furniture locked');
assert(isCadRoleLocked('focus', base.venue.cadLocks), 'focus locked');
assert(!isCadRoleLocked('section', base.venue.cadLocks), 'section free');
assert(activeCadLockLabels(base.venue.cadLocks).includes('Mobiliario'), 'label');
assert(activeCadLockLabels(base.venue.cadLocks).includes('Focos'), 'focus label');

const review = [
  {
    id: 'f1',
    suggestedRole: 'furniture',
    role: 'furniture',
    name: 'LED',
    points: [[50, 50]],
    pointCount: 1,
  },
  {
    id: 'e1',
    suggestedRole: 'exit',
    role: 'exit',
    name: 'Nueva',
    points: [[80, 80]],
    pointCount: 1,
  },
  {
    id: 'a1',
    suggestedRole: 'aisle',
    role: 'aisle',
    name: 'Pasillo',
    points: [
      [10, 10],
      [10, 90],
    ],
    pointCount: 2,
  },
  {
    id: 'fp1',
    suggestedRole: 'focus',
    role: 'focus',
    name: 'Foco',
    points: [[60, 30]],
    pointCount: 1,
    z: 55,
  },
  {
    id: 's1',
    suggestedRole: 'section',
    role: 'section',
    name: 'Zona',
    points: [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
    ],
    pointCount: 4,
  },
];

const enforced = enforceCadLocksOnReview(review, base.venue.cadLocks);
assert(enforced.lockedCount === 4, `lockedCount ${enforced.lockedCount}`);
assert(enforced.rows.filter((r) => r.role === 'skip').length === 4, 'four skips');
assert(enforced.rows.find((r) => r.id === 's1').role === 'section', 'section kept');

// Direct apply: locked furniture must not append; base furniture preserved
const applied = applyCadPrimitivesToSeatMap(
  [
    { id: 'f-new', role: 'furniture', name: 'led', points: [[99, 99]] },
    { id: 'ex-new', role: 'exit', name: 'X', points: [[1, 1]] },
    { id: 'fp-new', role: 'focus', name: 'Nuevo', points: [[70, 40]], z: 60 },
    {
      id: 'sec',
      role: 'section',
      name: 'Ok',
      points: [
        [0, 0],
        [30, 0],
        [30, 30],
        [0, 30],
      ],
    },
  ],
  base,
  { mode: 'merge', cadLocks: base.venue.cadLocks }
);
assert(applied.stats.lockedSkipped === 3, `lockedSkipped ${applied.stats.lockedSkipped}`);
assert(applied.stats.furniture === 0, 'no new furniture');
assert(applied.stats.exits === 0, 'no new exits');
assert(applied.stats.focuses === 0, 'no new focuses');
assert(applied.stats.sections === 1, 'section ok');
assert(
  applied.map.venue.furniture.some((f) => f.id === 'led-keep'),
  'kept furniture'
);
assert(applied.map.venue.furniture.length === 1, 'no furniture append');
assert(
  applied.map.venue.exits.some((e) => e.id === 'ex-keep'),
  'kept exit'
);
assert(
  applied.map.venue.focusPoints.some((f) => f.id === 'fp-keep'),
  'kept focus'
);
assert(applied.map.venue.focusPoints.length === 1, 'no focus append');

// replace-meta must NOT wipe locked layers
const replaced = applyCadPrimitivesToSeatMap(
  [
    {
      id: 'sec2',
      role: 'section',
      name: 'Only',
      points: [
        [5, 5],
        [25, 5],
        [25, 25],
        [5, 25],
      ],
    },
  ],
  base,
  { mode: 'replace-meta', cadLocks: base.venue.cadLocks }
);
assert(
  replaced.map.venue.aisles.some((a) => a.id === 'a-keep'),
  'aisles preserved on replace'
);
assert(
  replaced.map.venue.exits.some((e) => e.id === 'ex-keep'),
  'exits preserved on replace'
);
assert(
  replaced.map.venue.furniture.some((f) => f.id === 'led-keep'),
  'furniture preserved on replace'
);
assert(
  replaced.map.venue.focusPoints.some((f) => f.id === 'fp-keep'),
  'focus preserved on replace'
);

const committed = commitCadImportReview(enforced.rows, base, {
  mode: 'merge',
  cadLocks: base.venue.cadLocks,
});
assert(committed.stats.sections === 1, 'commit section');
assert(committed.stats.lockedSkipped === 0, 'already skipped in review');

console.log('CAD_LOCKS_IMPORT_SMOKE_OK', {
  lockedSkipped: applied.stats.lockedSkipped,
  labels: activeCadLockLabels(base.venue.cadLocks),
});
