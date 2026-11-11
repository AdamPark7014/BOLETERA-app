const { resolveGeometry, analyzeCirculation, buildCirculationGraph } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const plaza = 'lvl-plaza';
const balc = 'lvl-balc';

/** Two stacked sections at same XY footprint — false join without level rules. */
const map = {
  version: 3,
  sections: [
    {
      id: 'sec-plaza',
      name: 'Plaza',
      slug: 'plaza',
      color: '#5b9fd4',
      levelId: plaza,
      seats: [
        { id: 'p1', label: 'A1', x: 100, y: 200 },
        { id: 'p2', label: 'A2', x: 120, y: 200 },
      ],
    },
    {
      id: 'sec-balc',
      name: 'Balcón',
      slug: 'balc',
      color: '#c45c6a',
      levelId: balc,
      seats: [
        { id: 'b1', label: 'B1', x: 100, y: 200 },
        { id: 'b2', label: 'B2', x: 120, y: 200 },
      ],
    },
  ],
  venue: {
    scale: 40,
    levels: [
      { id: plaza, name: 'Plaza', elevation: 0, zIndex: 0 },
      { id: balc, name: 'Balcón', elevation: 120, zIndex: 1 },
    ],
    aisles: [
      {
        id: 'aisle-plaza',
        levelId: plaza,
        width: 20,
        points: [
          [110, 180],
          [110, 60],
        ],
      },
      {
        id: 'aisle-balc',
        levelId: balc,
        width: 20,
        points: [
          [110, 180],
          [110, 40],
        ],
      },
    ],
    exits: [
      { id: 'exit-plaza', points: [[110, 60]], width: 32, levelId: plaza },
      { id: 'exit-balc', points: [[110, 40]], width: 32, levelId: balc },
    ],
  },
};

const sceneNoStair = resolveGeometry(map);
const graphNo = buildCirculationGraph(sceneNoStair);
const crossLinks = graphNo.edges.filter((e) => {
  if (e.kind !== 'link') return false;
  const a = graphNo.nodes.find((n) => n.id === e.from);
  const b = graphNo.nodes.find((n) => n.id === e.to);
  return a?.levelId && b?.levelId && a.levelId !== b.levelId;
});
assert(crossLinks.length === 0, `false cross-level links: ${crossLinks.length}`);

const analysisNo = analyzeCirculation(sceneNoStair);
assert(analysisNo.hasNetwork, 'network');
// Balcony should reach its own exit without needing plaza aisle
const balcEg = analysisNo.egress.sections.find((s) => s.sectionId === 'sec-balc');
const plazaEg = analysisNo.egress.sections.find((s) => s.sectionId === 'sec-plaza');
assert(balcEg?.pathLength != null, 'balcony path without stair');
assert(plazaEg?.pathLength != null, 'plaza path');

// With stair bridging levels — balcony can reach plaza exit too (optional connectivity)
const withStair = {
  ...map,
  venue: {
    ...map.venue,
    exits: [{ id: 'exit-plaza-only', points: [[110, 60]], width: 32, levelId: plaza }],
    stairs: [
      {
        id: 'stair-1',
        kind: 'stairs',
        fromLevelId: balc,
        toLevelId: plaza,
        width: 28,
        points: [
          [140, 190],
          [140, 100],
        ],
      },
    ],
    aisles: [
      {
        id: 'aisle-plaza',
        levelId: plaza,
        width: 20,
        points: [
          [140, 100],
          [110, 100],
          [110, 60],
        ],
      },
      {
        id: 'aisle-balc',
        levelId: balc,
        width: 20,
        points: [
          [110, 200],
          [140, 190],
        ],
      },
    ],
  },
};

const analysisStair = analyzeCirculation(resolveGeometry(withStair));
assert(analysisStair.seedMode === 'exits', 'exit seeds');
const balcVia = analysisStair.egress.sections.find((s) => s.sectionId === 'sec-balc');
assert(balcVia?.pathLength != null, 'balcony reaches plaza exit via stair');
assert(
  analysisStair.graph.nodes.some((n) => n.kind === 'stair' && n.levelId === balc),
  'stair from-level node'
);
assert(
  analysisStair.graph.nodes.some((n) => n.kind === 'stair' && n.levelId === plaza),
  'stair to-level node'
);

// Without stair, balcony cannot reach plaza-only exit
const noBridge = {
  ...withStair,
  venue: { ...withStair.venue, stairs: [] },
};
const analysisIsolated = analyzeCirculation(resolveGeometry(noBridge));
assert(
  analysisIsolated.unreachableSections.includes('sec-balc'),
  'balcony unreachable without stair to plaza exit'
);

console.log('MULTI_LEVEL_STAIRS_SMOKE_OK', {
  crossLinks: crossLinks.length,
  balcPath: balcVia.pathLength,
  isolated: analysisIsolated.unreachableSections,
});
