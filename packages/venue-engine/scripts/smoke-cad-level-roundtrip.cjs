const {
  exportSeatMapToSvg,
  importSvgToSeatMap,
  exportSeatMapToDxf,
  importDxfToSeatMap,
  parseSvgLevels,
  parseDxfLevels,
  encodeDxfLayer,
  decodeDxfLayer,
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
      seats: [],
      shape: {
        points: [
          [40, 80],
          [180, 80],
          [180, 200],
          [40, 200],
          [40, 80],
        ],
      },
    },
    {
      id: 'sec-balc',
      name: 'Balcon',
      slug: 'balcon',
      color: '#c45c6a',
      levelId: 'balcon',
      seats: [],
      shape: {
        points: [
          [220, 80],
          [360, 80],
          [360, 160],
          [220, 160],
          [220, 80],
        ],
      },
    },
  ],
  venue: {
    units: 'map',
    scale: 40,
    levels: [
      { id: 'plaza', name: 'Plaza', elevation: 0, zIndex: 0 },
      { id: 'balcon', name: 'Balcón', elevation: 120, zIndex: 1 },
    ],
    stage: { x: 100, y: 20, width: 200, elevation: 40 },
    aisles: [
      {
        id: 'a-plaza',
        levelId: 'plaza',
        width: 24,
        points: [
          [110, 50],
          [110, 220],
        ],
      },
      {
        id: 'a-balc',
        levelId: 'balcon',
        width: 20,
        points: [
          [290, 50],
          [290, 180],
        ],
      },
    ],
    stairs: [
      {
        id: 'st-1',
        kind: 'stairs',
        fromLevelId: 'balcon',
        toLevelId: 'plaza',
        width: 28,
        points: [
          [190, 120],
          [210, 120],
        ],
      },
    ],
    exits: [
      {
        id: 'ex-plaza',
        levelId: 'plaza',
        width: 32,
        points: [[110, 240]],
        label: 'Salida plaza',
      },
    ],
    obstacles: [
      {
        id: 'obs-balc',
        type: 'pillar',
        levelId: 'balcon',
        height: 160,
        points: [
          [300, 90],
          [320, 90],
          [320, 110],
          [300, 110],
          [300, 90],
        ],
      },
    ],
    furniture: [
      { id: 'led-plaza', type: 'led', x: 200, y: 40, levelId: 'plaza' },
      { id: 'spk-balc', type: 'speaker', x: 280, y: 70, levelId: 'balcon' },
    ],
  },
};

// --- SVG round-trip ---
const svg = exportSeatMapToSvg(source);
assert(/data-level-id="plaza"/.test(svg), 'svg aisle/exit level attr');
assert(/data-from-level-id="balcon"/.test(svg), 'svg stair from');
assert(/data-to-level-id="plaza"/.test(svg), 'svg stair to');
assert(/data-role="levels"/.test(svg), 'svg levels meta');
const svgLevels = parseSvgLevels(svg);
assert(svgLevels?.length === 2, `svg levels meta count ${svgLevels?.length}`);
assert(
  svgLevels.some((l) => l.id === 'balcon'),
  'svg balcon level'
);

const svgImport = importSvgToSeatMap(svg, { version: 3, sections: [] }, { mode: 'replace-meta' });
assert(svgImport.map.venue?.levels?.length === 2, 'svg import levels');
assert(
  svgImport.map.venue?.aisles?.some((a) => a.levelId === 'plaza'),
  'svg aisle plaza'
);
assert(
  svgImport.map.venue?.aisles?.some((a) => a.levelId === 'balcon'),
  'svg aisle balcon'
);
assert(
  svgImport.map.venue?.stairs?.some((s) => s.fromLevelId === 'balcon' && s.toLevelId === 'plaza'),
  'svg stair levels'
);
assert(
  svgImport.map.venue?.exits?.some((e) => e.levelId === 'plaza'),
  'svg exit level'
);
assert(
  svgImport.map.sections.some((s) => s.levelId === 'plaza'),
  'svg section plaza'
);
assert(
  svgImport.map.sections.some((s) => s.levelId === 'balcon'),
  'svg section balcon'
);
assert(
  svgImport.map.venue?.obstacles?.some((o) => o.levelId === 'balcon'),
  'svg obstacle balcon'
);
assert(
  svgImport.map.venue?.furniture?.some((f) => f.type === 'led' && f.levelId === 'plaza'),
  'svg furniture led plaza'
);
assert(
  svgImport.map.venue?.furniture?.some((f) => f.type === 'speaker' && f.levelId === 'balcon'),
  'svg furniture speaker balcon'
);

// --- DXF layer encode/decode unit ---
const stairLayer = encodeDxfLayer('STAIRS', {
  fromLevelId: 'balcon',
  toLevelId: 'plaza',
});
assert(/F_BALCON/.test(stairLayer) && /T_PLAZA/.test(stairLayer), `encode ${stairLayer}`);
const decoded = decodeDxfLayer(stairLayer);
assert(decoded.baseLayer === 'STAIRS', `base ${decoded.baseLayer}`);
assert(decoded.tags.fromLevelId === 'balcon', `from ${decoded.tags.fromLevelId}`);
assert(decoded.tags.toLevelId === 'plaza', `to ${decoded.tags.toLevelId}`);

// --- DXF round-trip ---
const dxf = exportSeatMapToDxf(source);
assert(/AISLE__L_PLAZA/.test(dxf), 'dxf aisle layer');
assert(/EXIT__L_PLAZA/.test(dxf), 'dxf exit layer');
assert(/OBSTACLE__L_BALCON/.test(dxf), 'dxf obstacle layer');
assert(/FURN_LED__L_PLAZA/.test(dxf), 'dxf furniture led');
assert(/F_BALCON/.test(dxf) && /T_PLAZA/.test(dxf), 'dxf stair F/T');
assert(/BOLETERA_LEVELS/.test(dxf), 'dxf levels layer');
const dxfLevels = parseDxfLevels(dxf);
assert(dxfLevels?.length === 2, `dxf levels ${dxfLevels?.length}`);

const dxfImport = importDxfToSeatMap(dxf, { version: 3, sections: [] }, { mode: 'replace-meta' });
assert(dxfImport.map.venue?.levels?.length === 2, 'dxf import levels');
assert(
  dxfImport.map.venue?.aisles?.some((a) => a.levelId === 'plaza'),
  'dxf aisle plaza'
);
assert(
  dxfImport.map.venue?.stairs?.some((s) => s.fromLevelId === 'balcon' && s.toLevelId === 'plaza'),
  'dxf stair levels'
);
assert(
  dxfImport.map.venue?.exits?.some((e) => e.levelId === 'plaza'),
  'dxf exit level'
);
assert(
  dxfImport.map.sections.some((s) => s.levelId === 'plaza'),
  'dxf section plaza'
);
assert(
  dxfImport.map.venue?.obstacles?.some((o) => o.levelId === 'balcon'),
  'dxf obstacle balcon'
);
assert(
  dxfImport.map.venue?.furniture?.some((f) => f.levelId === 'plaza'),
  'dxf furniture plaza'
);

console.log('CAD_LEVEL_ROUNDTRIP_SMOKE_OK');
