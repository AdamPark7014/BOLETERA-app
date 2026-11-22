#!/usr/bin/env node
/**
 * Eval del intérprete determinista (y opcionalmente del modelo si hay token).
 * Uso: node apps/api/src/modules/smart-search/eval/run.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const phrases = JSON.parse(readFileSync(join(__dirname, 'phrases.json'), 'utf8'));
const require = createRequire(import.meta.url);

// Compilar al vuelo no; importar el .ts vía ts-jest no aplica.
// Evaluamos con una copia mínima embebida llamando al dist si existe,
// o registrando ts-node/register si está.
let interpretQuery;
try {
  await import('ts-node/register/transpile-only');
  const mod = await import(pathToFileURL(join(__dirname, '../query-interpreter.ts')).href);
  interpretQuery = mod.interpretQuery;
} catch {
  // Fallback: usar jest programáticamente no; salir con pista
  console.error('Necesitas ts-node o corre: pnpm --filter @boletera/api exec jest query-interpreter.spec');
  process.exit(2);
}

const NOW = new Date('2026-11-26T21:00:00.000Z');

function weekdayOk(expect, filters) {
  if (!expect.weekday) return true;
  if (expect.weekday === 'hoy') return filters.dateFrom === '2026-11-26';
  if (expect.weekday === 'manana') return filters.dateFrom === '2026-11-27';
  if (expect.weekday === 'sabado') return filters.dateFrom === '2026-11-28';
  if (expect.weekday === 'domingo') return filters.dateFrom === '2026-11-29';
  if (expect.weekday === 'fin')
    return filters.dateFrom === '2026-11-28' && filters.dateTo === '2026-11-29';
  if (expect.weekday === 'proxima-semana')
    return filters.dateFrom === '2026-11-30' && filters.dateTo === '2026-12-06';
  if (expect.weekday === 'diciembre')
    return filters.dateFrom === '2026-12-01' && filters.dateTo === '2026-12-31';
  return true;
}

function scoreCase(expect, filters) {
  const keys = Object.keys(expect).filter((k) => k !== 'weekday');
  let ok = 0;
  let total = keys.length + (expect.weekday ? 1 : 0);
  if (total === 0) return { ok: 1, total: 1 };
  for (const k of keys) {
    if (filters[k] === expect[k]) ok++;
  }
  if (expect.weekday) {
    if (weekdayOk(expect, filters)) ok++;
  }
  return { ok, total };
}

let hit = 0;
let total = 0;
const rows = [];
for (const p of phrases) {
  const r = interpretQuery(p.q, NOW);
  const s = scoreCase(p.expect, r.filters);
  hit += s.ok;
  total += s.total;
  const pass = s.ok === s.total;
  rows.push({ q: p.q, pass, got: r.filters, chips: r.chips });
}

const pct = total ? Math.round((100 * hit) / total) : 0;
console.log(`Determinista: ${hit}/${total} campos (${pct}%)`);
for (const row of rows.filter((r) => !r.pass)) {
  console.log('FALLO', row.q, JSON.stringify(row.got));
}

if (process.env.ANTHROPIC_API_KEY) {
  console.log('Token presente: eval de modelo no automatizado aquí (usar POST /smart-search).');
} else {
  console.log('Sin ANTHROPIC_API_KEY: solo capa determinista.');
}

process.exit(pct >= 80 ? 0 : 1);
