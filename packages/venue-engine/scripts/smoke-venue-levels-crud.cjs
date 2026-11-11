const { removeVenueLevel, patchVenueLevel, migrateToV3 } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = {
  version: 3,
  sections: [
    {
      id: 's1',
      name: 'Platea',
      slug: 'platea',
      color: '#5b9fd4',
      levelId: 'plaza',
      seats: [],
    },
    {
      id: 's2',
      name: 'Balcon',
      slug: 'balcon',
      color: '#c45c6a',
      levelId: 'balcon',
      seats: [],
    },
  ],
  venue: {
    levels: [
      { id: 'plaza', name: 'Plaza', elevation: 0, zIndex: 0 },
      { id: 'balcon', name: 'Balcón', elevation: 120, zIndex: 1 },
    ],
    aisles: [
      {
        id: 'a1',
        levelId: 'plaza',
        points: [
          [0, 0],
          [0, 10],
        ],
      },
      {
        id: 'a2',
        levelId: 'balcon',
        points: [
          [20, 0],
          [20, 10],
        ],
      },
    ],
    exits: [{ id: 'e1', levelId: 'balcon', points: [[20, 20]] }],
    obstacles: [
      {
        id: 'o1',
        type: 'pillar',
        levelId: 'balcon',
        points: [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      },
    ],
    furniture: [{ id: 'f1', type: 'led', x: 5, y: 5, levelId: 'balcon' }],
    stairs: [
      {
        id: 'st1',
        fromLevelId: 'balcon',
        toLevelId: 'plaza',
        points: [
          [10, 5],
          [10, 15],
        ],
      },
    ],
  },
};

const renamed = patchVenueLevel(map, 'balcon', { name: 'Mezzanine', elevation: 140 });
assert(renamed.venue.levels.find((l) => l.id === 'balcon').name === 'Mezzanine', 'rename');
assert(renamed.venue.levels.find((l) => l.id === 'balcon').elevation === 140, 'elevation');

const cleared = removeVenueLevel(renamed, 'balcon');
assert((cleared.venue.levels ?? []).length === 1, 'one level left');
assert(cleared.venue.levels[0].id === 'plaza', 'plaza remains');
assert(cleared.venue.levels[0].zIndex === 0, 'reindexed');
assert(cleared.sections.find((s) => s.id === 's2').levelId == null, 'section cleared');
assert(cleared.venue.aisles.find((a) => a.id === 'a2').levelId == null, 'aisle cleared');
assert(cleared.venue.exits.find((e) => e.id === 'e1').levelId == null, 'exit cleared');
assert(cleared.venue.obstacles.find((o) => o.id === 'o1').levelId == null, 'obstacle cleared');
assert(cleared.venue.furniture.find((f) => f.id === 'f1').levelId == null, 'furniture cleared');
const st = cleared.venue.stairs[0];
assert(st.fromLevelId == null && st.toLevelId === 'plaza', 'stair from cleared, to kept');

const empty = removeVenueLevel(cleared, 'plaza');
assert((empty.venue.levels ?? []).length === 0 || empty.venue.levels == null, 'no levels');
assert(migrateToV3(empty).version === 3, 'still v3');

console.log('VENUE_LEVELS_CRUD_SMOKE_OK');
