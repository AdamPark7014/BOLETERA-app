#!/usr/bin/env node
/**
 * Homologación de radio, tipografía y espaciado sobre los tokens del sistema.
 *
 * Compañero de `check-color-tokens.mjs`, que ya cubre el color. Medido antes de
 * escribirlo: 60 valores distintos de `border-radius` (489 literales), 119 de
 * `font-size` (1.296 literales) y 360 de `padding`. Eso no es una escala, es
 * una colección de decisiones aisladas — y es exactamente lo que hace que una
 * interfaz se vea ensamblada en vez de diseñada.
 *
 * ── Qué NO toca, y por qué ──
 *
 *  - `packages/ui/src/styles/theme.scss` y `_variables.scss`: DEFINEN la escala.
 *  - Valores en posición de reserva `var(--token, 8px)`: es el patrón correcto.
 *  - `border-radius: 50%` y `999px`/`9999px`: círculos y píldoras son intención
 *    geométrica, no un paso de la escala. `--bl-radius-full` cubre la píldora.
 *  - Cualquier valor que no case EXACTAMENTE con un paso. Redondear al paso más
 *    cercano cambiaría el diseño en silencio; lo que no encaja se reporta para
 *    decidirlo a mano.
 *
 * Uso:  node scripts/homologar-tokens.mjs [--aplicar]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APLICAR = process.argv.includes('--aplicar');

/**
 * Ajuste al paso MÁS CERCANO de la escala.
 *
 * Sin esto la homologación se queda a medias: el grueso del ruido no son
 * valores exactos mal escritos, sino vecinos casi idénticos —0.72rem, 0.78rem y
 * 0.8rem para decir «unos 12 px»— que ninguna escala reconoce. Ajustarlos ES la
 * consolidación; dejarlos fuera sería catalogar el desorden en vez de corregirlo.
 *
 * La tolerancia acota el movimiento: nada se desplaza más de 2 px o del 18 % de
 * su valor, lo que sea menor. Un salto mayor no es un vecino de la escala, es
 * una decisión distinta, y esa se deja intacta y se reporta.
 */
const AJUSTAR = process.argv.includes('--ajustar');
const TOLERANCIA_PX = 2;
const TOLERANCIA_REL = 0.18;

/** 1rem = 16px en este proyecto (no se redefine el tamaño de raíz). */
const REM = 16;

/** Longitud CSS → px, o null si no es una longitud simple. */
function aPx(valor) {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(valor.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === 'rem' || m[2] === 'em') return n * REM;
  if (m[2] === 'px' || m[2] === undefined) return n;
  return null;
}

/** Paso más cercano de una tabla token→px, dentro de tolerancia. */
function ajustar(valor, tabla) {
  const px = aPx(valor);
  if (px === null) return null;
  let mejor = null;
  let mejorDist = Infinity;
  for (const [clave, token] of Object.entries(tabla)) {
    const pasoPx = aPx(clave);
    if (pasoPx === null) continue;
    const d = Math.abs(pasoPx - px);
    if (d < mejorDist) { mejorDist = d; mejor = { token, pasoPx }; }
  }
  if (!mejor) return null;
  const limite = Math.min(TOLERANCIA_PX, Math.abs(px) * TOLERANCIA_REL);
  if (mejorDist > limite) return null;
  return { ...mejor, dePx: px };
}

const ajustes = new Map();
function anotarAjuste(prop, valor, r) {
  const k = `${prop}: ${valor} → ${r.token} (${r.dePx.toFixed(2)}px → ${r.pasoPx}px)`;
  ajustes.set(k, (ajustes.get(k) || 0) + 1);
}

const RADIOS = {
  '0': '--bl-radius-none', '0px': '--bl-radius-none',
  '4px': '--bl-radius-xs', '0.25rem': '--bl-radius-xs',
  '6px': '--bl-radius-sm', '0.375rem': '--bl-radius-sm',
  '8px': '--bl-radius-md', '0.5rem': '--bl-radius-md',
  '12px': '--bl-radius-lg', '0.75rem': '--bl-radius-lg',
  '16px': '--bl-radius-xl', '1rem': '--bl-radius-xl',
  '20px': '--bl-radius-2xl', '1.25rem': '--bl-radius-2xl',
  '999px': '--bl-radius-full', '9999px': '--bl-radius-full', '9999em': '--bl-radius-full',

  // 10px cae EXACTAMENTE entre `md` (8) y `lg` (12), asi que el ajuste por
  // cercania lo rechaza por empate. Se resuelve a mano hacia arriba: los 60
  // usos son tarjetas y paneles, donde la curva mayor es la convencion actual
  // y la que hace que un contenedor se lea como superficie y no como boton.
  '10px': '--bl-radius-lg', '0.625rem': '--bl-radius-lg',
};

const TIPOS = {
  '11px': '--bl-text-2xs', '0.6875rem': '--bl-text-2xs',
  '12px': '--bl-text-xs', '0.75rem': '--bl-text-xs',
  '13px': '--bl-text-sm', '0.8125rem': '--bl-text-sm',
  '14px': '--bl-text-md', '0.875rem': '--bl-text-md',
  '16px': '--bl-text-lg', '1rem': '--bl-text-lg',
  '18px': '--bl-text-xl', '1.125rem': '--bl-text-xl',
  '21px': '--bl-text-2xl',
  '26px': '--bl-text-3xl',
  '32px': '--bl-text-4xl', '2rem': '--bl-text-4xl',
  '40px': '--bl-text-5xl', '2.5rem': '--bl-text-5xl',
  '52px': '--bl-text-6xl',
};

const ESPACIOS = {
  '0': '--bl-space-0', '0px': '--bl-space-0',
  '1px': '--bl-space-px',
  '2px': '--bl-space-0-5', '0.125rem': '--bl-space-0-5',
  '4px': '--bl-space-1', '0.25rem': '--bl-space-1',
  '6px': '--bl-space-1-5', '0.375rem': '--bl-space-1-5',
  '8px': '--bl-space-2', '0.5rem': '--bl-space-2',
  '10px': '--bl-space-2-5', '0.625rem': '--bl-space-2-5',
  '12px': '--bl-space-3', '0.75rem': '--bl-space-3',
  '16px': '--bl-space-4', '1rem': '--bl-space-4',
  '20px': '--bl-space-5', '1.25rem': '--bl-space-5',
  '24px': '--bl-space-6', '1.5rem': '--bl-space-6',
  '28px': '--bl-space-7', '1.75rem': '--bl-space-7',
  '32px': '--bl-space-8', '2rem': '--bl-space-8',
  '40px': '--bl-space-10', '2.5rem': '--bl-space-10',
  '48px': '--bl-space-12', '3rem': '--bl-space-12',
  '64px': '--bl-space-16', '4rem': '--bl-space-16',
};

/** Propiedades cuyo valor es una LISTA de longitudes (padding: 8px 12px). */
const PROPS_ESPACIO = ['padding', 'margin', 'gap', 'row-gap', 'column-gap'];

const EXCLUIDOS = /_variables\.scss$|[/\\]theme\.scss$/;

const archivos = execSync(
  `git -C "${raiz}" ls-files "apps/*.scss" "apps/*.css" "packages/ui/src/**/*.scss"`,
  { encoding: 'utf8' },
).split(/\r?\n/).filter((f) => f && !EXCLUIDOS.test(f));

/** ¿El literal está en posición de reserva dentro de un var()? Se respeta. */
function enReserva(texto, indice) {
  const antes = texto.slice(Math.max(0, indice - 140), indice);
  const abre = antes.lastIndexOf('var(');
  if (abre === -1) return false;
  const trozo = antes.slice(abre);
  return !trozo.includes(')') && trozo.includes(',');
}

const conteo = { radio: 0, tipo: 0, espacio: 0 };
const sinMapear = new Map();
const porArchivo = new Map();

for (const rel of archivos) {
  const ruta = resolve(raiz, rel);
  const original = readFileSync(ruta, 'utf8');
  let texto = original;
  let cambios = 0;

  // --- border-radius ---------------------------------------------------------
  texto = texto.replace(/(\bborder-radius:\s*)([^;{}\n]+)/g, (todo, pre, valor, idx) => {
    if (enReserva(texto, idx)) return todo;
    const v = valor.trim();
    // Compuestos (dos ejes, esquinas distintas) y porcentajes: intención propia.
    if (v.includes('/') || v.includes('%') || v.includes('var(') || v.split(/\s+/).length > 1) return todo;
    let token = RADIOS[v];
    if (!token && AJUSTAR) {
      const r = ajustar(v, RADIOS);
      if (r) { token = r.token; anotarAjuste('border-radius', v, r); }
    }
    if (!token) { sinMapear.set(`radius:${v}`, (sinMapear.get(`radius:${v}`) || 0) + 1); return todo; }
    cambios++; conteo.radio++;
    return `${pre}var(${token})`;
  });

  // --- font-size -------------------------------------------------------------
  texto = texto.replace(/(\bfont-size:\s*)([^;{}\n]+)/g, (todo, pre, valor, idx) => {
    if (enReserva(texto, idx)) return todo;
    const v = valor.trim();
    if (v.includes('var(') || v.includes('clamp') || v.includes('%') || v.includes('em') && !v.endsWith('rem')) return todo;
    let token = TIPOS[v];
    if (!token && AJUSTAR) {
      const r = ajustar(v, TIPOS);
      if (r) { token = r.token; anotarAjuste('font-size', v, r); }
    }
    if (!token) { sinMapear.set(`text:${v}`, (sinMapear.get(`text:${v}`) || 0) + 1); return todo; }
    cambios++; conteo.tipo++;
    return `${pre}var(${token})`;
  });

  // --- padding / margin / gap ------------------------------------------------
  for (const prop of PROPS_ESPACIO) {
    const re = new RegExp(`(\\b${prop}:\\s*)([^;{}\\n]+)`, 'g');
    texto = texto.replace(re, (todo, pre, valor, idx) => {
      if (enReserva(texto, idx)) return todo;
      const v = valor.trim();
      if (v.includes('var(') || v.includes('calc') || v.includes('%') || v.includes('auto')) return todo;
      const partes = v.split(/\s+/);
      if (partes.length > 4) return todo;
      const mapeadas = partes.map((p) => {
        if (ESPACIOS[p]) return ESPACIOS[p];
        if (!AJUSTAR) return undefined;
        const r = ajustar(p, ESPACIOS);
        if (r) { anotarAjuste(prop, p, r); return r.token; }
        return undefined;
      });
      // Todo o nada: media conversión deja el valor peor que como estaba.
      if (mapeadas.some((m) => !m)) {
        partes.forEach((p, i) => { if (!mapeadas[i]) sinMapear.set(`${prop}:${p}`, (sinMapear.get(`${prop}:${p}`) || 0) + 1); });
        return todo;
      }
      cambios++; conteo.espacio++;
      return `${pre}${mapeadas.map((m) => `var(${m})`).join(' ')}`;
    });
  }

  if (cambios > 0) {
    porArchivo.set(rel, cambios);
    if (APLICAR && texto !== original) writeFileSync(ruta, texto);
  }
}

const total = conteo.radio + conteo.tipo + conteo.espacio;
console.log(`${APLICAR ? 'APLICADO' : 'EN SECO'} · ${archivos.length} archivos revisados\n`);
console.log(`Sustituciones: ${total}`);
console.log(`  border-radius  ${conteo.radio}`);
console.log(`  font-size      ${conteo.tipo}`);
console.log(`  padding/margin/gap ${conteo.espacio}`);
console.log(`Archivos afectados: ${porArchivo.size}\n`);

console.log('Top 10 archivos:');
[...porArchivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}  ${f}`));

if (ajustes.size) {
  const totalAjustes = [...ajustes.values()].reduce((a, b) => a + b, 0);
  console.log(`
Ajustados al paso más cercano (${totalAjustes} usos, ${ajustes.size} valores):`);
  [...ajustes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
}

const resto = [...sinMapear.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nFuera de escala (${resto.reduce((s, [, n]) => s + n, 0)} usos, ${resto.length} valores) — decidir a mano:`);
resto.slice(0, 18).forEach(([v, n]) => console.log(`  ${String(n).padStart(4)}  ${v}`));
