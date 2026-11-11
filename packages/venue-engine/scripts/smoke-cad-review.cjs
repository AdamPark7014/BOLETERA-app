const {
  previewSvgCadImport,
  previewDxfCadImport,
  commitCadImportReview,
  applyCadPrimitivesToSeatMap,
  importSvgToSeatMap,
  CAD_ENTITY_ROLES,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect id="stage" class="stage" data-role="stage" x="100" y="20" width="200" height="30"/>
  <polyline id="aisle1" class="aisle" data-role="aisle" points="200,50 200,280"/>
  <polygon id="sec-a" class="section" data-name="Platea" points="40,80 180,80 180,200 40,200"/>
  <circle id="exit-n" class="exit" data-role="exit" cx="200" cy="280" r="8"/>
  <polygon id="noise" class="decoration" points="10,10 30,10 30,30 10,30"/>
</svg>`;

const preview = previewSvgCadImport(svg);
assert(preview.length >= 4, `preview rows ${preview.length}`);
assert(
  preview.some((r) => r.suggestedRole === 'stage'),
  'stage suggested'
);
assert(
  preview.some((r) => r.suggestedRole === 'aisle'),
  'aisle suggested'
);
assert(
  preview.some((r) => r.suggestedRole === 'exit'),
  'exit suggested'
);
assert(CAD_ENTITY_ROLES.includes('skip'), 'skip role');

const reviewed = preview.map((r) =>
  r.suggestedRole === 'section' && /decoration|noise/i.test(r.name + r.id)
    ? { ...r, role: 'skip' }
    : r.suggestedRole === 'section' && r.name === 'Platea'
      ? r
      : r.role === 'section' && !/platea/i.test(r.name)
        ? {
            ...r,
            role:
              r.id.includes('noise') || r.name.toLowerCase().includes('decoration')
                ? 'skip'
                : r.role,
          }
        : r
);

// Force-skip the decoration polygon explicitly
const forced = reviewed.map((r) =>
  /noise|decoration/i.test(r.id + r.name) ? { ...r, role: 'skip' } : r
);

const { map, stats } = commitCadImportReview(
  forced,
  { version: 3, sections: [] },
  { mode: 'replace-meta' }
);
assert(stats.sections >= 1, `sections ${stats.sections}`);
assert(stats.aisles >= 1, 'aisles');
assert(stats.exits >= 1, 'exits');
assert(stats.stage === true, 'stage');
assert(stats.skipped >= 1, `skipped ${stats.skipped}`);
assert((map.venue?.aisles?.length ?? 0) >= 1, 'map aisles');

// Direct apply with role override: aisle → exit
const flipped = applyCadPrimitivesToSeatMap(
  [
    {
      id: 'p1',
      role: 'exit',
      name: 'Door',
      points: [
        [10, 10],
        [20, 10],
      ],
    },
    {
      id: 'p2',
      role: 'skip',
      name: 'x',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    },
  ],
  { version: 3, sections: [] },
  { mode: 'replace-meta' }
);
assert(flipped.stats.exits === 1, 'override exit');
assert(flipped.stats.skipped === 1, 'skip counted');

// importSvg still works (compat)
const direct = importSvgToSeatMap(svg, { version: 3, sections: [] }, { mode: 'replace-meta' });
assert(direct.stats.aisles >= 1, 'compat import');

// Minimal DXF with EXIT layer
const dxf = `0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
AISLE
90
2
70
0
10
0
20
0
10
0
20
100
0
CIRCLE
8
EXIT
10
0
20
100
40
5
0
ENDSEC
0
EOF
`;
const dxfPreview = previewDxfCadImport(dxf);
assert(
  dxfPreview.some((r) => r.suggestedRole === 'aisle'),
  'dxf aisle'
);
assert(
  dxfPreview.some((r) => r.suggestedRole === 'exit'),
  'dxf exit'
);

console.log('CAD_IMPORT_REVIEW_SMOKE_OK', {
  svgRows: preview.length,
  skipped: stats.skipped,
  dxfRows: dxfPreview.length,
});
