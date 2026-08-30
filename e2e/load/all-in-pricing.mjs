/**
 * PRECIO TOTAL DESDE LA PRIMERA PANTALLA.
 *
 * El precio «desde» del catálogo salía de `Offer.basePrice`, sin el cargo por
 * servicio ni el IVA: se anunciaba «Desde $1,000» y en el checkout aparecían
 * $1,260. Un 26% de diferencia.
 *
 * Eso es el *drip pricing* que la FTC prohibió en mayo de 2025 —y por el que
 * demandó a Ticketmaster ese septiembre— y lo que la LFPC exige mostrar como
 * precio total en México.
 *
 * La propiedad que se verifica es una sola y es la que importa:
 * EL PRECIO QUE SE ANUNCIA ES EL QUE SE COBRA.
 *
 * Uso:  API_URL=http://127.0.0.1:4000/api/v1 node e2e/load/all-in-pricing.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const stamp = Date.now();

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const BASE = 1000;

const org = await prisma.organization.create({
  data: {
    name: `AllIn ${stamp}`, slug: `org-allin-${stamp}`,
    email: 'allin@test.local', country: 'MX', currency: 'MXN',
  },
});
const venue = await prisma.venue.create({
  data: {
    organizationId: org.id, name: 'V', slug: `venue-allin-${stamp}`, address: 'x',
    city: 'CDMX', state: 'CDMX', country: 'MX', timezone: 'America/Mexico_City', totalCapacity: 10,
  },
});
const event = await prisma.event.create({
  data: {
    slug: `allin-${stamp}`, organizationId: org.id, venueId: venue.id, title: `AllIn ${stamp}`,
    startsAt: new Date(Date.now() + 86_400_000 * 30), timezone: 'America/Mexico_City',
    status: 'LIVE', publishedAt: new Date(), currency: 'MXN', totalCapacity: 10,
    minPrice: BASE, maxPrice: BASE,
  },
});
const offer = await prisma.offer.create({
  data: {
    eventId: event.id, name: 'General', zone: 'ga', basePrice: BASE, currency: 'MXN',
    totalQuantity: 10, remainingQuantity: 10, startDate: new Date(), endDate: event.startsAt,
  },
});

console.log(`\nPrecio base de la oferta: $${BASE}\n`);

// 1. La ficha del evento anuncia el precio final.
const detail = await (await fetch(`${API}/discovery/events/${event.slug}`)).json();
const announced = Number(detail.minPriceAllIn);
check('La ficha del evento expone el precio final', Number.isFinite(announced) && announced > 0, `$${announced}`);
check(
  'El precio anunciado NO es el precio base pelado',
  Math.abs(announced - BASE) > 0.01,
  `$${announced} vs base $${BASE}`,
);

// 2. Ese precio coincide con lo que el motor de precios cobra de verdad.
const quoted = await (
  await fetch(`${API}/pricing/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: event.id, offerId: offer.id, quantity: 1 }),
  })
).json();
const charged = Number(quoted.total ?? quoted.data?.total);

check(
  'LO ANUNCIADO ES LO QUE SE COBRA',
  Number.isFinite(charged) && Math.abs(announced - charged) < 0.01,
  `anunciado $${announced} · cobrado $${charged}`,
);

// 3. El desglose cuadra con el total.
const breakdown = detail.minPriceBreakdown;
if (breakdown) {
  const sum = Number(breakdown.base) + Number(breakdown.fees) + Number(breakdown.taxes);
  check(
    'El desglose suma exactamente el total',
    Math.abs(sum - announced) < 0.01,
    `${breakdown.base} + ${breakdown.fees} + ${breakdown.taxes} = ${sum.toFixed(2)}`,
  );
  check('El desglose nombra el cargo y el impuesto por separado', Number(breakdown.fees) > 0 && Number(breakdown.taxes) > 0);
}

// 4. Cada zona lleva su precio final, no solo la más barata.
const offerRow = (detail.offers ?? []).find((o) => o.id === offer.id);
check(
  'Cada zona expone su propio precio final',
  offerRow && Math.abs(Number(offerRow.allInPrice) - announced) < 0.01,
  offerRow ? `$${offerRow.allInPrice}` : 'sin oferta',
);

// 5. El catálogo también, no solo la ficha.
//
// El listado se acota por inquilino a partir del `Host`, así que el evento de
// prueba (de una organización nueva) no aparece ahí — y eso es correcto. La
// propiedad se verifica sobre el catálogo real del inquilino por defecto: toda
// fila con precio debe anunciar el final, y debe cuadrar con su propio base.
const list = await (await fetch(`${API}/discovery/events?limit=20`)).json();
const rows = Array.isArray(list) ? list : (list.items ?? list.events ?? []);
const priced = rows.filter((e) => Number(e.minPrice) > 0);

check('El catálogo devuelve eventos con precio', priced.length > 0, `${priced.length} filas`);

const missing = priced.filter((e) => !Number.isFinite(Number(e.minPriceAllIn)));
check('Toda fila del catálogo expone el precio final', missing.length === 0, `${missing.length} sin él`);

const inconsistent = priced.filter((e) => {
  const expected = Number(e.minPrice) * (1 + 0.1 + 0.16);
  return Math.abs(Number(e.minPriceAllIn) - expected) > 0.02;
});
check(
  'El precio final del catálogo cuadra con su base',
  inconsistent.length === 0,
  inconsistent.length ? `${inconsistent[0].slug}: ${inconsistent[0].minPrice} → ${inconsistent[0].minPriceAllIn}` : 'todas cuadran',
);

const anyRow = priced[0];
if (anyRow) {
  check(
    'Y es estrictamente mayor que el base (no se anuncia el pelado)',
    Number(anyRow.minPriceAllIn) > Number(anyRow.minPrice),
    `${anyRow.slug}: $${anyRow.minPrice} → $${anyRow.minPriceAllIn}`,
  );
}

// --- limpieza ---
await prisma.offer.deleteMany({ where: { eventId: event.id } });
await prisma.event.delete({ where: { id: event.id } });
await prisma.venue.delete({ where: { id: venue.id } });
await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
await prisma.$disconnect();

const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${failed.length ? `❌ FALLA: ${failed.length} de ${checks.length}` : `✅ Precio total correcto (${checks.length}/${checks.length})`}`,
);
process.exit(failed.length ? 1 : 0);
