/**
 * Validación de integridad de inventario y accesibilidad con mensajes accionables.
 */
const {
  resolveGeometry,
  validateGeometry,
  generateBlock,
  generateAccessibleSpaces,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function find(issues, code) {
  return issues.filter((i) => i.code === code);
}

function baseSection(id, overrides = {}) {
  return {
    id,
    name: `Zona ${id}`,
    slug: id,
    color: '#5b9fd4',
    seatPitch: 26,
    rowPitch: 28,
    seats: generateBlock({
      id: `blk-${id}`,
      origin: { x: 200, y: 200 },
      rows: 3,
      seatsPerRow: 6,
      seatPitch: 26,
      rowPitch: 28,
      idPrefix: id,
    }),
    ...overrides,
  };
}

/* ── Todo correcto: sin errores de integridad ───────────────────────────── */
{
  const map = { version: 3, sections: [baseSection('a')], venue: { units: 'map', scale: 40 } };
  const v = validateGeometry(resolveGeometry(map), { skipAccessibility: true });
  const integrity = v.issues.filter((i) =>
    ['duplicate_seat_id', 'duplicate_seat_label', 'missing_row_label', 'empty_section'].includes(
      i.code,
    ),
  );
  assert(integrity.length === 0, `mapa limpio no debe tener avisos: ${JSON.stringify(integrity)}`);
  assert(Array.isArray(v.summary), 'debe devolver resumen por código');
}

/* ── Ids de butaca duplicados ───────────────────────────────────────────── */
{
  const sec = baseSection('a');
  sec.seats[1] = { ...sec.seats[1], id: sec.seats[0].id };
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [sec] }), {
    skipAccessibility: true,
  });
  const dup = find(v.issues, 'duplicate_seat_id');
  assert(dup.length === 1, 'debe detectar el id duplicado');
  assert(dup[0].severity === 'error', 'un id duplicado es error, no aviso');
  assert(dup[0].hint && dup[0].hint.includes('upsert'), 'el aviso debe explicar la consecuencia');
  assert(!v.ok, 'con ids duplicados el mapa no es guardable');
  console.log('id duplicado:', dup[0].message);
}

/* ── Etiquetas duplicadas en la misma zona ──────────────────────────────── */
{
  const sec = baseSection('a');
  sec.seats[2] = { ...sec.seats[2], label: sec.seats[0].label };
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [sec] }), {
    skipAccessibility: true,
  });
  const dup = find(v.issues, 'duplicate_seat_label');
  assert(dup.length === 1, 'debe detectar la etiqueta duplicada');
  assert(dup[0].severity === 'error', 'dos butacas con la misma etiqueta es error');
  console.log('etiqueta duplicada:', dup[0].message);
}

/* ── Butacas sin fila ───────────────────────────────────────────────────── */
{
  const sec = baseSection('a');
  sec.seats = sec.seats.map((s, i) => (i < 4 ? { ...s, row: undefined } : s));
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [sec] }), {
    skipAccessibility: true,
  });
  const missing = find(v.issues, 'missing_row_label');
  assert(missing.length === 1, 'se agrupa por zona, no un aviso por butaca');
  assert(missing[0].count === 4, `debe contar 4 butacas, contó ${missing[0].count}`);
  console.log('sin fila:', missing[0].message);
}

/* ── Zona vacía ─────────────────────────────────────────────────────────── */
{
  const empty = { ...baseSection('vacia'), seats: [] };
  const v = validateGeometry(
    resolveGeometry({ version: 3, sections: [baseSection('a'), empty] }),
    { skipAccessibility: true },
  );
  const issues = find(v.issues, 'empty_section');
  assert(issues.length === 1, 'debe avisar de la zona sin butacas');
  assert(issues[0].severity === 'error', 'una zona numerada sin butacas es error');
  console.log('zona vacía:', issues[0].message);

  // Pero una zona GA (con contorno) sin butacas es legítima: solo aviso.
  const ga = { ...empty, shape: { points: [[0, 0], [100, 0], [100, 100], [0, 100]] } };
  const v2 = validateGeometry(resolveGeometry({ version: 3, sections: [baseSection('a'), ga] }), {
    skipAccessibility: true,
  });
  const gaIssue = find(v2.issues, 'empty_section')[0];
  assert(gaIssue.severity === 'warning', 'una zona GA sin butacas es aviso, no error');
  console.log('zona GA:', gaIssue.message);
}

/* ── Zonas con slug repetido ────────────────────────────────────────────── */
{
  const a = baseSection('a');
  const b = { ...baseSection('b'), slug: 'a' };
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [a, b] }), {
    skipAccessibility: true,
  });
  const dup = find(v.issues, 'duplicate_section');
  assert(dup.length >= 1, 'debe detectar el slug repetido');
  assert(dup[0].severity === 'error', 'slug repetido es error');
  console.log('slug repetido:', dup[0].message);
}

/* ── Aforo declarado que no cuadra ──────────────────────────────────────── */
{
  const map = { version: 3, sections: [baseSection('a')] };
  const actual = map.sections[0].seats.length;

  const over = validateGeometry(resolveGeometry(map), {
    declaredCapacity: actual + 50,
    skipAccessibility: true,
  });
  const mismatch = find(over.issues, 'capacity_mismatch');
  assert(mismatch.length === 1, 'debe avisar del descuadre');
  assert(mismatch[0].severity === 'error', 'un aforo que no cuadra bloquea la publicación');
  assert(mismatch[0].message.includes('faltan'), 'debe decir que faltan butacas');
  console.log('aforo:', mismatch[0].message);

  const exact = validateGeometry(resolveGeometry(map), {
    declaredCapacity: actual,
    skipAccessibility: true,
  });
  assert(find(exact.issues, 'capacity_mismatch').length === 0, 'aforo exacto no debe avisar');
}

/* ── Accesibilidad ──────────────────────────────────────────────────────── */
{
  // Sin plazas accesibles: debe reclamarlas.
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [baseSection('a')] }));
  const shortfall = find(v.issues, 'accessible_shortfall');
  assert(shortfall.length === 1, 'debe reclamar plazas accesibles');
  assert(shortfall[0].hint.includes('legal'), 'el aviso debe dejar claro que es obligatorio');
  console.log('accesibilidad:', shortfall[0].message);

  // Con plazas y acompañantes ligados: sin avisos de vínculo.
  const { section } = generateAccessibleSpaces(baseSection('a'), {
    count: 1,
    companionsPerSpace: 1,
  });
  const v2 = validateGeometry(resolveGeometry({ version: 3, sections: [section] }));
  assert(
    find(v2.issues, 'accessible_no_companion').length === 0,
    'una plaza con acompañante no debe avisar',
  );
  assert(
    find(v2.issues, 'accessible_orphan_companion').length === 0,
    'no debe haber acompañantes huérfanos',
  );

  // Acompañante que apunta a una plaza inexistente.
  const orphaned = {
    ...section,
    seats: section.seats.map((s) =>
      s.metadata?.accessibleKind === 'companion'
        ? { ...s, metadata: { ...s.metadata, companionOf: 'no-existe' } }
        : s,
    ),
  };
  const v3 = validateGeometry(resolveGeometry({ version: 3, sections: [orphaned] }));
  assert(
    find(v3.issues, 'accessible_orphan_companion').length === 1,
    'debe detectar el acompañante huérfano',
  );
  console.log('huérfano:', find(v3.issues, 'accessible_orphan_companion')[0].message);
}

/* ── Saltos de numeración ───────────────────────────────────────────────── */
{
  // Un hueco real en medio de la fila.
  const sec = baseSection('a');
  sec.seats = sec.seats.filter((s) => s.label !== 'A-3');
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [sec] }), {
    skipAccessibility: true,
  });
  const gaps = find(v.issues, 'row_numbering_gap');
  assert(gaps.length === 1, 'debe detectar el hueco');
  assert(gaps[0].message.includes('3'), 'debe decir qué número falta');
  console.log('hueco:', gaps[0].message);

  // Pares e impares no son huecos: no debe avisar.
  const parity = {
    ...baseSection('p'),
    seats: generateBlock({
      id: 'blk-p',
      origin: { x: 800, y: 200 },
      rows: 2,
      seatsPerRow: 8,
      seatPitch: 26,
      rowPitch: 28,
      idPrefix: 'p',
      numbering: { seatScheme: 'odd-even-from-center' },
    }),
  };
  const v2 = validateGeometry(resolveGeometry({ version: 3, sections: [parity] }), {
    skipAccessibility: true,
  });
  assert(
    find(v2.issues, 'row_numbering_gap').length === 0,
    'la convención de pares/impares no debe reportarse como hueco',
  );
}

/* ── Todos los avisos llevan mensaje accionable ─────────────────────────── */
{
  const sec = baseSection('a');
  sec.seats[1] = { ...sec.seats[1], id: sec.seats[0].id };
  const v = validateGeometry(resolveGeometry({ version: 3, sections: [sec] }), {
    declaredCapacity: 999,
  });
  const inventoryCodes = [
    'duplicate_seat_id',
    'duplicate_seat_label',
    'missing_row_label',
    'empty_section',
    'duplicate_section',
    'capacity_mismatch',
    'row_numbering_gap',
    'accessible_shortfall',
    'accessible_no_companion',
    'accessible_orphan_companion',
    'overlap',
    'missing_position',
  ];
  for (const issue of v.issues) {
    if (!inventoryCodes.includes(issue.code)) continue;
    assert(issue.message && issue.message.length > 10, `mensaje pobre en ${issue.code}`);
    assert(issue.hint && issue.hint.length > 10, `falta pista accionable en ${issue.code}`);
  }
  assert(v.summary.length > 0, 'el resumen debe agrupar por código');
  assert(v.summary[0].severity === 'error', 'los errores deben ir primero en el resumen');
  console.log('resumen:', v.summary.map((s) => `${s.code}=${s.count}`).join(' '));
}

console.log('VALIDATE_INVENTORY_SMOKE_OK');
