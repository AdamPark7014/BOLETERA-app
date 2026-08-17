/**
 * Headless benchmark for the venue-engine render stack.
 * Generates 250_000 seats and measures spatial index build, hit-test, and culling.
 *
 * Usage: pnpm --filter @boletera/venue-engine bench:render
 */
const {
  generateSyntheticVenue,
  buildSceneBuffers,
} = require('../dist/render/index.js');

const SEAT_COUNT = 250_000;
const HIT_SAMPLES = 5_000;
const CULL_SAMPLES = 200;

function now() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function main() {
  console.log('=== @boletera/venue-engine bench:render ===');
  console.log(`Generating synthetic venue with ${SEAT_COUNT.toLocaleString()} seats…`);

  const tGen0 = now();
  const map = generateSyntheticVenue(SEAT_COUNT, 250);
  const tGen1 = now();
  console.log(`  generate: ${(tGen1 - tGen0).toFixed(1)} ms`);

  console.log('Building scene buffers + spatial index…');
  const tBuild0 = now();
  const scene = buildSceneBuffers(map, { colorMode: 'zone', seatRadius: 6 });
  const tBuild1 = now();
  const buildMs = tBuild1 - tBuild0;

  console.log(`  seatCount:     ${scene.seatCount.toLocaleString()}`);
  console.log(`  indexBuildMs:  ${scene.indexBuildMs.toFixed(2)} ms (index only)`);
  console.log(`  fullBuildMs:   ${buildMs.toFixed(2)} ms (flatten + colors + LOD + index)`);
  console.log(
    `  grid:          ${scene.index.gridSize.cols}×${scene.index.gridSize.rows} cells @ ${scene.index.cellSize.toFixed(2)} wu`,
  );
  console.log(
    `  bounds:        ${scene.bounds.width.toFixed(0)}×${scene.bounds.height.toFixed(0)} wu`,
  );

  // --- Hit-testing ---
  const hitTimes = [];
  const rng = mulberry32(0xc0ffee);
  let hits = 0;
  for (let i = 0; i < HIT_SAMPLES; i++) {
    const x = scene.bounds.minX + rng() * scene.bounds.width;
    const y = scene.bounds.minY + rng() * scene.bounds.height;
    const t0 = now();
    const h = scene.index.hitTest(x, y, scene.seatRadius * 2);
    const t1 = now();
    hitTimes.push(t1 - t0);
    if (h.index >= 0) hits++;
  }
  hitTimes.sort((a, b) => a - b);
  const hitSum = hitTimes.reduce((a, b) => a + b, 0);

  console.log(`Hit-test (${HIT_SAMPLES} random probes, radius=${(scene.seatRadius * 2).toFixed(1)}):`);
  console.log(`  hits:          ${hits}/${HIT_SAMPLES}`);
  console.log(`  avg:           ${(hitSum / hitTimes.length).toFixed(4)} ms`);
  console.log(`  p50:           ${pct(hitTimes, 50).toFixed(4)} ms`);
  console.log(`  p95:           ${pct(hitTimes, 95).toFixed(4)} ms`);
  console.log(`  p99:           ${pct(hitTimes, 99).toFixed(4)} ms`);

  // --- Culling ---
  const cullTimes = [];
  const out = new Uint32Array(scene.seatCount);
  let visibleSum = 0;
  // Simulate a camera looking at ~8% of the venue each time.
  const viewW = scene.bounds.width * 0.28;
  const viewH = scene.bounds.height * 0.28;
  for (let i = 0; i < CULL_SAMPLES; i++) {
    const minX = scene.bounds.minX + rng() * (scene.bounds.width - viewW);
    const minY = scene.bounds.minY + rng() * (scene.bounds.height - viewH);
    const rect = { minX, minY, maxX: minX + viewW, maxY: minY + viewH };
    const t0 = now();
    const n = scene.index.cull(rect, out);
    const t1 = now();
    cullTimes.push(t1 - t0);
    visibleSum += n;
  }
  cullTimes.sort((a, b) => a - b);
  const cullSum = cullTimes.reduce((a, b) => a + b, 0);
  const avgVisible = visibleSum / CULL_SAMPLES;

  console.log(`Viewport cull (${CULL_SAMPLES} windows ≈28% of bounds):`);
  console.log(`  avgVisible:    ${Math.round(avgVisible).toLocaleString()} seats`);
  console.log(`  avg:           ${(cullSum / cullTimes.length).toFixed(4)} ms`);
  console.log(`  p50:           ${pct(cullTimes, 50).toFixed(4)} ms`);
  console.log(`  p95:           ${pct(cullTimes, 95).toFixed(4)} ms`);
  console.log(`  p99:           ${pct(cullTimes, 99).toFixed(4)} ms`);

  // --- Marquee query (full rect ≈ center 10%) ---
  const mq = {
    minX: scene.bounds.minX + scene.bounds.width * 0.45,
    minY: scene.bounds.minY + scene.bounds.height * 0.45,
    maxX: scene.bounds.minX + scene.bounds.width * 0.55,
    maxY: scene.bounds.minY + scene.bounds.height * 0.55,
  };
  const tMq0 = now();
  const mqN = scene.index.queryRect(mq, out);
  const tMq1 = now();
  console.log(`Marquee query (center 10%):`);
  console.log(`  seats:         ${mqN.toLocaleString()}`);
  console.log(`  time:          ${(tMq1 - tMq0).toFixed(4)} ms`);

  console.log('BENCH_RENDER_OK');
  console.log(
    JSON.stringify({
      seatCount: scene.seatCount,
      indexBuildMs: Number(scene.indexBuildMs.toFixed(3)),
      fullBuildMs: Number(buildMs.toFixed(3)),
      hitAvgMs: Number((hitSum / hitTimes.length).toFixed(5)),
      hitP95Ms: Number(pct(hitTimes, 95).toFixed(5)),
      cullAvgMs: Number((cullSum / cullTimes.length).toFixed(5)),
      cullP95Ms: Number(pct(cullTimes, 95).toFixed(5)),
      marqueeMs: Number((tMq1 - tMq0).toFixed(5)),
      marqueeSeats: mqN,
    }),
  );
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main();
