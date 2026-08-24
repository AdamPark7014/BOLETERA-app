#!/usr/bin/env node
/**
 * Homologa literales hex en SCSS/CSS hacia tokens `var(--bl-*)`.
 *
 * Por diseño solo toca hojas de estilo: en TS/TSX los arrays de gráficas
 * no aceptan var() y deben quedarse con literales o constantes JS.
 *
 * Uso:
 *   node scripts/homologar-color.mjs           # dry-run (informe)
 *   node scripts/homologar-color.mjs --apply     # escribe cambios en SCSS/CSS
 *   node scripts/homologar-color.mjs --apply apps/web
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const scopeArg = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[1]);

/** Mapeo hex (minúsculas) → token semántico. Derivado de `_variables.scss`. */
const HEX_A_TOKEN = new Map(
  Object.entries({
    '#fcfcfd': 'var(--bl-gray-25)',
    '#f8f9fb': 'var(--bl-gray-50)',
    '#f1f2f6': 'var(--bl-gray-100)',
    '#e9ebf1': 'var(--bl-gray-150)',
    '#e0e3ea': 'var(--bl-gray-200)',
    '#cbd0db': 'var(--bl-gray-300)',
    '#9ba3b4': 'var(--bl-gray-400)',
    '#6a7281': 'var(--bl-gray-500)',
    '#545c6b': 'var(--bl-gray-600)',
    '#3d4451': 'var(--bl-gray-700)',
    '#272c36': 'var(--bl-gray-800)',
    '#1b1f27': 'var(--bl-gray-850)',
    '#14171d': 'var(--bl-gray-900)',
    '#0b0d11': 'var(--bl-gray-950)',
    '#0a0a0a': 'var(--bl-gray-950)',
    '#0c0c0e': 'var(--bl-gray-950)',
    '#141414': 'var(--bl-gray-900)',
    '#1a1a1d': 'var(--bl-gray-850)',
    '#1f1f1f': 'var(--bl-gray-800)',
    '#333333': 'var(--bl-gray-700)',
    '#ffffff': 'var(--bl-gray-0)',
    '#fff1f3': 'var(--bl-accent-subtle)',
    '#e11d48': 'var(--bl-accent)',
    '#be123c': 'var(--bl-accent-hover)',
    '#9f1239': 'var(--bl-accent-active)',
    '#2563eb': 'var(--bl-info)',
    '#1d4ed8': 'var(--bl-info-text)',
    '#3b82f6': 'var(--bl-focus-ring)',
    '#10b981': 'var(--bl-success)',
    '#059669': 'var(--bl-success-text)',
    '#ef4444': 'var(--bl-danger)',
    '#dc2626': 'var(--bl-danger-hover)',
    '#f59e0b': 'var(--bl-warning)',
  }).map(([k, v]) => [k.toLowerCase(), v]),
);

const DEFINEN_PALETA = /_variables\.scss$|[/\\]theme\.scss$/;

const listar = (patron) =>
  execSync(`git -C "${raiz}" ls-files ${patron}`, { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
      walk(abs, acc);
    } else if (/\.(scss|css)$/i.test(name)) {
      acc.push(abs);
    }
  }
  return acc;
}

const desdeGit = [
  ...listar('"apps/**/*.scss" "apps/**/*.css"'),
  ...listar('"packages/ui/src/**/*.scss"'),
];

const desdeDisco = [
  ...walk(resolve(raiz, 'apps')),
  ...walk(resolve(raiz, 'packages/ui/src')),
].map((abs) => abs.replace(/\\/g, '/').replace(`${raiz.replace(/\\/g, '/')}/`, ''));

let archivos = [...new Set([...desdeGit, ...desdeDisco])].filter((f) => !DEFINEN_PALETA.test(f));

if (scopeArg) {
  archivos = archivos.filter((f) => f.startsWith(scopeArg.replace(/\\/g, '/')));
}

let reemplazos = 0;
let archivosTocados = 0;
const pendientes = [];

for (const rel of archivos) {
  const abs = resolve(raiz, rel);
  const original = readFileSync(abs, 'utf8');
  let next = original;
  let local = 0;

  next = next.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => {
    const token = HEX_A_TOKEN.get(hex.toLowerCase());
    if (!token) {
      pendientes.push({ file: rel, hex });
      return hex;
    }
    local += 1;
    return token;
  });

  if (local > 0) {
    reemplazos += local;
    archivosTocados += 1;
    if (APPLY) writeFileSync(abs, next, 'utf8');
  }
}

console.log(
  APPLY
    ? `Aplicados ${reemplazos} reemplazos en ${archivosTocados} archivos SCSS/CSS.`
    : `[dry-run] Se homologarían ${reemplazos} literales en ${archivosTocados} archivos.`,
);

const unicos = [...new Set(pendientes.map((p) => p.hex))].sort();
if (unicos.length) {
  console.log(`\n${unicos.length} hex sin mapeo (revisar manualmente):`);
  unicos.slice(0, 24).forEach((h) => console.log(`  ${h}`));
  if (unicos.length > 24) console.log(`  … y ${unicos.length - 24} más`);
}

process.exit(0);
