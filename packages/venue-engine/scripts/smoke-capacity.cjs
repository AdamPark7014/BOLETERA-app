const {
  resolveGeometry,
  analyzeCirculation,
  edgeCapacity,
  EGRESS_DEFAULTS,
  generateTheaterTemplate,
  validateGeometry,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = generateTheaterTemplate();
const stage = map.venue.stage;
const cx = stage.x + stage.width / 2;

map.venue = {
  ...map.venue,
  aisles: [
    {
      id: 'narrow',
      width: 10,
      points: [
        [cx, stage.y + 30],
        [cx, 380],
      ],
    },
  ],
};

const narrow = analyzeCirculation(resolveGeometry(map));
assert(narrow.hasNetwork, 'network');
assert(narrow.egress.bottlenecks.length > 0, 'bottlenecks');
const top = narrow.egress.bottlenecks[0];
assert(top.width === 10, `width ${top.width}`);
assert(top.capacity === edgeCapacity(10), `cap ${top.capacity}`);
assert(typeof top.utilization === 'number', 'utilization');
assert(top.overCapacity === top.utilization > 1, 'overCapacity flag');

console.log('narrow:', {
  width: top.width,
  capacity: top.capacity,
  seatLoad: top.seatLoad,
  util: Math.round(top.utilization * 100) + '%',
  over: top.overCapacity,
});

map.venue.aisles[0].width = 80;
const wide = analyzeCirculation(resolveGeometry(map));
const topWide = wide.egress.bottlenecks[0];
assert(topWide.width === 80, 'wide width');
assert(topWide.utilization < top.utilization, 'wider aisle lowers utilization');
assert(topWide.capacity > top.capacity, 'wider capacity');

const issues = validateGeometry(
  resolveGeometry({
    ...map,
    venue: { ...map.venue, aisles: [{ ...map.venue.aisles[0], width: 8 }] },
  })
).issues;
console.log(
  'validate:',
  issues.filter((i) => i.code === 'egress_bottleneck').map((i) => i.message)
);

assert(EGRESS_DEFAULTS.aisleWidth === 24, 'defaults');
console.log('CAPACITY_SMOKE_OK');
