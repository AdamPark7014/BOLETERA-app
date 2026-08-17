/**
 * Convenciones de numeración, accesibilidad y escalado real de plantillas.
 */
const {
  rowLabelAt,
  rowLabelsFor,
  seatNumberAt,
  numberRow,
  previewConvention,
  generateBlock,
  generateStadiumTemplate,
  generateArenaTemplate,
  auditAccessibility,
  requiredWheelchairSpaces,
  generateAccessibleSpaces,
  ensureAccessibleSpaces,
  isWheelchairSpace,
  isCompanionSeat,
  companionOf,
  countSeats,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg}\n  esperado: ${B}\n  obtenido: ${A}`);
}

/* ── Etiquetas de fila ───────────────────────────────────────────────────── */

// Por defecto se omiten I y O (se confunden con 1 y 0).
const def = rowLabelsFor(16);
eq(
  def,
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R'],
  'latin-no-ambiguous debe saltar I y O',
);
assert(!def.includes('I') && !def.includes('O'), 'no debe haber I ni O');

// Latin completo sí las incluye.
const full = rowLabelsFor(16, { rowScheme: 'latin' });
assert(full[8] === 'I' && full[14] === 'O', 'latin debe conservar I y O');

// Más de 26 filas: bijectivo, nunca caracteres basura como "[" o "\".
const long = rowLabelsFor(30, { rowScheme: 'latin' });
eq(long.slice(25, 30), ['Z', 'AA', 'AB', 'AC', 'AD'], 'tras la Z debe venir AA');
assert(
  long.every((l) => /^[A-Z]+$/.test(l)),
  `etiquetas inválidas: ${long.filter((l) => !/^[A-Z]+$/.test(l))}`,
);

// El bug original: String.fromCharCode(65 + index) a partir de 26.
assert(String.fromCharCode(65 + 26) === '[', 'referencia del bug antiguo');
assert(long[26] === 'AA', 'la implementación nueva no debe emitir "["');

// Numéricas, dobladas, invertidas y con prefijo.
eq(rowLabelsFor(3, { rowScheme: 'numeric' }), ['1', '2', '3'], 'numeric');
eq(rowLabelsFor(3, { rowScheme: 'doubled' }), ['A', 'B', 'C'], 'doubled primer ciclo');
eq(rowLabelAt(26, { rowScheme: 'doubled' }), 'AA', 'doubled segundo ciclo');
eq(rowLabelsFor(3, { rowScheme: 'latin-reverse' }, 3), ['C', 'B', 'A'], 'latin-reverse');
eq(rowLabelsFor(2, { rowScheme: 'numeric', rowPrefix: 'F' }), ['F1', 'F2'], 'prefijo');
eq(rowLabelsFor(3, { startRowLabel: 'C' }), ['C', 'D', 'E'], 'fila inicial C');
eq(
  rowLabelsFor(4, { rowScheme: 'latin-no-ambiguous-q' }).slice(0, 4),
  ['A', 'B', 'C', 'D'],
  'sin Q',
);
console.log('filas:', def.join(' '));

/* ── Numeración de butacas ───────────────────────────────────────────────── */

const seq = numberRow(6, 'A').map((n) => n.number);
eq(seq, [1, 2, 3, 4, 5, 6], 'secuencial');

const rtl = numberRow(6, 'A', { seatScheme: 'sequential-rtl' }).map((n) => n.number);
eq(rtl, [6, 5, 4, 3, 2, 1], 'secuencial derecha a izquierda');

// Pares e impares desde el centro (convención española / latinoamericana).
const parImpar = numberRow(10, 'A', { seatScheme: 'odd-even-from-center' }).map((n) => n.number);
eq(parImpar, [10, 8, 6, 4, 2, 1, 3, 5, 7, 9], 'pares a la izquierda, impares a la derecha');

const imparPar = numberRow(10, 'A', { seatScheme: 'even-odd-from-center' }).map((n) => n.number);
eq(imparPar, [9, 7, 5, 3, 1, 2, 4, 6, 8, 10], 'impares a la izquierda, pares a la derecha');

// Fila impar: la butaca del eje cae en el grupo izquierdo.
const odd9 = numberRow(9, 'A', { seatScheme: 'odd-even-from-center' }).map((n) => n.number);
eq(odd9, [10, 8, 6, 4, 2, 1, 3, 5, 7], 'fila de 9 con eje a la izquierda');

// Desde el centro con sufijo de sector.
const fromCenter = numberRow(6, 'A', {
  seatScheme: 'from-center',
  sideSuffix: { left: 'I', right: 'D' },
}).map((n) => n.label);
eq(
  fromCenter,
  ['A-3I', 'A-2I', 'A-1I', 'A-1D', 'A-2D', 'A-3D'],
  'desde el centro con sufijo izquierda/derecha',
);

// Serpentina y continua.
const serpA = numberRow(4, 'A', { serpentine: true }, 0).map((n) => n.number);
const serpB = numberRow(4, 'B', { serpentine: true }, 1).map((n) => n.number);
eq(serpA, [1, 2, 3, 4], 'serpentina fila par');
eq(serpB, [4, 3, 2, 1], 'serpentina fila impar');

const contB = numberRow(4, 'B', { seatScheme: 'continuous' }, 1, 4).map((n) => n.number);
eq(contB, [5, 6, 7, 8], 'numeración continua entre filas');

// Relleno con ceros y separador.
const padded = numberRow(2, 'A', { padSeatNumberTo: 3, labelSeparator: '' }).map((n) => n.label);
eq(padded, ['A001', 'A002'], 'relleno con ceros');

// Desplazamiento del número inicial.
eq(seatNumberAt(0, 4, 'A', { startSeatNumber: 101 }).number, 101, 'primer número configurable');

/* ── Detección de duplicados ─────────────────────────────────────────────── */

const okPreview = previewConvention(3, 8, { seatScheme: 'odd-even-from-center' });
assert(okPreview.ok, `no debería haber duplicados: ${okPreview.duplicates}`);

// `from-center` sin sufijo produce dos butacas "1" por fila: debe detectarse.
const dupPreview = previewConvention(2, 6, { seatScheme: 'from-center' });
assert(!dupPreview.ok, 'from-center sin sufijo debe reportar duplicados');
assert(dupPreview.duplicates.length > 0, 'debe listar las etiquetas duplicadas');
console.log('duplicados detectados sin sufijo:', dupPreview.duplicates.slice(0, 4).join(', '));

const fixedPreview = previewConvention(2, 6, {
  seatScheme: 'from-center',
  sideSuffix: { left: 'I', right: 'D' },
});
assert(fixedPreview.ok, 'con sufijo de sector no debe haber duplicados');

/* ── Los pasillos no consumen número ─────────────────────────────────────── */

const withAisle = generateBlock({
  id: 'b',
  origin: { x: 0, y: 0 },
  rows: 1,
  seatsPerRow: 8,
  seatPitch: 26,
  rowPitch: 28,
  skipColumns: [3, 4],
});
eq(
  withAisle.map((s) => s.label),
  ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'],
  'las columnas saltadas son pasillo y no consumen número',
);
assert(withAisle.length === 6, 'deben quedar 6 butacas');

// Y con convención de pares e impares el pasillo central sigue funcionando.
const parImparAisle = generateBlock({
  id: 'b2',
  origin: { x: 0, y: 0 },
  rows: 2,
  seatsPerRow: 12,
  seatPitch: 26,
  rowPitch: 28,
  skipColumns: [5, 6],
  numbering: { seatScheme: 'odd-even-from-center' },
});
const firstRow = parImparAisle.filter((s) => s.row === 'A').map((s) => s.label);
eq(
  firstRow,
  ['A-10', 'A-8', 'A-6', 'A-4', 'A-2', 'A-1', 'A-3', 'A-5', 'A-7', 'A-9'],
  'pares e impares con pasillo central',
);
assert(parImparAisle[10].row === 'B', 'la segunda fila debe etiquetarse B');

// Las filas del bloque no deben repetir etiqueta ni salirse del alfabeto.
const tallBlock = generateBlock({
  id: 'tall',
  origin: { x: 0, y: 0 },
  rows: 30,
  seatsPerRow: 3,
  seatPitch: 26,
  rowPitch: 28,
});
const rowLabels = [...new Set(tallBlock.map((s) => s.row))];
assert(rowLabels.length === 30, `esperaba 30 filas distintas, hay ${rowLabels.length}`);
assert(
  rowLabels.every((l) => /^[A-Z]+$/.test(l)),
  `filas con caracteres inválidos: ${rowLabels.filter((l) => !/^[A-Z]+$/.test(l))}`,
);
const allIds = tallBlock.map((s) => s.id);
assert(new Set(allIds).size === allIds.length, 'los ids de butaca deben ser únicos');

/* ── Accesibilidad ───────────────────────────────────────────────────────── */

eq(requiredWheelchairSpaces(0), 0, 'aforo cero');
eq(requiredWheelchairSpaces(20), 1, 'hasta 25 → 1');
eq(requiredWheelchairSpaces(50), 2, 'hasta 50 → 2');
eq(requiredWheelchairSpaces(100), 4, 'hasta 100 → 4');
eq(requiredWheelchairSpaces(45000), 450, '1% por encima de 500');

const section = {
  id: 'sec-a',
  name: 'Platea',
  slug: 'platea',
  color: '#888',
  seats: generateBlock({
    id: 'blk',
    origin: { x: 0, y: 0 },
    rows: 5,
    seatsPerRow: 12,
    seatPitch: 26,
    rowPitch: 28,
  }),
};

const { section: accessible, created } = generateAccessibleSpaces(section, {
  count: 3,
  companionsPerSpace: 1,
});
assert(created.wheelchair.length === 3, `esperaba 3 plazas, hay ${created.wheelchair.length}`);
assert(created.companions.length === 3, 'una butaca de acompañante por plaza');
assert(
  accessible.seats.length === section.seats.length,
  'no debe inventar butacas nuevas: el aforo declarado no cambia',
);

const wheelchairs = accessible.seats.filter(isWheelchairSpace);
const companions = accessible.seats.filter(isCompanionSeat);
assert(wheelchairs.length === 3, 'tres espacios de silla de ruedas');
assert(companions.length === 3, 'tres acompañantes');
for (const c of companions) {
  const target = companionOf(c);
  assert(
    wheelchairs.some((w) => w.id === target),
    `el acompañante ${c.id} apunta a una plaza inexistente (${target})`,
  );
}

const audit = auditAccessibility({ version: 3, sections: [accessible] });
assert(audit.wheelchairSpaces === 3, 'auditoría: plazas');
assert(audit.wheelchairWithoutCompanion.length === 0, 'ninguna plaza sin acompañante');
assert(audit.orphanCompanions.length === 0, 'ningún acompañante huérfano');
console.log(
  `accesibilidad: ${audit.wheelchairSpaces} plazas / ${audit.requiredWheelchairSpaces} exigidas, cumple=${audit.compliant}`,
);

// Sección sin plazas accesibles debe reportarse.
const bare = auditAccessibility({ version: 3, sections: [section] });
assert(bare.sectionsWithoutAccessible.length === 1, 'debe señalar la sección sin accesibles');
assert(!bare.compliant, 'sin plazas no puede cumplir');

// Reparto proporcional sobre el mapa completo.
const spread = ensureAccessibleSpaces({ version: 3, sections: [section] }, { count: 4 });
const spreadAudit = auditAccessibility(spread);
assert(spreadAudit.wheelchairSpaces >= 3, `reparto proporcional: ${spreadAudit.wheelchairSpaces}`);

/* ── Las plantillas deben llegar al aforo pedido ─────────────────────────── */

const stadium = generateStadiumTemplate({ capacity: 45000 });
const stadiumSeats = countSeats(stadium);
console.log(`estadio 45.000 → ${stadiumSeats} butacas en ${stadium.sections.length} secciones`);
assert(
  stadiumSeats >= 40000,
  `el estadio debe acercarse al aforo pedido, produjo ${stadiumSeats}`,
);

const arena = generateArenaTemplate({ capacity: 20000 });
const arenaSeats = countSeats(arena);
console.log(`arena 20.000 → ${arenaSeats} butacas en ${arena.sections.length} secciones`);
assert(arenaSeats >= 16000, `la arena debe acercarse al aforo pedido, produjo ${arenaSeats}`);

// Ids de sección únicos aunque se superen los colores de la paleta.
const slugs = arena.sections.map((s) => s.id);
assert(new Set(slugs).size === slugs.length, 'los ids de sección deben ser únicos');

// Y los ids de butaca únicos en todo el recinto.
const stadiumIds = stadium.sections.flatMap((s) => s.seats.map((x) => x.id));
assert(
  new Set(stadiumIds).size === stadiumIds.length,
  `ids de butaca duplicados: ${stadiumIds.length - new Set(stadiumIds).size}`,
);

console.log('NUMBERING_SMOKE_OK');
