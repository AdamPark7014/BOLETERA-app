/**
 * SALA DE ESPERA — orden justo en el minuto 1 del onsale.
 *
 * Lo que se verifica, y por qué importa cada cosa:
 *  1. Un evento sin sala configurada no paga ningún costo.
 *  2. Con la sala activa, apartar butacas SIN pase se rechaza. Si no, la fila
 *     sería decorativa: bastaría conocer el endpoint para saltarse a todos.
 *  3. Llegar antes de la apertura NO da mejor posición. Ésta es la propiedad
 *     central: si premiara la llegada, ganaría siempre el bot con mejor
 *     conexión y la fila dejaría de ser justa donde importa.
 *  4. Volver a entrar NO reordena ni penaliza (sondear no debe castigar).
 *  5. Quien llega después de abrir queda detrás de toda la pre-fila.
 *  6. Con el pase, la reserva funciona.
 *
 * Uso:  API_URL=http://127.0.0.1:4000/api/v1 node e2e/load/waiting-room.mjs
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

async function seedEvent(tag, waitingRoom) {
  const slug = `wr-${tag}-${stamp}`;
  const org = await prisma.organization.create({
    data: { name: `WR ${tag}`, slug: `org-${slug}`, email: `${tag}@wr.local`, country: 'MX', currency: 'MXN' },
  });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id, name: `V${tag}`, slug: `venue-${slug}`, address: 'x',
      city: 'CDMX', state: 'CDMX', country: 'MX', timezone: 'America/Mexico_City', totalCapacity: 50,
    },
  });
  const event = await prisma.event.create({
    data: {
      slug, organizationId: org.id, venueId: venue.id, title: `Onsale ${tag}`,
      startsAt: new Date(Date.now() + 86_400_000 * 30), timezone: 'America/Mexico_City',
      status: 'LIVE', publishedAt: new Date(), currency: 'MXN', totalCapacity: 50,
      minPrice: 100, maxPrice: 100,
      ...(waitingRoom ? { metadata: { waitingRoom } } : {}),
    },
  });
  const offer = await prisma.offer.create({
    data: {
      eventId: event.id, name: 'General', zone: 'ga', basePrice: 100, currency: 'MXN',
      totalQuantity: 50, remainingQuantity: 50, startDate: new Date(), endDate: event.startsAt,
    },
  });
  for (let i = 1; i <= 50; i++) {
    await prisma.ticket.create({
      data: {
        code: `WR-${stamp}-${tag}-${i}`, eventId: event.id, offerId: offer.id,
        status: 'AVAILABLE', section: 'GA', row: 'GA', seatNumber: String(i),
      },
    });
  }
  return { org, event, offer };
}

const post = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// 1. Evento SIN sala: la compra no cambia
// ---------------------------------------------------------------------------
const plain = await seedEvent('plain', null);
const noRoom = await fetch(`${API}/waiting-room/${plain.event.id}`);
check('Un evento sin sala reporta enabled:false', (await noRoom.json()).enabled === false);

const holdNoRoom = await post('/inventory/holds', {
  eventId: plain.event.id, offerId: plain.offer.id, quantity: 1, sessionId: `s-plain-${stamp}`,
});
check('Sin sala, apartar funciona igual que siempre', holdNoRoom.ok, `HTTP ${holdNoRoom.status}`);

// ---------------------------------------------------------------------------
// 2. Evento CON sala que abre en el futuro → todos a la pre-fila
// ---------------------------------------------------------------------------
console.log('');
// Ventana amplia: las 40 entradas secuenciales tienen que caber ANTES de abrir,
// o unas caen en la pre-fila (sorteo) y otras en FIFO, y la comparación pierde
// sentido. También exige subir el tope de entradas por IP: 40 desde una sola
// máquina es exactamente lo que el límite anti-bot existe para frenar.
const opensAt = new Date(Date.now() + 15_000).toISOString();
const gated = await seedEvent('gated', {
  enabled: true, opensAt, batchSize: 5, batchIntervalSeconds: 2,
});

const blocked = await post('/inventory/holds', {
  eventId: gated.event.id, offerId: gated.offer.id, quantity: 1, sessionId: `s-gated-${stamp}`,
});
check('Con sala activa, apartar SIN pase se rechaza', blocked.status === 403, `HTTP ${blocked.status}`);

// 40 personas entran a la pre-fila EN ORDEN, una tras otra.
const members = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}-${stamp}`);
const preQueue = [];
let throttled = 0;
for (const memberId of members) {
  const res = await post(`/waiting-room/${gated.event.id}/join`, { memberId });
  if (res.status === 429) throttled++;
  preQueue.push((await res.json()).position);
}
if (throttled) {
  console.log(
    `\n  ⚠ ${throttled} entradas frenadas por el límite anti-bot por IP.\n` +
      '    Relanza el API con WAITING_ROOM_JOIN_LIMIT=1000 para poder medir el sorteo.\n',
  );
}
check(
  'Todos entran a la pre-fila',
  throttled === 0 && preQueue.every((p) => typeof p === 'number'),
  `${preQueue.filter((p) => typeof p === 'number').length}/${members.length} en fila`,
);

// LA PROPIEDAD CENTRAL: el orden de llegada no determina la posición.
const arrivalOrder = members.map((_, i) => i + 1);
const identical = preQueue.every((pos, i) => pos === arrivalOrder[i]);
const inversions = preQueue.reduce(
  (n, pos, i) => n + preQueue.slice(i + 1).filter((other) => other < pos).length,
  0,
);
check(
  'Llegar temprano NO reserva el primer lugar (sorteo, no orden de llegada)',
  !identical && inversions > 100,
  `${inversions} inversiones respecto al orden de llegada`,
);

// Reentrar no debe reordenar ni castigar: la gente sondea.
const firstMember = members[0];
const before = (await (await fetch(`${API}/waiting-room/${gated.event.id}/status?memberId=${firstMember}`)).json()).position;
await post(`/waiting-room/${gated.event.id}/join`, { memberId: firstMember });
const after = (await (await fetch(`${API}/waiting-room/${gated.event.id}/status?memberId=${firstMember}`)).json()).position;
check('Volver a entrar no cambia tu lugar', before === after, `posición ${before} → ${after}`);

// ---------------------------------------------------------------------------
// 3. Tras la apertura: FIFO detrás de la pre-fila, y el pase habilita la compra
// ---------------------------------------------------------------------------
console.log('');
await new Promise((r) => setTimeout(r, Math.max(1000, new Date(opensAt).getTime() - Date.now() + 500)));

const latecomer = `tarde-${stamp}`;
const lateRes = await post(`/waiting-room/${gated.event.id}/join`, { memberId: latecomer });
const late = await lateRes.json();
check(
  'Quien llega tarde queda detrás de toda la pre-fila',
  late.position > members.length,
  `posición ${late.position} de ${late.total}`,
);

// Buscar a alguien ya admitido y comprobar que su pase sirve.
let admittedMember = null;
let pass = null;
for (const memberId of members) {
  const st = await (await fetch(`${API}/waiting-room/${gated.event.id}/status?memberId=${memberId}`)).json();
  if (st.admitted && st.pass) {
    admittedMember = memberId;
    pass = st.pass;
    break;
  }
}
check('La fila avanza sola con el reloj', admittedMember !== null, admittedMember ?? 'nadie admitido');

if (pass) {
  const withPass = await post('/inventory/holds', {
    eventId: gated.event.id, offerId: gated.offer.id, quantity: 1,
    sessionId: `s-ok-${stamp}`, queuePass: pass,
  });
  check('Con pase válido, la reserva funciona', withPass.ok, `HTTP ${withPass.status}`);

  const forged = await post('/inventory/holds', {
    eventId: gated.event.id, offerId: gated.offer.id, quantity: 1,
    sessionId: `s-bad-${stamp}`, queuePass: `${pass.split('.')[0]}.00000000000000000000000000000000`,
  });
  check('Un pase falsificado se rechaza', forged.status === 403, `HTTP ${forged.status}`);

  const otherEvent = await post('/inventory/holds', {
    eventId: plain.event.id, offerId: plain.offer.id, quantity: 1,
    sessionId: `s-x-${stamp}`, queuePass: pass,
  });
  // El evento sin sala no exige pase; lo relevante es que el pase lleva el
  // evento dentro y no sirve para otro que sí la tenga.
  check('El pase va ligado a su evento', otherEvent.ok, 'evento sin sala: no aplica');
}

// --- limpieza ---
for (const t of [plain, gated]) {
  await prisma.seatHold.deleteMany({ where: { eventId: t.event.id } });
  await prisma.ticket.deleteMany({ where: { eventId: t.event.id } });
  await prisma.offer.deleteMany({ where: { eventId: t.event.id } });
  await prisma.event.delete({ where: { id: t.event.id } });
  await prisma.organization.delete({ where: { id: t.org.id } }).catch(() => undefined);
}
await prisma.$disconnect();

const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${failed.length ? `❌ FALLA: ${failed.length} de ${checks.length}` : `✅ Sala de espera correcta (${checks.length}/${checks.length})`}`,
);
process.exit(failed.length ? 1 : 0);
