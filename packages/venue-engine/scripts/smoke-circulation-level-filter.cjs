const { resolveGeometry, analyzeCirculation, filterCirculationGraph } = require('../dist/index.js');

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

const all = filterCirculationGraph(analysis.graph);
assert(all.nodes.length === analysis.graph.nodes.length, 'ALL passthrough');

const floor = filterCirculationGraph(analysis.graph, 'lvl-floor');
const balc = filterCirculationGraph(analysis.graph, 'lvl-balc');

assert(floor.edges.length < analysis.graph.edges.length, 'floor fewer edges');
assert(balc.edges.length < analysis.graph.edges.length, 'balc fewer edges');

const floorSections = floor.nodes.filter((n) => n.kind === 'section');
assert(
  floorSections.every((n) => !n.levelId || n.levelId === 'lvl-floor'),
  'floor sections only'
);
assert(
  floorSections.some((n) => n.sectionId === 'pit'),
  'pit kept'
);
assert(!floorSections.some((n) => n.sectionId === 'balc'), 'balc section hidden on floor');

const balcSections = balc.nodes.filter((n) => n.kind === 'section');
assert(
  balcSections.some((n) => n.sectionId === 'balc'),
  'balc kept'
);
assert(!balcSections.some((n) => n.sectionId === 'pit'), 'pit hidden on balc');

const floorHasStair = floor.edges.some((e) => e.kind === 'stair');
const balcHasStair = balc.edges.some((e) => e.kind === 'stair');
assert(floorHasStair || balcHasStair, 'stair visible on at least one filter');

console.log('CIRCULATION_LEVEL_FILTER_SMOKE_OK', {
  all: { nodes: all.nodes.length, edges: all.edges.length },
  floor: { nodes: floor.nodes.length, edges: floor.edges.length, stair: floorHasStair },
  balc: { nodes: balc.nodes.length, edges: balc.edges.length, stair: balcHasStair },
});
