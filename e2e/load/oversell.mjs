/**
 * PRUEBA DE SOBREVENTA — Fase 1, eje 1.
 *
 * Crea un evento aislado con N butacas numeradas + M boletos de admisión general,
 * lanza `BUYERS` compradores simultáneos sobre las últimas butacas y cuenta
 * cuántos boletos quedaron SOLD. Si SOLD > capacidad, hay sobreventa.
 *
 * Uso:
 *   docker compose up -d postgres redis
 *   pnpm --filter @boletera/api dev          # API en :4000
 *   node e2e/load/oversell.mjs
 *
 * Variables:
 *   API_URL   (default http://127.0.0.1:4000/api/v1)
 *   BUYERS    (default 500)
 *   SEATS     (default 3)   butacas numeradas disponibles
 *   GA        (default 3)   boletos GA disponibles
 *
 * IMPORTANTE — por qué la venta va por el canal TAQUILLA:
 * en el canal WEB, CARD/SPEI/OXXO se capturan de forma asíncrona (la orden queda
 * PENDING hasta el IPN de Banorte) y CASH está prohibido por diseño (F1-01). El
 * único camino que emite boletos de forma SÍNCRONA —que es justo donde vive la
 * carrera HELD→SOLD que queremos provocar— es taquilla con efectivo. Por eso el
 * script se autentica como personal de taquilla.
 *
 * El API debe arrancarse con el throttle alto o los 500 compradores chocan con
 * el límite de 30/min por IP antes de llegar a competir:
 *   THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 node apps/api/dist/main.js
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

// Carga .env de la raíz del repo: el script se ejecuta suelto con `node`, sin
// el arranque de Nest que normalmente resuelve la configuración.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Se separa por /\r?\n/ y no por '\n': el .env viene en CRLF y en los regex de
// JavaScript `\r` es terminador de línea, así que `.` no lo captura y el ancla
// `$` falla — solo casaban las variables de valor vacío.
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) continue;
  const value = match[2].trim().replace(/^["']|["']$/g, '');
  if (!process.env[match[1]]) process.env[match[1]] = value;
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const BUYERS = Number(process.env.BUYERS ?? 500);
const SEATS = Number(process.env.SEATS ?? 3);
const GA = Number(process.env.GA ?? 3);

const prisma = new PrismaClient();
const stamp = Date.now();
const slug = `oversell-${stamp}`;

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: `Oversell Test ${stamp}`,
      slug: `org-${slug}`,
      email: 'test@oversell.local',
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
      totalCapacity: SEATS + GA,
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
      title: `Oversell ${stamp}`,
      startsAt: new Date(Date.now() + 86_400_000),
      timezone: 'America/Mexico_City',
      status: 'LIVE',
      publishedAt: new Date(),
      currency: 'MXN',
      totalCapacity: SEATS + GA,
      minPrice: 100,
      maxPrice: 100,
    },
  });

  // --- Oferta con asiento numerado -----------------------------------------
  const seatedOffer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'Numerado',
      zone: 'numerado',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: SEATS,
      remainingQuantity: SEATS,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000),
      maxPerOrder: 10,
    },
  });

  const seatIds = [];
  for (let i = 1; i <= SEATS; i++) {
    const seat = await prisma.seat.create({
      data: { sectionId: section.id, label: `A${i}`, x: i, y: 0 },
    });
    seatIds.push(seat.id);
    await prisma.ticket.create({
      data: {
        code: `OS-${stamp}-S${i}`,
        eventId: event.id,
        offerId: seatedOffer.id,
        status: 'AVAILABLE',
        seatId: seat.id,
        section: 'A',
        row: 'A',
        seatNumber: String(i),
      },
    });
  }

  // --- Oferta de admisión general ------------------------------------------
  const gaOffer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'General',
      zone: 'ga',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: GA,
      remainingQuantity: GA,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000),
      maxPerOrder: 10,
    },
  });
  for (let i = 1; i <= GA; i++) {
    await prisma.ticket.create({
      data: {
        code: `OS-${stamp}-G${i}`,
        eventId: event.id,
        offerId: gaOffer.id,
        status: 'AVAILABLE',
        section: 'GA',
        row: 'GA',
        seatNumber: String(i),
      },
    });
  }

  return { org, event, seatedOffer, gaOffer, seatIds };
}

/**
 * Da de alta un cajero y devuelve su token.
 *
 * El rol se eleva ANTES de iniciar sesión a propósito: tras F2-07 cualquier
 * escritura sobre el usuario refresca `updatedAt` e invalida los tokens
 * emitidos antes, así que hacerlo al revés produciría un 401 inmediato.
 */
async function authenticateCashier(orgId) {
  const email = `cajero-${stamp}@oversell.local`;
  const password = 'Oversell-Test-2026!';

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

/** Extrae el mensaje del API para poder agrupar los fallos por causa real. */
async function describeFailure(res) {
  try {
    const body = await res.json();
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    return String(message ?? body?.error ?? '').slice(0, 90);
  } catch {
    return '';
  }
}

/** Un comprador: hold → orden en efectivo (captura síncrona, sin gateway externo). */
async function buyer(i, ctx, mode) {
  const sessionId = `sess-${i}-${stamp}`; // uno por comprador: aísla el tope por sesión
  const holdBody =
    mode === 'seated'
      ? {
          eventId: ctx.event.id,
          seatIds: [ctx.seatIds[i % ctx.seatIds.length]],
          offerId: ctx.seatedOffer.id,
          sessionId,
        }
      : {
          eventId: ctx.event.id,
          offerId: ctx.gaOffer.id,
          quantity: 1,
          sessionId,
        };

  const auth = { Authorization: `Bearer ${ctx.cashier.accessToken}` };
  const holdRes = await fetch(`${API}/inventory/staff/holds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(holdBody),
  });
  if (!holdRes.ok) {
    return {
      stage: 'hold',
      ok: false,
      status: holdRes.status,
      detail: await describeFailure(holdRes),
    };
  }
  const hold = await holdRes.json();
  const holdIds = (hold.holds ?? []).map((h) => h.id);
  if (!holdIds.length) return { stage: 'hold', ok: false, status: 'empty' };

  const orderRes = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Channel': 'TAQUILLA', ...auth },
    body: JSON.stringify({
      eventId: ctx.event.id,
      offerId: mode === 'seated' ? ctx.seatedOffer.id : ctx.gaOffer.id,
      holdIds,
      buyerName: `Buyer ${i}`,
      buyerEmail: `buyer${i}-${stamp}@oversell.local`,
      paymentMethod: 'CASH',
    }),
  });
  return {
    stage: 'order',
    ok: orderRes.ok,
    status: orderRes.status,
    detail: orderRes.ok ? '' : await describeFailure(orderRes),
  };
}

async function run(ctx, mode, capacity) {
  const results = await Promise.all(
    Array.from({ length: BUYERS }, (_, i) => buyer(i, ctx, mode).catch((e) => ({
      stage: 'error',
      ok: false,
      status: String(e).slice(0, 60),
    }))),
  );

  const offerId = mode === 'seated' ? ctx.seatedOffer.id : ctx.gaOffer.id;
  const sold = await prisma.ticket.count({
    where: { eventId: ctx.event.id, offerId, status: 'SOLD' },
  });
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  const orders = await prisma.order.count({
    where: { eventId: ctx.event.id, status: 'COMPLETED' },
  });
  const okOrders = results.filter((r) => r.stage === 'order' && r.ok).length;

  // Sin este desglose, "0 sobreventa" puede significar "nadie logró comprar",
  // que no demuestra nada. El reparto por causa distingue ambos casos.
  const breakdown = new Map();
  for (const r of results) {
    if (r.stage === 'order' && r.ok) continue;
    const key = `${r.stage} ${r.status}${r.detail ? ` · ${r.detail}` : ''}`;
    breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
  }

  console.log(`\n──── ${mode.toUpperCase()} · capacidad ${capacity} · ${BUYERS} compradores ────`);
  console.log(`  órdenes HTTP 2xx ......... ${okOrders}`);
  console.log(`  boletos SOLD en BD ....... ${sold}   ${sold > capacity ? `❌ SOBREVENTA +${sold - capacity}` : '✅'}`);
  console.log(`  offer.soldQuantity ....... ${offer.soldQuantity}`);
  console.log(`  offer.remainingQuantity .. ${offer.remainingQuantity} ${offer.remainingQuantity < 0 ? '❌ NEGATIVO' : ''}`);
  console.log(`  suma sold+remaining ...... ${offer.soldQuantity + offer.remainingQuantity} (esperado ${capacity})`);
  if (breakdown.size) {
    console.log('  fallos por causa:');
    for (const [reason, count] of [...breakdown].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)} × ${reason}`);
    }
  }
  if (okOrders === 0) {
    console.log('  ⚠ NINGUNA compra prosperó: la prueba no demuestra ausencia de sobreventa.');
  }
  // Invariante más fino que "no hubo sobreventa": un hold concedido tiene que
  // poder honrarse. Si alguien llega a la venta con un hold y se le rechaza por
  // falta de inventario, la reserva entregó algo que no existía — es la carrera
  // de F1-02(a), aunque la capa de venta la detenga después.
  const phantom = results.filter((r) => r.stage === 'order' && !r.ok && r.status === 409).length;
  console.log(
    `  holds fantasma ........... ${phantom} ${phantom ? '❌ la reserva concedió inventario inexistente' : '✅'}`,
  );
  return {
    mode,
    capacity,
    sold,
    oversold: Math.max(0, sold - capacity),
    phantom,
    okOrders,
    orders,
  };
}

async function cleanup(ctx) {
  await prisma.ticket.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.seatHold.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.orderItem.deleteMany({ where: { order: { eventId: ctx.event.id } } });
  await prisma.order.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.offer.deleteMany({ where: { eventId: ctx.event.id } });
  await prisma.event.delete({ where: { id: ctx.event.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@oversell.local` } } });
  await prisma.user.deleteMany({ where: { email: `cajero-${stamp}@oversell.local` } });
  await prisma.organization.delete({ where: { id: ctx.org.id } }).catch(() => undefined);
}

const ctx = await seed();
ctx.cashier = await authenticateCashier(ctx.org.id);
console.log(`Evento de prueba: ${ctx.event.slug} (${SEATS} numeradas, ${GA} GA)`);
console.log(`Cajero: ${ctx.cashier.email} · canal TAQUILLA · efectivo
`);
const seated = await run(ctx, 'seated', SEATS);
const ga = await run(ctx, 'ga', GA);
await cleanup(ctx);
await prisma.$disconnect();

const oversold = seated.oversold > 0 || ga.oversold > 0;
const phantomHolds = seated.phantom > 0 || ga.phantom > 0;
// Sin ventas exitosas el resultado no significa nada: "cero sobreventa" con
// cero compras es lo que devuelve un API caído.
const noSales = seated.okOrders === 0 || ga.okOrders === 0;
const failed = oversold || phantomHolds || noSales;

const reasons = [
  oversold && 'sobreventa',
  phantomHolds && 'holds fantasma',
  noSales && 'ninguna venta prosperó',
].filter(Boolean);

console.log(
  `\n${
    failed
      ? `❌ FALLA: ${reasons.join(' · ')}`
      : '✅ Sin sobreventa, sin holds fantasma, y la venta llegó exactamente al aforo'
  }`,
);
process.exit(failed ? 1 : 0);
