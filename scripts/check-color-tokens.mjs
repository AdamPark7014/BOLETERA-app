#!/usr/bin/env node
/**
 * Guardián de la paleta.
 *
 * ── Por qué existe ──
 *
 * El color de este monorepo se ha unificado tres veces y se ha vuelto a romper
 * tres veces, siempre igual: alguien escribe `#18181b` en una pantalla nueva
 * porque «es casi el mismo negro». No lo es —el sistema usa una rampa fría— y a
 * las pocas pantallas conviven cinco familias de gris. El ojo no lee eso como
 * diseño, lo lee como suciedad.
 *
 * Una unificación sin guardián es una limpieza, no una corrección.
 *
 * ── Qué comprueba ──
 *
 *  1. Que no aparezcan literales hexadecimales NUEVOS en las apps, por encima
 *     de una línea base que baja pero nunca sube.
 *  2. Que todo `var(--bl-*)` referenciado exista de verdad en `theme.scss`.
 *     Un token inventado no falla: pinta transparente y llega a producción.
 *
 * Uso:
 *   node scripts/check-color-tokens.mjs            comprueba
 *   node scripts/check-color-tokens.mjs --sellar   fija la línea base actual
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(raiz, 'scripts/color-baseline.json');
const SELLAR = process.argv.includes('--sellar');

/** `_variables.scss` y `theme.scss` DEFINEN la paleta: ahí el literal es correcto. */
const DEFINEN_PALETA = /_variables\.scss$|[/\\]theme\.scss$/;

/**
 * Ficheros que dibujan en canvas: `ctx.fillStyle = 'var(--x)'` no lanza error,
 * simplemente no pinta. Ahí el literal es la opción correcta y se permite.
 */
const dibujaEnCanvas = (t) =>
  /getContext\s*\(|fillStyle|strokeStyle|<canvas|createElement\(\s*['"]canvas['"]/.test(t);

const listar = (patron) =>
  execSync(`git -C "${raiz}" ls-files ${patron}`, { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

const archivos = [
  ...listar('"apps/*.scss" "apps/*.css" "apps/*.tsx" "apps/*.ts"'),
  ...listar('"packages/ui/src/**/*.scss"'),
].filter((f) => !DEFINEN_PALETA.test(f));

let literales = 0;
const porApp = {};
const usados = new Set();

for (const rel of archivos) {
  const texto = readFileSync(resolve(raiz, rel), 'utf8');
  for (const m of texto.matchAll(/var\(\s*(--bl-[a-z0-9-]+)/g)) usados.add(m[1]);

  if (dibujaEnCanvas(texto)) continue;

  const n = (texto.match(/#[0-9a-fA-F]{6}\b/g) || []).length;
  if (n === 0) continue;
  literales += n;
  const app = rel.split('/')[1] ?? 'otros';
  porApp[app] = (porApp[app] || 0) + n;
}

// --- 2. Tokens huérfanos ------------------------------------------------------
const theme = readFileSync(resolve(raiz, 'packages/ui/src/styles/theme.scss'), 'utf8');
const definidos = new Set([...theme.matchAll(/^\s*(--bl-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
const huerfanos = [...usados].filter((t) => !definidos.has(t)).sort();

// --- informe ------------------------------------------------------------------
console.log(`Literales de color fuera de la paleta: ${literales}`);
for (const [app, n] of Object.entries(porApp).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${app}`);
}
console.log(`\nTokens --bl-* usados: ${usados.size} · definidos: ${definidos.size}`);

if (SELLAR) {
  writeFileSync(BASELINE, JSON.stringify({ literales, porApp }, null, 2) + '\n');
  console.log(`\nLínea base sellada en ${literales} literales.`);
  process.exit(0);
}

let fallo = false;

if (huerfanos.length) {
  console.log(`\n❌ ${huerfanos.length} token(s) usados pero NO definidos en theme.scss.`);
  console.log('   Un var() que no resuelve pinta transparente y nadie se entera:');
  huerfanos.forEach((t) => console.log(`     ${t}`));
  fallo = true;
}

if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  if (literales > base.literales) {
    console.log(
      `\n❌ Han aparecido ${literales - base.literales} literales nuevos ` +
        `(línea base: ${base.literales}).`,
    );
    console.log('   Usa un token del sistema: var(--bl-gray-500), var(--bl-danger)…');
    console.log('   Si el literal es inevitable (marca de un tercero, canvas),');
    console.log('   documenta por qué y vuelve a sellar con --sellar.');
    fallo = true;
  } else if (literales < base.literales) {
    console.log(`\n✅ ${base.literales - literales} literales menos que la línea base. Sella con --sellar.`);
  } else {
    console.log('\n✅ Sin literales nuevos.');
  }
} else {
  console.log('\n⚠ No hay línea base. Créala con --sellar.');
}

process.exit(fallo ? 1 : 0);
