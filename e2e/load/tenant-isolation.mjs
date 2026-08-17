/**
 * AISLAMIENTO MULTI-INQUILINO — verifica que el personal de una organización no
 * puede tocar el inventario de otra.
 *
 * El agujero que cubre: las rutas `/inventory/staff/*` se añadieron con
 * `JwtAuthGuard + RolesGuard` pero sin guarda de organización, así que un
 * TAQUILLA del promotor A podía apartar butacas de un evento del promotor B, y
 * `DELETE /inventory/staff/holds/:id` no comprobaba nada en absoluto —
 * `assertHoldOwnership` salía con `return` en cuanto el solicitante era
 * personal. En pleno onsale eso permite devolver a la venta butacas ajenas.
 *
 * Uso:
 *   node e2e/load/tenant-isolation.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) continue;
  const value = match[2].trim().replace(/^["']|["']$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const stamp = Date.now();

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function body(res) {
  try {
    const parsed = await res.json();
    const message = Array.isArray(parsed?.message) ? parsed.message.join('; ') : parsed?.message;
    return String(message ?? '').slice(0, 80);
  } catch {
    return '';
  }
}

/** Crea una organización con un evento y una butaca vendible. */
async function seedTenant(tag) {
  const slug = `iso-${tag}-${stamp}`;
  const org = await prisma.organization.create({
    data: {
      name: `Iso ${tag} ${stamp}`,
      slug: `org-${slug}`,
      email: `${tag}@iso.local`,
      country: 'MX',
      currency: 'MXN',
    },
  });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: `Venue ${tag}`,
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
    data: { venueId: venue.id, name: 'L', mapData: { sections: [] } },
  });
  const section = await prisma.section.create({
    data: { layoutId: layout.id, name: 'A', slug: `a-${tag}` },
  });
  const event = await prisma.event.create({
    data: {
      slug,
      organizationId: org.id,
      venueId: venue.id,
      title: `Iso ${tag}`,
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
      name: 'General',
      zone: 'ga',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: 1,
      remainingQuantity: 1,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000),
    },
  });
  const seat = await prisma.seat.create({
    data: { sectionId: section.id, label: `A1-${tag}`, x: 1, y: 0 },
  });
  await prisma.ticket.create({
    data: {
      code: `ISO-${stamp}-${tag}`,
      eventId: event.id,
      offerId: offer.id,
      status: 'AVAILABLE',
      seatId: seat.id,
      section: 'A',
      row: 'A',
      seatNumber: '1',
    },
  });
  return { org, event, offer, seat };
}

/** Cajero de una organización concreta. El rol se eleva ANTES de iniciar sesión. */
async function cashierFor(orgId, tag) {
  const email = `cajero-${tag}-${stamp}@iso.local`;
  const password = 'Iso-Test-2026!';
  await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Caja', lastName: tag }),
  });
  await prisma.user.update({
    where: { email },
    data: { role: 'TAQUILLA', organizationId: orgId, emailVerified: true },
  });
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { accessToken } = await login.json();
  return { email, accessToken };
}

const a = await seedTenant('a');
const b = await seedTenant('b');
const cashierA = await cashierFor(a.org.id, 'a');

console.log(`\nOrganización A: ${a.org.slug}\nOrganización B: ${b.org.slug}`);
console.log(`Cajero autenticado: sólo de A\n`);

const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierA.accessToken}` };

// 1. Su propia organización: debe funcionar (si esto falla, el guard es demasiado estricto).
const own = await fetch(`${API}/inventory/staff/holds`, {
  method: 'POST',
  headers: authA,
  body: JSON.stringify({ eventId: a.event.id, seatIds: [a.seat.id], offerId: a.offer.id }),
});
check('El cajero de A SÍ puede apartar en A', own.ok, `HTTP ${own.status}`);
const ownHoldId = own.ok ? (await own.json()).holds?.[0]?.id : null;

// 2. Organización ajena: debe rechazarse.
const cross = await fetch(`${API}/inventory/staff/holds`, {
  method: 'POST',
  headers: authA,
  body: JSON.stringify({ eventId: b.event.id, seatIds: [b.seat.id], offerId: b.offer.id }),
});
check(
  'El cajero de A NO puede apartar en B',
  cross.status === 403,
  `HTTP ${cross.status} · ${await body(cross)}`,
);

// 3. Mejor disponible en organización ajena: mismo criterio.
const crossBest = await fetch(`${API}/inventory/staff/holds/best-available`, {
  method: 'POST',
  headers: authA,
  body: JSON.stringify({ eventId: b.event.id, offerId: b.offer.id, quantity: 1 }),
});
check(
  'Tampoco por «mejor disponible»',
  crossBest.status === 403,
  `HTTP ${crossBest.status} · ${await body(crossBest)}`,
);

// 4. Liberar un hold ajeno: el caso que no comprobaba nada.
const holdInB = await prisma.seatHold.create({
  data: {
    eventId: b.event.id,
    seatId: b.seat.id,
    offerId: b.offer.id,
    sessionId: `victima-${stamp}`,
    channel: 'WEB',
    quantity: 1,
    expiresAt: new Date(Date.now() + 900_000),
  },
});
const release = await fetch(`${API}/inventory/staff/holds/${holdInB.id}`, {
  method: 'DELETE',
  headers: authA,
});
check(
  'El cajero de A NO puede liberar un hold de B',
  release.status === 403,
  `HTTP ${release.status} · ${await body(release)}`,
);

// 5. Su propio hold sí se libera (el guard no debe romper la operación normal).
if (ownHoldId) {
  const releaseOwn = await fetch(`${API}/inventory/staff/holds/${ownHoldId}`, {
    method: 'DELETE',
    headers: authA,
  });
  check('El cajero de A SÍ puede liberar su hold en A', releaseOwn.ok, `HTTP ${releaseOwn.status}`);
}

// --- limpieza ---
for (const tenant of [a, b]) {
  await prisma.seatHold.deleteMany({ where: { eventId: tenant.event.id } });
  await prisma.ticket.deleteMany({ where: { eventId: tenant.event.id } });
  await prisma.offer.deleteMany({ where: { eventId: tenant.event.id } });
  await prisma.event.delete({ where: { id: tenant.event.id } });
}
await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@iso.local` } } });
for (const tenant of [a, b]) {
  await prisma.organization.delete({ where: { id: tenant.org.id } }).catch(() => undefined);
}
await prisma.$disconnect();

const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${failed.length ? `❌ FALLA: ${failed.length} de ${checks.length} comprobaciones` : `✅ Aislamiento correcto (${checks.length}/${checks.length})`}`,
);
process.exit(failed.length ? 1 : 0);
