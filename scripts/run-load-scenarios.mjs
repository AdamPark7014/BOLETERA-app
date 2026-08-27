#!/usr/bin/env node
/**
 * Lanzador de los escenarios de carga.
 *
 * ── Por qué existe ──
 *
 * En `e2e/load/` había doce escenarios escritos con cuidado —sobreventa,
 * acaparamiento por bots, aislamiento entre inquilinos, reparto por fases— y
 * ninguno estaba cableado a un comando. Existían como archivos: para correr uno
 * había que leerlo entero y averiguar qué variables de entorno esperaba. Un
 * escenario que nadie puede lanzar no es una prueba, es documentación.
 *
 * Ahora cada uno tiene su `pnpm load:<escenario>`, y esto los corre en tanda.
 *
 * ── Lo que aporta sobre llamar a `node` a pelo ──
 *
 * Los escenarios asumen que el API y Postgres están arriba. Si no lo están,
 * mueren con un `TypeError: fetch failed` y un volcado de pila que no dice qué
 * hacer. Aquí se comprueba antes y se dice en castellano qué falta arrancar.
 *
 * ── Uso ──
 *
 *   pnpm load:all                      # todos, en secuencia
 *   pnpm load:all oversell waiting-room  # sólo esos
 *   pnpm load:all --check              # ¿está la plataforma lista?
 *   pnpm load:all --syntax             # ¿siguen siendo código válido? (sin API)
 *
 * Variables:
 *   API_URL   (default http://127.0.0.1:4000/api/v1)
 *   BAIL      =true para parar en el primer escenario que falle
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadDir = resolve(repoRoot, 'e2e/load');

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const BAIL = process.env.BAIL === 'true';

/**
 * `onsale-k6.js` queda fuera a propósito: necesita el binario de k6, que no es
 * una dependencia del monorepo. Se lanza con `pnpm load:onsale`.
 */
const escenarios = readdirSync(loadDir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort();

const args = process.argv.slice(2);
const soloComprobar = args.includes('--check');
const soloSintaxis = args.includes('--syntax');
const pedidos = args.filter((a) => !a.startsWith('--'));

const desconocidos = pedidos.filter((p) => !escenarios.includes(p));
if (desconocidos.length) {
  console.error(`Escenario desconocido: ${desconocidos.join(', ')}`);
  console.error(`Disponibles:\n  ${escenarios.join('\n  ')}`);
  process.exit(2);
}

const aCorrer = pedidos.length ? pedidos : escenarios;

/**
 * Comprobación de sintaxis, sin API ni base.
 *
 * Es lo único de los escenarios de carga que puede correr en CI: basta para que
 * un `pnpm load:oversell` no descubra en plena preparación de un onsale que el
 * escenario lleva meses sin compilar porque alguien renombró un módulo.
 */
async function comprobarSintaxis(nombres) {
  const fallos = [];
  for (const nombre of nombres) {
    const ruta = resolve(loadDir, `${nombre}.mjs`);
    const code = await new Promise((r) => {
      const hijo = spawn(process.execPath, ['--check', ruta], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      hijo.stderr.on('data', (d) => (err += d));
      hijo.on('close', (c) => {
        if (c !== 0) fallos.push({ nombre, err: err.trim().split('\n')[0] ?? '' });
        r(c ?? 1);
      });
    });
    console.log(`${code === 0 ? '✅' : '❌'} ${nombre}`);
  }
  if (fallos.length) {
    console.error(`\n${fallos.length} escenario(s) con sintaxis rota:`);
    for (const f of fallos) console.error(`  ${f.nombre}: ${f.err}`);
    return 1;
  }
  console.log(`\n${nombres.length}/${nombres.length} escenarios son código válido`);
  return 0;
}

if (soloSintaxis) {
  process.exit(await comprobarSintaxis(aCorrer));
}

/** ¿Responde el API? Es la precondición que falla el 100% de las veces. */
async function apiArriba() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

const arriba = await apiArriba();

if (!arriba) {
  console.error(`\n❌ El API no responde en ${API}\n`);
  console.error('Los escenarios de carga necesitan la plataforma arriba:\n');
  console.error('  docker compose up -d postgres redis');
  console.error('  pnpm db:migrate:deploy && pnpm db:seed');
  console.error('  THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 pnpm dev:api\n');
  console.error(
    'El throttle alto no es opcional: varios escenarios lanzan cientos de\n' +
      'compradores simultáneos y chocarían con el límite por IP antes de competir.\n',
  );
  process.exit(1);
}

if (soloComprobar) {
  console.log(`✅ API arriba en ${API}. ${aCorrer.length} escenarios listos para correr:`);
  for (const e of aCorrer) console.log(`   pnpm load:${e}`);
  process.exit(0);
}

/** Un escenario = un proceso hijo. Un fallo suyo no puede tumbar el lanzador. */
function correr(nombre) {
  return new Promise((resolveRun) => {
    console.log(`\n${'─'.repeat(70)}\n▶ ${nombre}\n${'─'.repeat(70)}`);
    const hijo = spawn(process.execPath, [resolve(loadDir, `${nombre}.mjs`)], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    hijo.on('close', (code) => resolveRun(code ?? 1));
    hijo.on('error', () => resolveRun(1));
  });
}

const resultados = [];
for (const nombre of aCorrer) {
  const code = await correr(nombre);
  resultados.push({ nombre, code });
  if (code !== 0 && BAIL) break;
}

console.log(`\n${'═'.repeat(70)}\nRESUMEN\n${'═'.repeat(70)}`);
for (const { nombre, code } of resultados) {
  console.log(`${code === 0 ? '✅' : '❌'} ${nombre}${code === 0 ? '' : ` (exit ${code})`}`);
}

const fallaron = resultados.filter((r) => r.code !== 0);
const noCorridos = aCorrer.length - resultados.length;
if (noCorridos) console.log(`⏭️  ${noCorridos} sin correr (BAIL=true)`);

console.log(`\n${resultados.length - fallaron.length}/${aCorrer.length} escenarios en verde`);
process.exit(fallaron.length ? 1 : 0);
