const {
  resolveGeometry,
  analyzeCirculation,
  validateGeometry,
  generateTheaterTemplate,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Network: aisle linking stage to sections
const map = generateTheaterTemplate();
const stage = map.venue.stage;
const cx = stage.x + stage.width / 2;
map.venue = {
  ...map.venue,
  aisles: [
    {
      id: 'main-aisle',
      points: [
        [cx, stage.y + 30],
        [cx, 200],
        [cx, 380],
      ],
    },
    {
      id: 'side-aisle',
      points: [
        [cx, 200],
        [100, 200],
        [100, 160],
      ],
    },
  ],
};

const scene = resolveGeometry(map);
const analysis = analyzeCirculation(scene);

assert(analysis.hasNetwork, 'has network');
assert(analysis.egress, 'egress present');
assert(analysis.egress.sections.length > 0, 'section egress');
assert(
  analysis.egress.sections.some((s) => s.pathLength != null && s.pathLength > 0),
  'some paths have length'
);
assert(analysis.egress.maxPathLength != null, 'max path');
assert(analysis.egress.avgPathLength != null, 'avg path');
assert(analysis.egress.totalSeatsWithPath > 0, 'seats with path');

console.log('egress:', {
  sections: analysis.egress.sections.map((s) => ({
    id: s.sectionId,
    seats: s.seatCount,
    len: s.pathLength != null ? Math.round(s.pathLength) : null,
  })),
  max: Math.round(analysis.egress.maxPathLength),
  avg: Math.round(analysis.egress.avgPathLength),
  bottlenecks: analysis.egress.bottlenecks.slice(0, 3).map((b) => ({
    kind: b.kind,
    seats: b.seatLoad,
    secs: b.sectionCount,
  })),
});

// Far section → unreachable + long path case
const farMap = {
  ...map,
  sections: [
    ...map.sections,
    {
      id: 'far-sec',
      name: 'Far',
      slug: 'far',
      color: '#999',
      seats: [{ id: 'far-1', label: 'F-1', x: 2000, y: 2000 }],
    },
  ],
};
const farAnalysis = analyzeCirculation(resolveGeometry(farMap));
assert(farAnalysis.unreachableSections.includes('far-sec'), 'far unreachable');

const validation = validateGeometry(resolveGeometry(map));
console.log('validate codes:', [...new Set(validation.issues.map((i) => i.code))]);

console.log('EGRESS_SMOKE_OK');
