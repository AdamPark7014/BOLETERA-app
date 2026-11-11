const {
  exportSeatMapToSvg,
  importSvgToSeatMap,
  exportSeatMapToDxf,
  importDxfToSeatMap,
  applyCadPrimitivesToSeatMap,
  removeVenueLevel,
  projectTo3D,
  resolveGeometry,
  calculateSightlines,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const source = {
  version: 3,
  sections: [
    {
      id: 'sec-plaza',
      name: 'Platea',
      slug: 'platea',
      color: '#5b9fd4',
      levelId: 'plaza',
      seats: [
        { id: 'p1', label: 'P1', x: 100, y: 160 },
        { id: 'p2', label: 'P2', x: 130, y: 160 },
      ],
    },
    {
      id: 'sec-balc',
      name: 'Balcon',
      slug: 'balcon',
      color: '#c45c6a',
      levelId: 'balcon',
      seats: [{ id: 'b1', label: 'B1', x: 100, y: 50, elevation: 120 }],
    },
  ],
  venue: {
    scale: 40,
    stage: { x: 80, y: 10, width: 120, elevation: 40 },
    levels: [
      { id: 'plaza', name: 'Platea', elevation: 0, zIndex: 0 },
      { id: 'balcon', name: 'Balcón', elevation: 120, zIndex: 1 },
    ],
    focusPoints: [
      { id: 'focus-floor', label: 'Plaza', x: 120, y: 30, z: 45, levelId: 'plaza' },
      { id: 'focus-balc', label: 'Balcón', x: 200, y: 28, z: 130, levelId: 'balcon' },
    ],
  },
};

const svg = exportSeatMapToSvg(source);
assert(/data-role="focus"/.test(svg), 'svg focus');
assert(/data-level-id="plaza"/.test(svg), 'svg focus plaza level');
assert(/data-level-id="balcon"/.test(svg), 'svg focus balcon level');

const svgImport = importSvgToSeatMap(svg, { version: 3, sections: [] }, { mode: 'replace-meta' });
const svgFoci = svgImport.map.venue?.focusPoints ?? [];
assert(
  svgFoci.some((f) => f.levelId === 'plaza'),
  'svg import plaza focus'
);
assert(
  svgFoci.some((f) => f.levelId === 'balcon'),
  'svg import balcon focus'
);

const dxf = exportSeatMapToDxf(source);
assert(/__L_plaza|L_plaza/i.test(dxf), 'dxf plaza tag');
const dxfImport = importDxfToSeatMap(dxf, { version: 3, sections: [] }, { mode: 'replace-meta' });
const dxfFoci = dxfImport.map.venue?.focusPoints ?? [];
assert(
  dxfFoci.some((f) => f.levelId === 'plaza' || f.levelId === 'balcon'),
  'dxf import keeps level'
);

const direct = applyCadPrimitivesToSeatMap(
  [
    {
      id: 'f1',
      role: 'focus',
      name: 'Proscenio',
      points: [[10, 20]],
      z: 60,
      levelId: 'plaza',
    },
  ],
  { version: 3, sections: [], venue: { levels: source.venue.levels } },
  { mode: 'replace-meta', levels: source.venue.levels }
);
assert(direct.map.venue.focusPoints[0].levelId === 'plaza', 'direct apply levelId');

const cleared = removeVenueLevel(source, 'balcon');
assert(
  (cleared.venue?.focusPoints ?? []).find((f) => f.id === 'focus-balc')?.levelId == null,
  'remove level clears focus levelId'
);

const projected = projectTo3D(resolveGeometry(source));
assert(
  projected.focusPoints.every((f) => f.levelId === 'plaza' || f.levelId === 'balcon'),
  'project3d carries levelId'
);

const scene = resolveGeometry(source);
const scores = calculateSightlines(scene);
const b1 = scores.scores.find((s) => s.seatId === 'b1');
assert(b1?.focusId === 'focus-balc', `balc seat prefers balc focus got ${b1?.focusId}`);

console.log('FOCUS_LEVEL_ROUNDTRIP_SMOKE_OK', {
  svgFoci: svgFoci.length,
  dxfFoci: dxfFoci.length,
  focusId: b1.focusId,
});
