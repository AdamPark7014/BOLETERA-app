#!/usr/bin/env node
/**
 * Guardián de la escala: radio, tipografía y espaciado.
 *
 * Compañero de `check-color-tokens.mjs`. El color no era el único eje disperso:
 * medido antes de consolidar, el monorepo tenía **119 tamaños de fuente
 * distintos** (1.296 literales), **60 radios** (489 literales) y **360 valores
 * de padding**. Eso no es una escala, es una colección de decisiones aisladas —
 * y es exactamente lo que hace que una interfaz se lea como ensamblada en vez
 * de diseñada, aunque cada pantalla por separado parezca correcta.
 *
 * Lo peor no eran los valores raros sino los VECINOS: `0.72rem`, `0.78rem` y
 * `0.8rem` conviviendo para decir «unos 12 px». Ninguno se ve mal solo; juntos
 * destruyen el ritmo vertical.
 *
 * Este guardián pone un techo que baja pero nunca sube.
 *
 * Uso:
 *   node scripts/check-dimension-tokens.mjs            comprueba
 *   node scripts/check-dimension-tokens.mjs --sellar   fija la línea base
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(raiz, 'scripts/dimension-baseline.json');
const SELLAR = process.argv.includes('--sellar');

/** `theme.scss` y `_variables.scss` DEFINEN la escala: ahí el literal manda. */
const DEFINEN_ESCALA = /_variables\.scss$|[/\\]theme\.scss$/;

const archivos = execSync(
  `git -C "${raiz}" ls-files "apps/*.scss" "apps/*.css" "packages/ui/src/**/*.scss"`,
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter((f) => f && !DEFINEN_ESCALA.test(f));

/**
 * ¿El valor está en posición de RESERVA — `var(--token, 8px)`? No cuenta: es el
 * patrón correcto, token primero y red de seguridad después.
 */
function enReserva(texto, indice) {
  const antes = texto.slice(Math.max(0, indice - 140), indice);
  const abre = antes.lastIndexOf('var(');
  if (abre === -1) return false;
  const trozo = antes.slice(abre);
  return !trozo.includes(')') && trozo.includes(',');
}

function contar(texto, regex, permitido) {
  let n = 0;
  for (const m of texto.matchAll(regex)) {
    const valor = (m[1] || '').trim();
    // `$sass-var` ya es un token, en otra sintaxis.
    if (!valor || valor.includes('var(') || valor.includes('$')) continue;
    if (permitido(valor)) continue;
    if (enReserva(texto, m.index)) continue;
    n++;
  }
  return n;
}

const porDimension = { radio: 0, tipo: 0, espacio: 0 };
const porArchivo = new Map();

for (const rel of archivos) {
  const texto = readFileSync(resolve(raiz, rel), 'utf8');

  // Círculos (50 %) y compuestos de dos ejes: intención geométrica, no escala.
  const radio = contar(
    texto,
    /border-radius:\s*([^;{}\n]+)/g,
    (v) => v.includes('%') || v.includes('/'),
  );

  const tipo = contar(
    texto,
    /font-size:\s*([^;{}\n]+)/g,
    (v) => v.includes('clamp') || v.includes('%') || (v.includes('em') && !v.endsWith('rem')),
  );

  let espacio = 0;
  for (const prop of ['padding', 'margin', 'gap', 'row-gap', 'column-gap']) {
    espacio += contar(
      texto,
      new RegExp(`\\b${prop}:\\s*([^;{}\\n]+)`, 'g'),
      // Los negativos son solapes deliberados (un borde que se come 1 px).
      (v) => v.includes('calc') || v.includes('%') || v.includes('auto') || v.startsWith('-'),
    );
  }

  porDimension.radio += radio;
  porDimension.tipo += tipo;
  porDimension.espacio += espacio;

  const total = radio + tipo + espacio;
  if (total > 0) porArchivo.set(rel, total);
}

const total = porDimension.radio + porDimension.tipo + porDimension.espacio;

console.log(`Literales de dimensión fuera de la escala: ${total}`);
console.log(`  ${String(porDimension.radio).padStart(4)}  border-radius`);
console.log(`  ${String(porDimension.tipo).padStart(4)}  font-size`);
console.log(`  ${String(porDimension.espacio).padStart(4)}  padding · margin · gap`);

if (porArchivo.size) {
  console.log('\nPeores archivos:');
  [...porArchivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}  ${f}`));
}

if (SELLAR) {
  writeFileSync(BASELINE, `${JSON.stringify({ total, porDimension }, null, 2)}\n`);
  console.log(`\nLínea base sellada en ${total} literales de dimensión.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log('\n⚠ No hay línea base. Créala con --sellar.');
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));

if (total > base.total) {
  console.log(`\n❌ Han aparecido ${total - base.total} literales de dimensión nuevos (línea base: ${base.total}).`);
  console.log('   Usa la escala del sistema:');
  console.log('     espaciado   var(--bl-space-1 … --bl-space-24)');
  console.log('     tipografía  var(--bl-text-2xs … --bl-text-6xl)');
  console.log('     radio       var(--bl-radius-xs … --bl-radius-full)');
  console.log('   Si el valor es inevitable, documenta por qué y vuelve a sellar.');
  process.exit(1);
}

if (total < base.total) {
  console.log(`\n✅ ${base.total - total} literales de dimensión menos que la línea base. Sella con --sellar.`);
} else {
  console.log('\n✅ Sin literales de dimensión nuevos.');
}
process.exit(0);
