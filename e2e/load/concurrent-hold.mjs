/**
 * PRUEBA DE CONCURRENCIA EN HOLDS — mismo asiento, N compradores simultáneos.
 *
 * Verifica que como máximo UN hold ACTIVE quede sobre la misma butaca y que
 * el boleto asociado pase a HELD una sola vez. También prueba Idempotency-Key
 * en reintentos del mismo comprador.
 *
 * Uso:
 *   docker compose up -d postgres redis
 *   THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 pnpm --filter @boletera/api dev
 *   node e2e/load/concurrent-hold.mjs
 *
 * Variables:
 *   API_URL  (default http://127.0.0.1:4000/api/v1)
 *   BUYERS   (default 200)  compradores concurrentes sobre la misma butaca
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient, HoldStatus, TicketStatus } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) continue;
  const value = match[2].trim().replace(/^["']|["']$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const BUYERS = Number(process.env.BUYERS ?? 200);

const prisma = new PrismaClient();
const stamp = Date.now();
const slug = `concurrent-hold-${stamp}`;

async function describeFailure(res) {
  try {
    const body = await res.json();
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    return String(message ?? body?.error ?? '').slice(0, 90);
  } catch {
    return '';
  }
}

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: `Concurrent Hold ${stamp}`,
      slug: `org-${slug}`,
      email: 'test@concurrent-hold.local',
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
      totalCapacity: 1,
    },
  });

  const layout = await prisma.venueLayout.create({
    data: { venueId: venue.id, name: 'L1', mapData: { sections: [] } },
  });
  const section = await prisma.section.create({
    data: { layoutId: layout.id, name: 'A', slug: 'a' },
  });

  const event = await prisma.event.create({
    data: {
      slug,
      organizationId: org.id,
      venueId: venue.id,
      title: `Concurrent Hold ${stamp}`,
      startsAt: new Date(Date.now() + 86_400_000),
      timezone: 'America/Mexico_City',
      status: 'LIVE',
      publishedAt: new Date(),
      currency: 'MXN',
      totalCapacity: 1,
      minPrice: 100,
      maxPrice: 100,
    },
  });

  const offer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'Numerado',
      zone: 'numerado',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: 1,
      remainingQuantity: 1,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000),
      maxPerOrder: 1,
    },
  });

  const seat = await prisma.seat.create({
    data: { sectionId: section.id, label: 'A1', x: 1, y: 0 },
  });
  await prisma.ticket.create({
    data: {
      code: `CH-${stamp}`,
      eventId: event.id,
      offerId: offer.id,
      status: 'AVAILABLE',
      seatId: seat.id,
      section: 'A',
      row: 'A',
      seatNumber: '1',
    },
  });

  return { org, event, offer, seatId: seat.id };
}

async function authenticateCashier(orgId) {
  const email = `cajero-${stamp}@concurrent-hold.local`;
  const password = 'Concurrent-Hold-2026!';

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

async function attemptHold(i, ctx, idempotencyKey) {
  const sessionId = `sess-${i}-${stamp}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.cashier.accessToken}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
  const res = await fetch(`${API}/inventory/staff/holds`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      eventId: ctx.event.id,
      seatIds: [ctx.seatId],
      offerId: ctx.offer.id,
      sessionId,
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await describeFailure(res), holds: [] };
  }
  const body = await res.json();
  return { ok: true, status: res.status, detail: '', holds: body.holds ?? [] };
}

async function cleanup(ctx) {
  await prisma.ticket.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.seatHold.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.offer.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.event.delete({ where: { id: ctx.event.id } });
  await prisma.user.deleteMany({ where: { email: `cajero-${stamp}@concurrent-hold.local` } });
  await prisma.organization.delete({ where: { id: ctx.org.id } }).catch(() => undefined);
}

const ctx = await seed();
ctx.cashier = await authenticateCashier(ctx.org.id);

console.log(`Evento: ${ctx.event.slug} · 1 butaca · ${BUYERS} compradores concurrentes\n`);

const results = await Promise.all(
  Array.from({ length: BUYERS }, (_, i) =>
    attemptHold(i, ctx).catch((e) => ({
      ok: false,
      status: 'error',
      detail: String(e).slice(0, 60),
      holds: [],
    })),
  ),
);

const winners = results.filter((r) => r.ok);
const activeHolds = await prisma.seatHold.count({
  where: {
    eventId: ctx.event.id,
    seatId: ctx.seatId,
    status: HoldStatus.ACTIVE,
    expiresAt: { gt: new Date() },
  },
});
const heldTickets = await prisma.ticket.count({
  where: { eventId: ctx.event.id, seatId: ctx.seatId, status: TicketStatus.HELD },
});

const breakdown = new Map();
for (const r of results) {
  if (r.ok) continue;
  const key = `${r.status}${r.detail ? ` · ${r.detail}` : ''}`;
  breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
}

console.log('── Carrera por la misma butaca ──');
console.log(`  holds HTTP 2xx .......... ${winners.length}`);
console.log(`  holds ACTIVE en BD ...... ${activeHolds}   ${activeHolds === 1 ? '✅' : '❌'}`);
console.log(`  boletos HELD en BD ...... ${heldTickets}   ${heldTickets === 1 ? '✅' : '❌'}`);
if (breakdown.size) {
  console.log('  rechazos por causa:');
  for (const [reason, count] of [...breakdown].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(count).padStart(4)} × ${reason}`);
  }
}

// Idempotency-Key: mismo comprador, misma clave → mismo hold
const idempKey = `hold-${stamp}`;
const first = await attemptHold(9999, ctx, idempKey);
const retry = await attemptHold(9999, ctx, idempKey);
const idempOk =
  first.ok &&
  retry.ok &&
  first.holds[0]?.id &&
  first.holds[0].id === retry.holds[0]?.id;

console.log('\n── Idempotency-Key ──');
console.log(`  primer intento ........... ${first.ok ? '2xx' : first.status}`);
console.log(`  reintento misma clave .... ${retry.ok ? '2xx' : retry.status}`);
console.log(`  mismo hold id ............ ${idempOk ? '✅' : '❌'}`);

await cleanup(ctx);
await prisma.$disconnect();

const pass = activeHolds === 1 && heldTickets === 1 && winners.length >= 1 && idempOk;
console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — concurrencia de holds`);
process.exit(pass ? 0 : 1);
