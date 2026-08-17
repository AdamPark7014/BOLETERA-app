/**
 * CUPO POR FASE DE VENTA (`SalePhase.allocationPercent`).
 *
 * Comprueba las tres cosas que la funcionalidad promete:
 *
 *   1. TOPE BAJO CONCURRENCIA — un evento de 100 butacas con una preventa al
 *      30% no puede entregar más de 30, aunque 100 compradores lo intenten a la
 *      vez. Es la prueba de que la comprobación y el apartado son atómicos: si
 *      fueran dos pasos (contar en Postgres y decidir en Node) varios lectores
 *      verían el mismo "quedan 3" y todos pasarían.
 *   2. DEVOLUCIÓN DEL CUPO — al liberar holds (lo mismo que ve el sistema cuando
 *      uno expira o se cancela una orden), el cupo vuelve solo tras la
 *      reconciliación contra la base, sin que nadie tenga que avisar.
 *   3. AVANCE DE ESTADO — una fase sembrada como SCHEDULED con su ventana ya
 *      abierta pasa a ACTIVE por el mero tráfico de venta, sin cron.
 *
 * Uso:
 *   docker compose up -d postgres redis
 *   THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 \
 *   SALE_PHASE_QUOTA_SYNC_SECONDS=3 \
 *     node apps/api/dist/main.js
 *   node e2e/load/sale-phase-allocation.mjs
 *
 * `SALE_PHASE_QUOTA_SYNC_SECONDS` se baja a propósito: por defecto son 20 s y
 * esperar tanto por la parte 2 no aporta nada. El límite se hace cumplir igual.
 *
 * Variables:
 *   API_URL     (default http://127.0.0.1:4000/api/v1)
 *   CAPACITY    (default 100)  aforo del evento, todo admisión general
 *   ALLOCATION  (default 30)   % del aforo reservado a la preventa
 *   BUYERS      (default 100)  compradores simultáneos por oleada
 *   SYNC_WAIT_MS(default 6000) espera para que corra la reconciliación
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

// Carga .env de la raíz del repo: el script se ejecuta suelto con `node`, sin
// el arranque de Nest que normalmente resuelve la configuración. Se separa por
// /\r?\n/ porque el .env viene en CRLF.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) continue;
  const value = match[2].trim().replace(/^["']|["']$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const CAPACITY = Number(process.env.CAPACITY ?? 100);
const ALLOCATION = Number(process.env.ALLOCATION ?? 30);
const BUYERS = Number(process.env.BUYERS ?? 100);
const SYNC_WAIT_MS = Number(process.env.SYNC_WAIT_MS ?? 6_000);

/** Mismo cálculo que `SalePhaseQuotaService.limitFor`. */
const LIMIT = Math.floor((CAPACITY * ALLOCATION) / 100);
/** Holds que se liberan para comprobar que el cupo vuelve. */
const RELEASED = Math.max(1, Math.floor(LIMIT / 3));

const prisma = new PrismaClient();
const stamp = Date.now();
const slug = `phase-alloc-${stamp}`;

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: `Phase Allocation ${stamp}`,
      slug: `org-${slug}`,
      email: 'test@phase-alloc.local',
      country: 'MX',
      currency: 'MXN',
    },
  });

  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: `Venue ${stamp}`,
      slug: `venue-${slug}`,
      address: 'x',
      city: 'CDMX',
      state: 'CDMX',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: CAPACITY,
    },
  });

  const startsAt = new Date(Date.now() + 86_400_000);
  const event = await prisma.event.create({
    data: {
      slug,
      organizationId: org.id,
      venueId: venue.id,
      title: `Phase Allocation ${stamp}`,
      startsAt,
      timezone: 'America/Mexico_City',
      status: 'LIVE',
      publishedAt: new Date(),
      currency: 'MXN',
      // Denominador del cupo: `allocationPercent` es un % de este número.
      totalCapacity: CAPACITY,
      minPrice: 100,
      maxPrice: 100,
    },
  });

  // La preventa lleva DOS horas abierta y sigue guardada como SCHEDULED: es
  // exactamente el estado congelado que ve el operador en el backoffice.
  const phase = await prisma.salePhase.create({
    data: {
      eventId: event.id,
      name: 'Preventa',
      kind: 'PRESALE',
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(startsAt.getTime() - 3_600_000),
      status: 'SCHEDULED',
      channels: [],
      allocationPercent: ALLOCATION,
      priority: 10,
    },
  });

  const offer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'General',
      zone: 'ga',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: CAPACITY,
      remainingQuantity: CAPACITY,
      startDate: new Date(),
      endDate: startsAt,
      maxPerOrder: 10,
    },
  });

  // Inventario suficiente para que el ÚNICO tope que puede morder sea el de la
  // fase. Si el aforo se agotara antes, la prueba no demostraría nada.
  await prisma.ticket.createMany({
    data: Array.from({ length: CAPACITY }, (_, i) => ({
      code: `PA-${stamp}-G${i + 1}`,
      eventId: event.id,
      offerId: offer.id,
      status: 'AVAILABLE',
      section: 'GA',
      row: 'GA',
      seatNumber: String(i + 1),
    })),
  });

  return { org, event, phase, offer };
}

/**
 * Da de alta un cajero y devuelve su token. El rol se eleva ANTES de iniciar
 * sesión: cualquier escritura sobre el usuario refresca `updatedAt` e invalida
 * los tokens emitidos antes.
 */
async function authenticateCashier(orgId) {
  const email = `cajero-${stamp}@phase-alloc.local`;
  const password = 'Phase-Alloc-Test-2026!';

  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Caja', lastName: 'Prueba' }),
  });
  if (!reg.ok) throw new Error(`No se pudo registrar el cajero: ${await describeFailure(reg)}`);

  await prisma.user.update({
    where: { email },
    data: { role: 'TAQUILLA', organizationId: orgId, emailVerified: true },
  });

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`No se pudo autenticar: ${await describeFailure(login)}`);
  const { accessToken } = await login.json();
  return { email, accessToken };
}

/** Extrae mensaje y motivo del API para agrupar los rechazos por causa real. */
async function describeFailure(res) {
  try {
    const body = await res.json();
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    const reason = body?.reason ?? message?.reason;
    return { reason: reason ?? '', text: String(message?.message ?? message ?? '').slice(0, 90) };
  } catch {
    return { reason: '', text: '' };
  }
}

/** Un intento de apartar un boleto. No se paga: el cupo se toma en el hold. */
async function attemptHold(i, ctx, label) {
  const res = await fetch(`${API}/inventory/staff/holds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.cashier.accessToken}`,
    },
    body: JSON.stringify({
      eventId: ctx.event.id,
      offerId: ctx.offer.id,
      quantity: 1,
      sessionId: `sess-${label}-${i}-${stamp}`, // uno por intento: aísla el tope por sesión
    }),
  });
  if (res.ok) {
    const body = await res.json();
    return { ok: true, holdIds: (body.holds ?? []).map((h) => h.id) };
  }
  const { reason, text } = await describeFailure(res);
  return { ok: false, status: res.status, reason, text };
}

async function wave(ctx, label, count) {
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      attemptHold(i, ctx, label).catch((e) => ({ ok: false, status: 'error', reason: '', text: String(e).slice(0, 60) })),
    ),
  );
  const granted = results.filter((r) => r.ok);
  const exhausted = results.filter((r) => !r.ok && r.reason === 'PHASE_ALLOCATION_EXHAUSTED');

  const breakdown = new Map();
  for (const r of results) {
    if (r.ok) continue;
    const key = `${r.status} ${r.reason || r.text || 'sin detalle'}`;
    breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
  }
  return {
    granted: granted.map((r) => r.holdIds).flat(),
    grantedCount: granted.length,
    exhaustedCount: exhausted.length,
    breakdown,
  };
}

function report(title, lines) {
  console.log(`\n──── ${title} ────`);
  for (const line of lines) console.log(`  ${line}`);
}

async function cleanup(ctx) {
  await prisma.ticket.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.seatHold.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.orderItem.deleteMany({ where: { order: { eventId: ctx.event.id } } });
  await prisma.order.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.salePhase.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.offer.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.event.delete({ where: { id: ctx.event.id } });
  await prisma.user.deleteMany({ where: { email: `cajero-${stamp}@phase-alloc.local` } });
  await prisma.venue.deleteMany({ where: { organizationId: ctx.org.id } });
  await prisma.organization.delete({ where: { id: ctx.org.id } }).catch(() => undefined);
}

// ---------------------------------------------------------------------------

const ctx = await seed();
ctx.cashier = await authenticateCashier(ctx.org.id);
console.log(`Evento ${ctx.event.slug}: aforo ${CAPACITY}, preventa al ${ALLOCATION}% → tope ${LIMIT}`);
console.log(`Cajero ${ctx.cashier.email} · ${BUYERS} intentos simultáneos\n`);

// ---- 1. El tope aguanta la concurrencia -----------------------------------
const first = await wave(ctx, 'w1', BUYERS);
report('1 · TOPE BAJO CONCURRENCIA', [
  `holds concedidos ......... ${first.grantedCount} (tope ${LIMIT}) ${
    first.grantedCount === LIMIT ? '✅' : first.grantedCount > LIMIT ? `❌ SE COLARON ${first.grantedCount - LIMIT}` : '❌ se concedieron de menos'
  }`,
  `rechazos por cupo ........ ${first.exhaustedCount}`,
  ...[...first.breakdown].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)} × ${k}`),
]);

// ---- 2. El cupo vuelve cuando se libera inventario -------------------------
// Se liberan holds a mano: es lo mismo que la base ve cuando uno expira o
// cuando se cancela una orden, que son los caminos que nadie notifica.
// El inventario no se toca: quedan ~70 boletos AVAILABLE, así que el único
// tope que puede morder en las siguientes oleadas sigue siendo el de la fase.
await prisma.seatHold.updateMany({
  where: { id: { in: first.granted.slice(0, RELEASED) } },
  data: { status: 'RELEASED', releasedAt: new Date() },
});

const blocked = await wave(ctx, 'w2', 5);

// La reconciliación NO se espera dentro de la petición (alargarla sería pagar
// en el onsale lo que se puede pagar en segundo plano), así que la prueba tiene
// que provocarla y darle tiempo a aterrizar ANTES de medir. Si se lanzara la
// oleada de golpe, competiría con la corrección en vuelo y el resultado
// dependería del orden de llegada.
await sleep(SYNC_WAIT_MS); // deja caducar el candado que limita las pasadas
const trigger = await wave(ctx, 'w3', 1); // dispara la reconciliación
await sleep(2_000);
const reopened = await wave(ctx, 'w4', RELEASED * 2);

// Lo que se afirma es el TOTAL devuelto, no en qué oleada cayó: cuándo corre la
// reconciliación es un detalle de tiempos, cuánto cupo vuelve no lo es.
const returned = blocked.grantedCount + trigger.grantedCount + reopened.grantedCount;
report('2 · DEVOLUCIÓN DEL CUPO', [
  `liberados a mano ......... ${RELEASED}`,
  `antes de reconciliar ..... ${blocked.grantedCount} concedidos de 5`,
  `tras reconciliar ......... ${trigger.grantedCount + reopened.grantedCount} concedidos de ${RELEASED * 2 + 1}`,
  returned === RELEASED
    ? `✅ volvió exactamente el cupo liberado (${returned})`
    : `❌ volvieron ${returned}, se esperaban ${RELEASED}`,
]);

// ---- 3. El estado de la fase avanza solo -----------------------------------
const phaseRow = await prisma.salePhase.findUnique({ where: { id: ctx.phase.id } });
report('3 · AVANCE DE ESTADO', [
  `estado sembrado .......... SCHEDULED (con la ventana ya abierta)`,
  `estado en BD ............. ${phaseRow.status} ${phaseRow.status === 'ACTIVE' ? '✅' : '❌ sigue congelado'}`,
]);

await cleanup(ctx);
await prisma.$disconnect();

const failures = [
  first.grantedCount !== LIMIT && `el tope entregó ${first.grantedCount} en vez de ${LIMIT}`,
  returned !== RELEASED && `el cupo devuelto fue ${returned} en vez de ${RELEASED}`,
  phaseRow.status !== 'ACTIVE' && `la fase quedó en ${phaseRow.status}`,
].filter(Boolean);

console.log(
  `\n${failures.length ? `❌ FALLA: ${failures.join(' · ')}` : '✅ Cupo respetado, devuelto y estado al día'}`,
);
process.exit(failures.length ? 1 : 0);
