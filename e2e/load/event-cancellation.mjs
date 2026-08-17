/**
 * CANCELACIÓN DE EVENTO — cumplimiento del art. 92 Bis de la LFPC.
 *
 * Este flujo no existía: se podía vender un evento pero no cancelarlo. El
 * escenario que la ley regula era el único que el sistema no sabía ejecutar.
 *
 * Lo que se verifica:
 *  1. La previsualización (`dryRun`) proyecta el impacto SIN mover dinero.
 *  2. Cancelar devuelve el importe COMPLETO cobrado, cargos por servicio
 *     incluidos.
 *  3. Si la causa es imputable al promotor, se asienta además la bonificación
 *     mínima del 20% — como asiento aparte, porque no es devolución del cobro.
 *  4. Si NO es imputable, hay reembolso pero NO bonificación... y exige
 *     justificación, porque de ella depende el dinero.
 *  5. Se cierra la venta: las ofertas dejan de estar disponibles.
 *  6. El inventario vuelve a estar libre.
 *
 * Uso:  API_URL=http://127.0.0.1:4001/api/v1 node e2e/load/event-cancellation.mjs
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

async function body(res) {
  try {
    const b = await res.json();
    const m = Array.isArray(b?.message) ? b.message.join('; ') : b?.message;
    return String(m ?? JSON.stringify(b)).slice(0, 120);
  } catch {
    return '';
  }
}

/** Evento con una orden ya pagada, que es el estado que la ley contempla. */
async function seedSoldEvent(tag, ticketPrice, fees) {
  const slug = `cancel-${tag}-${stamp}`;
  const org = await prisma.organization.create({
    data: {
      name: `Cancel ${tag} ${stamp}`,
      slug: `org-${slug}`,
      email: `${tag}@cancel.local`,
      country: 'MX',
      currency: 'MXN',
    },
  });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: `V ${tag}`,
      slug: `venue-${slug}`,
      address: 'x',
      city: 'CDMX',
      state: 'CDMX',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 2,
    },
  });
  const event = await prisma.event.create({
    data: {
      slug,
      organizationId: org.id,
      venueId: venue.id,
      title: `Concierto ${tag}`,
      startsAt: new Date(Date.now() + 86_400_000 * 30),
      timezone: 'America/Mexico_City',
      status: 'LIVE',
      publishedAt: new Date(),
      currency: 'MXN',
      totalCapacity: 2,
      minPrice: ticketPrice,
      maxPrice: ticketPrice,
    },
  });
  const offer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'General',
      zone: 'ga',
      basePrice: ticketPrice,
      currency: 'MXN',
      totalQuantity: 2,
      remainingQuantity: 1,
      soldQuantity: 1,
      startDate: new Date(),
      endDate: event.startsAt,
    },
  });

  const user = await prisma.user.create({
    data: {
      email: `comprador-${tag}-${stamp}@cancel.local`,
      firstName: 'Com',
      lastName: 'Prador',
    },
  });

  // El cobro liquidado incluye cargos por servicio: es lo que hay que devolver.
  const charged = ticketPrice + fees;
  const payment = await prisma.payment.create({
    data: {
      gateway: 'BANORTE',
      externalId: `pay-${slug}`,
      status: 'COMPLETED',
      amount: charged,
      currency: 'MXN',
      method: 'CARD',
      processedAt: new Date(),
    },
  });
  const order = await prisma.order.create({
    data: {
      publicId: `ORD-CANCEL-${tag.toUpperCase()}-${stamp}`,
      organizationId: org.id,
      eventId: event.id,
      userId: user.id,
      status: 'COMPLETED',
      buyerEmail: user.email,
      buyerName: 'Com Prador',
      subtotal: ticketPrice,
      fees,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: charged,
      commissionAmount: 0,
      currency: 'MXN',
      paymentId: payment.id,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      items: { create: [{ offerId: offer.id, quantity: 1, unitPrice: ticketPrice, unitFees: fees, subtotal: charged }] },
    },
    include: { items: true },
  });
  await prisma.ticket.create({
    data: {
      code: `CAN-${stamp}-${tag}`,
      eventId: event.id,
      offerId: offer.id,
      status: 'SOLD',
      orderItemId: order.items[0].id,
      buyerEmail: user.email,
      buyerName: 'Com Prador',
      section: 'GA',
      row: 'GA',
      seatNumber: '1',
    },
  });

  return { org, event, offer, order, user, charged };
}

async function staffFor(orgId, tag) {
  const email = `admin-${tag}-${stamp}@cancel.local`;
  const password = 'Cancel-Test-2026!';
  await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Ad', lastName: 'Min' }),
  });
  await prisma.user.update({
    where: { email },
    data: { role: 'ADMIN', organizationId: orgId, emailVerified: true },
  });
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await login.json()).accessToken;
}

const PRICE = 1000;
const FEES = 150; // cargo por servicio: la ley obliga a devolverlo también

// ---------------------------------------------------------------------------
// Caso A: cancelación IMPUTABLE al promotor → reembolso + bonificación 20%
// ---------------------------------------------------------------------------
const a = await seedSoldEvent('a', PRICE, FEES);
const tokenA = await staffFor(a.org.id, 'a');
const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };

console.log(`\nCobro liquidado por orden: $${a.charged} (boleto $${PRICE} + cargos $${FEES})\n`);

const preview = await fetch(`${API}/payments/events/${a.event.id}/cancel`, {
  method: 'POST',
  headers: authA,
  body: JSON.stringify({ reason: 'El artista canceló la gira', attributable: true }),
});
const previewBody = preview.ok ? await preview.json() : null;
check(
  'La previsualización proyecta sin mover dinero',
  preview.ok && previewBody?.dryRun === true,
  previewBody ? `devolución $${previewBody.refundableTotal} + bonificación $${previewBody.compensationTotal}` : await body(preview),
);

const refundsBeforeExec = await prisma.refund.count({ where: { orderId: a.order.id } });
check('La previsualización NO asentó ningún reembolso', refundsBeforeExec === 0, `${refundsBeforeExec} asientos`);

const exec = await fetch(`${API}/payments/events/${a.event.id}/cancel`, {
  method: 'POST',
  headers: authA,
  body: JSON.stringify({ reason: 'El artista canceló la gira', attributable: true, dryRun: false }),
});
const execBody = exec.ok ? await exec.json() : null;
check('La cancelación se ejecuta', exec.ok, execBody ? `${execBody.ordersRefunded}/${execBody.ordersAffected} devueltas` : await body(exec));

const refunds = await prisma.refund.findMany({ where: { orderId: a.order.id } });
const refundTotal = refunds.reduce((s, r) => s + Number(r.amount), 0);
const compensation = refunds.find((r) => (r.notes ?? '').includes('BONIFICACIÓN'));
const plainRefund = refunds.find((r) => !(r.notes ?? '').includes('BONIFICACIÓN'));

check(
  'Devuelve el cobro COMPLETO, cargos incluidos',
  plainRefund !== undefined && Math.abs(Number(plainRefund.amount) - a.charged) < 0.01,
  `$${plainRefund ? Number(plainRefund.amount) : 0} de $${a.charged}`,
);
check(
  'Asienta la bonificación del 20% (art. 92 Bis)',
  compensation !== undefined && Math.abs(Number(compensation.amount) - a.charged * 0.2) < 0.01,
  `$${compensation ? Number(compensation.amount) : 0}`,
);
check('El total sale al 120% de lo cobrado', Math.abs(refundTotal - a.charged * 1.2) < 0.01, `$${refundTotal.toFixed(2)}`);

const eventAfter = await prisma.event.findUnique({ where: { id: a.event.id } });
const offerAfter = await prisma.offer.findUnique({ where: { id: a.offer.id } });
check('El evento queda CANCELLED', eventAfter?.status === 'CANCELLED', String(eventAfter?.status));
check('Se cierra la venta (oferta no disponible)', offerAfter?.isAvailable === false);

const freedTickets = await prisma.ticket.count({
  where: { eventId: a.event.id, status: 'AVAILABLE' },
});
check('El inventario se libera', freedTickets >= 1, `${freedTickets} boletos libres`);

// ---------------------------------------------------------------------------
// Caso B: causa NO imputable → reembolso sí, bonificación no
// ---------------------------------------------------------------------------
const b = await seedSoldEvent('b', PRICE, FEES);
const tokenB = await staffFor(b.org.id, 'b');
const authB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` };

console.log('');
const noJustification = await fetch(`${API}/payments/events/${b.event.id}/cancel`, {
  method: 'POST',
  headers: authB,
  body: JSON.stringify({ reason: 'Huracán', attributable: false, dryRun: false }),
});
check(
  'Una causa no imputable SIN justificar se rechaza',
  noJustification.status === 400,
  await body(noJustification),
);

const execB = await fetch(`${API}/payments/events/${b.event.id}/cancel`, {
  method: 'POST',
  headers: authB,
  body: JSON.stringify({
    reason: 'Huracán categoría 4',
    attributable: false,
    justification: 'Aviso de Protección Civil del 2026-08-16',
    dryRun: false,
  }),
});
check('Con justificación se ejecuta', execB.ok, await body(execB));

const refundsB = await prisma.refund.findMany({ where: { orderId: b.order.id } });
const totalB = refundsB.reduce((s, r) => s + Number(r.amount), 0);
check('Devuelve el cobro completo', Math.abs(totalB - b.charged) < 0.01, `$${totalB.toFixed(2)}`);
check(
  'NO paga bonificación por causa no imputable',
  !refundsB.some((r) => (r.notes ?? '').includes('BONIFICACIÓN')),
);

// ---------------------------------------------------------------------------
// Caso C: no se puede bajar del mínimo legal
// ---------------------------------------------------------------------------
const c = await seedSoldEvent('c', PRICE, FEES);
const tokenC = await staffFor(c.org.id, 'c');
console.log('');
const belowMinimum = await fetch(`${API}/payments/events/${c.event.id}/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenC}` },
  body: JSON.stringify({ reason: 'x', attributable: true, compensationRate: 0.05, dryRun: false }),
});
check(
  'Rechaza una bonificación por debajo del 20% legal',
  belowMinimum.status === 400,
  await body(belowMinimum),
);

// --- limpieza ---
for (const t of [a, b, c]) {
  await prisma.refund.deleteMany({ where: { orderId: t.order.id } });
  await prisma.ticket.deleteMany({ where: { eventId: t.event.id } });
  await prisma.orderItem.deleteMany({ where: { orderId: t.order.id } });
  await prisma.order.deleteMany({ where: { eventId: t.event.id } });
  await prisma.payment.deleteMany({ where: { externalId: `pay-cancel-${t.event.slug.split('-')[1]}-${stamp}` } });
  await prisma.offer.deleteMany({ where: { eventId: t.event.id } });
  await prisma.event.delete({ where: { id: t.event.id } });
}
await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@cancel.local` } } });
for (const t of [a, b, c]) {
  await prisma.organization.delete({ where: { id: t.org.id } }).catch(() => undefined);
}
await prisma.$disconnect();

const failed = checks.filter((x) => !x.pass);
console.log(
  `\n${failed.length ? `❌ FALLA: ${failed.length} de ${checks.length}` : `✅ Cumplimiento LFPC art. 92 Bis (${checks.length}/${checks.length})`}`,
);
process.exit(failed.length ? 1 : 0);
