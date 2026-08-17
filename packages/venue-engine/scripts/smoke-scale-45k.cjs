/**
 * Escala real: índice espacial, consultas y edición masiva sobre 45.000 butacas.
 * Mide lo que el editor hace en caliente para poder comparar antes/después.
 */
const {
  buildSeatIndex,
  querySeatsInRect,
  hitTestSeat,
  buildClusters,
  lodModeFor,
  applySeatProps,
  restoreSeatProps,
  applySeatMove,
  pushCommand,
  undo,
  redo,
  EMPTY_HISTORY,
  countSeats,
  estimateMapBytes,
  formatBytes,
  generateBlock,
  generateStadiumTemplate,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ms(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const t1 = process.hrtime.bigint();
  return [Number(t1 - t0) / 1e6, out];
}

/** Recinto sintético de 45.000 butacas repartidas en 30 secciones. */
function buildLargeVenue(target = 45000) {
  const sectionCount = 30;
  const perSection = Math.ceil(target / sectionCount);
  const cols = 50;
  const rows = Math.ceil(perSection / cols);
  const sections = [];

  for (let s = 0; s < sectionCount; s++) {
    const ring = Math.floor(s / 10);
    const idx = s % 10;
    const seats = generateBlock({
      id: `sec-${s}`,
      origin: { x: 200 + idx * (cols * 26 + 60), y: 200 + ring * (rows * 28 + 80) },
      rows,
      seatsPerRow: cols,
      seatPitch: 26,
      rowPitch: 28,
      rake: 8,
      yaw: 0,
      elevation: ring * 200,
      startRowLabel: 'A',
      idPrefix: `s${s}`,
    });
    sections.push({
      id: `sec-${s}`,
      name: `Sección ${s + 1}`,
      slug: `sec-${s}`,
      color: ['#5b9fd4', '#c45c6a', '#c4a35a', '#5a9e78'][s % 4],
      seatPitch: 26,
      rowPitch: 28,
      seats: seats.slice(0, perSection),
    });
  }
  return { version: 3, sections, venue: { units: 'map', scale: 40 } };
}

const map = buildLargeVenue(45000);
const total = countSeats(map);
console.log(`Recinto sintético: ${total} butacas en ${map.sections.length} secciones`);
console.log(`Peso estimado del documento: ${formatBytes(estimateMapBytes(map))}`);
assert(total >= 44000, `esperaba ~45k butacas, hay ${total}`);

/* ── Índice espacial ─────────────────────────────────────────────────────── */
const [tIndex, index] = ms(() => buildSeatIndex(map));
console.log(`buildSeatIndex: ${tIndex.toFixed(1)} ms`);
assert(index.count === total, `índice ${index.count} != ${total}`);
assert(index.sections.length === map.sections.length, 'secciones');
assert(tIndex < 500, `construir el índice tardó demasiado: ${tIndex} ms`);

/* ── Selección por rectángulo ────────────────────────────────────────────── */
const b = index.bounds;
const midX = (b.minX + b.maxX) / 2;
const midY = (b.minY + b.maxY) / 2;

const scratch = [];
const [tRectSmall] = ms(() => querySeatsInRect(index, midX - 300, midY - 300, midX + 300, midY + 300, scratch));
console.log(`querySeatsInRect (ventana chica): ${tRectSmall.toFixed(2)} ms → ${scratch.length} butacas`);
assert(tRectSmall < 20, `consulta por rectángulo lenta: ${tRectSmall} ms`);

const [tRectAll, allHit] = ms(() => querySeatsInRect(index, b.minX, b.minY, b.maxX, b.maxY, []));
console.log(`querySeatsInRect (todo el recinto): ${tRectAll.toFixed(1)} ms → ${allHit.length} butacas`);
assert(allHit.length === total, `selección total ${allHit.length} != ${total}`);

// Comparación honesta: el barrido lineal que hacía el editor antes.
const [tLinear, linearHit] = ms(() => {
  const out = [];
  for (const sec of map.sections) {
    for (const s of sec.seats) {
      if (s.x >= midX - 300 && s.x <= midX + 300 && s.y >= midY - 300 && s.y <= midY + 300) {
        out.push(s.id);
      }
    }
  }
  return out;
});
console.log(`  (barrido lineal equivalente: ${tLinear.toFixed(2)} ms → ${linearHit.length})`);
assert(linearHit.length === scratch.length, 'la rejilla y el barrido deben coincidir');

/* ── Impacto de clic ─────────────────────────────────────────────────────── */
const probeI = Math.floor(index.count / 3);
const [tHit, hit] = ms(() => hitTestSeat(index, index.x[probeI], index.y[probeI], 14));
console.log(`hitTestSeat: ${tHit.toFixed(3)} ms → idx ${hit}`);
assert(hit === probeI, `impacto esperado ${probeI}, obtenido ${hit}`);
assert(tHit < 2, `impacto lento: ${tHit} ms`);

const miss = hitTestSeat(index, b.maxX + 5000, b.maxY + 5000, 14);
assert(miss === -1, 'fuera del recinto debe devolver -1');

/* ── Nivel de detalle ────────────────────────────────────────────────────── */
assert(lodModeFor(0.1) === 'sections', 'zoom lejano → secciones');
assert(lodModeFor(0.35) === 'clusters', 'zoom medio → clusters');
assert(lodModeFor(1.2) === 'seats', 'zoom cercano → butacas');

const [tClusters, clusters] = ms(() =>
  buildClusters(index, b.minX, b.minY, b.maxX, b.maxY, 120),
);
const clustered = clusters.reduce((n, c) => n + c.count, 0);
console.log(`buildClusters: ${tClusters.toFixed(1)} ms → ${clusters.length} celdas (${clustered} butacas)`);
assert(clustered === total, `los clusters deben cubrir todas las butacas: ${clustered} != ${total}`);
assert(clusters.length < total / 10, 'los clusters deben reducir mucho el número de dibujos');
console.log(`  reducción de dibujos: ${(total / clusters.length).toFixed(1)}×`);

/* ── Edición masiva + deshacer ───────────────────────────────────────────── */
const everySeatId = new Set(index.ids);
const [tBulk, bulk] = ms(() => applySeatProps(map, everySeatId, { tier: 'premium' }));
console.log(`applySeatProps sobre ${everySeatId.size} butacas: ${tBulk.toFixed(1)} ms`);
assert(tBulk < 800, `edición masiva lenta: ${tBulk} ms`);
assert(bulk.before.length === total, 'debe registrar el estado previo de cada butaca');
assert(bulk.map.sections[0].seats[0].tier === 'premium', 'la tarifa debe aplicarse');

const [tUndo, restored] = ms(() => restoreSeatProps(bulk.map, bulk.before));
console.log(`restoreSeatProps (deshacer): ${tUndo.toFixed(1)} ms`);
assert(
  restored.sections[0].seats[0].tier === map.sections[0].seats[0].tier,
  'deshacer debe devolver la tarifa original',
);

// Reutilización por referencia: una edición parcial no debe tocar otras secciones.
const partial = applySeatProps(map, new Set([index.ids[0]]), { tier: 'economy' });
assert(partial.map.sections[1] === map.sections[1], 'las secciones intactas deben conservar identidad');
assert(partial.map.sections[0] !== map.sections[0], 'la sección editada debe ser nueva');
console.log('structural sharing: secciones no tocadas conservan identidad ✓');

/* ── Pila de comandos ────────────────────────────────────────────────────── */
let hist = EMPTY_HISTORY;
let working = map;

const move = applySeatMove(working, new Set([index.ids[0], index.ids[1]]), 10, 20);
hist = pushCommand(hist, {
  kind: 'seat-move',
  label: 'Mover 2 butacas',
  before: [
    { id: index.ids[0], x: index.x[0], y: index.y[0] },
    { id: index.ids[1], x: index.x[1], y: index.y[1] },
  ],
  dx: 10,
  dy: 20,
});
working = move;
assert(working.sections[0].seats[0].x === Math.round(index.x[0] + 10), 'el movimiento debe aplicarse');

const undone = undo(working, hist);
assert(undone.map.sections[0].seats[0].x === index.x[0], 'deshacer debe restaurar la posición');
const redone = redo(undone.map, undone.history);
assert(
  redone.map.sections[0].seats[0].x === Math.round(index.x[0] + 10),
  'rehacer debe reaplicar el movimiento',
);
console.log('deshacer/rehacer sobre comandos ✓');

/* ── Los generadores actuales no llegan a escala real ────────────────────── */
const stadium = generateStadiumTemplate({ capacity: 45000 });
const stadiumSeats = countSeats(stadium);
console.log(`generateStadiumTemplate({capacity:45000}) produce ${stadiumSeats} butacas`);

console.log('SCALE_45K_SMOKE_OK');
