const {
  exportSeatMapToSvg,
  importSvgToSeatMap,
  exportSeatMapToDxf,
  importDxfToSeatMap,
  previewSvgCadImport,
  applyCadPrimitivesToSeatMap,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const source = {
  version: 3,
  sections: [
    {
      id: 'sec-a',
      name: 'Platea',
      slug: 'platea',
      color: '#5b9fd4',
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
  ],
  venue: {
    units: 'map',
    scale: 40,
    stage: { x: 100, y: 20, width: 200, elevation: 40 },
    focusPoints: [
      { id: 'focus-l', label: 'Izquierda', x: 120, y: 30, z: 45 },
      { id: 'focus-c', label: 'Centro', x: 200, y: 28, z: 50 },
      { id: 'focus-r', label: 'Derecha', x: 280, y: 30, z: 45 },
    ],
  },
};

// --- SVG ---
const svg = exportSeatMapToSvg(source);
assert(/data-role="focus"/.test(svg), 'svg focus role');
assert(/data-name="Centro"/.test(svg), 'svg focus label');
assert(/data-z="50"/.test(svg), 'svg focus z');

const preview = previewSvgCadImport(svg);
assert(
  preview.some((r) => r.role === 'focus' || r.suggestedRole === 'focus'),
  'preview focus'
);

const svgImport = importSvgToSeatMap(svg, { version: 3, sections: [] }, { mode: 'replace-meta' });
assert(svgImport.stats.focuses >= 3, `svg focuses ${svgImport.stats.focuses}`);
const foci = svgImport.map.venue?.focusPoints ?? [];
assert(foci.length >= 3, `focus count ${foci.length}`);
assert(
  foci.some((f) => /centro/i.test(f.label ?? '') && f.z === 50),
  'centro z=50'
);

// --- DXF ---
const dxf = exportSeatMapToDxf(source);
assert(/FOCUS_CENTRO|FOCUS_Centro|FOCUS_CENTER/i.test(dxf) || /FOCUS/.test(dxf), 'dxf focus layer');
assert(/\n30\n50\n/.test(dxf) || /\n30\n45\n/.test(dxf), 'dxf z code 30');

const dxfImport = importDxfToSeatMap(dxf, { version: 3, sections: [] }, { mode: 'replace-meta' });
assert(dxfImport.stats.focuses >= 1, `dxf focuses ${dxfImport.stats.focuses}`);
assert((dxfImport.map.venue?.focusPoints?.length ?? 0) >= 1, 'dxf focus points');
assert(
  dxfImport.map.venue.focusPoints.some((f) => f.z === 50 || f.z === 45),
  'dxf z preserved'
);

// Direct apply focus role
const direct = applyCadPrimitivesToSeatMap(
  [
    {
      id: 'f1',
      role: 'focus',
      name: 'Proscenio',
      points: [[10, 20]],
      z: 60,
    },
  ],
  { version: 3, sections: [] },
  { mode: 'replace-meta' }
);
assert(direct.stats.focuses === 1, 'direct focus');
assert(direct.map.venue.focusPoints[0].label === 'Proscenio', 'label');
assert(direct.map.venue.focusPoints[0].z === 60, 'z');

console.log('CAD_FOCUS_ROUNDTRIP_SMOKE_OK', {
  svgFocuses: svgImport.stats.focuses,
  dxfFocuses: dxfImport.stats.focuses,
});
