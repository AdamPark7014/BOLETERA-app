/**
 * Diagnóstico de importación CAD: el fallo debe decir QUÉ entidad y DÓNDE.
 */
const {
  previewDxfCadImport,
  previewSvgCadImport,
  getLastDxfImportReport,
  getLastSvgImportReport,
  CadImportError,
} = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function expectThrows(fn, label) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error(`${label}: se esperaba un error y no hubo`);
}

/** DXF ASCII mínimo a partir de pares código/valor. */
function dxf(entities) {
  const pairs = ['0', 'SECTION', '2', 'ENTITIES'];
  for (const e of entities) pairs.push(...e);
  pairs.push('0', 'ENDSEC', '0', 'EOF');
  return pairs.join('\n');
}

/* ── DXF sin geometría usable: debe nombrar los tipos encontrados ───────── */
{
  const text = dxf([
    ['0', 'SPLINE', '8', 'MUROS'],
    ['0', 'HATCH', '8', 'RELLENO'],
    ['0', 'INSERT', '8', 'BLOQUES'],
  ]);
  const err = expectThrows(() => previewDxfCadImport(text), 'DXF no soportado');
  assert(err instanceof CadImportError, 'debe lanzar CadImportError');
  assert(err.source === 'dxf', 'origen dxf');
  assert(/SPLINE/.test(err.message), `el mensaje debe nombrar SPLINE:\n${err.message}`);
  assert(/HATCH/.test(err.message), 'debe nombrar HATCH');
  assert(
    /tipo de entidad no soportado/.test(err.message),
    'debe explicar el motivo del descarte',
  );
  assert(
    /Explota bloques|polil[íi]neas/.test(err.message),
    'debe decir qué hacer en el CAD',
  );
  assert(/capa "MUROS"/.test(err.message), `debe indicar la capa:\n${err.message}`);
  assert(err.diagnostics.skippedCount === 3, 'tres entidades descartadas');
  console.log('--- DXF no soportado ---');
  console.log(err.message);
}

/* ── DXF con un arco inválido: debe señalar la entidad concreta ─────────── */
{
  const text = dxf([
    // Arco sin radio → descarte identificable.
    ['0', 'ARC', '8', 'CONTORNO', '10', '10', '20', '10', '50', '0', '51', '90'],
    // Línea válida, para que la importación no falle del todo.
    ['0', 'LINE', '8', 'PASILLO', '10', '0', '20', '0', '11', '100', '21', '100'],
  ]);
  const rows = previewDxfCadImport(text);
  assert(rows.length === 1, `debe importar la línea válida, importó ${rows.length}`);

  const report = getLastDxfImportReport();
  assert(report, 'debe haber informe del último preview');
  assert(report.accepted === 1, `aceptadas=${report.accepted}`);
  assert(report.skipped === 1, `descartadas=${report.skipped}`);
  const reason = report.bySkipReason[0];
  assert(reason.reason === 'invalid-arc', `motivo=${reason.reason}`);
  assert(/ARC #1/.test(reason.example), `debe señalar la entidad: ${reason.example}`);
  assert(/CONTORNO/.test(reason.example), `debe señalar la capa: ${reason.example}`);
  console.log('--- DXF parcial ---');
  console.log(`aceptadas=${report.accepted} descartadas=${report.skipped}`);
  console.log(`  ${reason.count}× ${reason.label} — ${reason.example}`);
}

/* ── DXF binario / sin ENTITIES: mensaje específico ─────────────────────── */
{
  const err = expectThrows(() => previewDxfCadImport('basura sin pares'), 'DXF ilegible');
  assert(/DXF ASCII|ENTITIES/.test(err.message), `debe sugerir exportar ASCII:\n${err.message}`);
  console.log('--- DXF ilegible ---');
  console.log(err.message);
}

/* ── SVG con path ilegible: debe nombrar el elemento y su id ────────────── */
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <path id="grada-norte" class="section" d="Zzz"/>
    <rect id="hueco" width="0" height="0"/>
  </svg>`;
  const err = expectThrows(() => previewSvgCadImport(svg), 'SVG ilegible');
  assert(err instanceof CadImportError, 'debe lanzar CadImportError');
  assert(err.source === 'svg', 'origen svg');
  assert(/grada-norte/.test(err.message), `debe nombrar el id del path:\n${err.message}`);
  assert(/path #1/.test(err.message), 'debe indicar la posición del elemento');
  assert(/atributo/.test(err.message), 'debe decir que el atributo es ilegible');
  console.log('--- SVG ilegible ---');
  console.log(err.message);
}

/* ── SVG parcialmente válido: importa lo bueno y reporta lo descartado ──── */
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <polygon id="platea" points="0,0 100,0 100,100 0,100"/>
    <circle id="ruido" cx="10" cy="10" r="2"/>
    <path id="roto" d=""/>
  </svg>`;
  const rows = previewSvgCadImport(svg);
  assert(rows.length === 1, `debe importar el polígono, importó ${rows.length}`);

  const report = getLastSvgImportReport();
  assert(report.accepted === 1, `aceptadas=${report.accepted}`);
  assert(report.skipped === 2, `descartadas=${report.skipped}`);
  const circleSkip = report.bySkipReason.find((r) => /ruido/.test(r.example));
  assert(circleSkip, 'debe reportar el círculo descartado');
  assert(
    /circle/.test(circleSkip.example),
    `debe identificar el círculo: ${circleSkip.example}`,
  );
  console.log('--- SVG parcial ---');
  console.log(`aceptadas=${report.accepted} descartadas=${report.skipped}`);
  for (const r of report.bySkipReason) console.log(`  ${r.count}× ${r.label} — ${r.example}`);
}

console.log('CAD_DIAGNOSTICS_SMOKE_OK');
