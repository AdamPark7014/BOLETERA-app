/**
 * ACAPARAMIENTO POR BOTS — identidad de invitado firmada.
 *
 * El tope de boletos por comprador se aplicaba contra el `sessionId` que
 * mandaba el propio cliente, y solo se comprobaba que viniera alguno. Es decir:
 * el limite por comprador se imponia sobre un valor que el comprador elige. Un
 * bot cambiaba de `sessionId` en cada peticion y el tope dejaba de existir.
 *
 * Los lineamientos de PROFECO (DOF, 19-feb-2026) obligan a «proteger los
 * sistemas contra bots y duplicidades».
 *
 * Lo que se verifica:
 *  1. El servidor emite identidades firmadas.
 *  2. Una identidad inventada por el cliente se RECHAZA.
 *  3. Una identidad con la firma manipulada se rechaza (aunque el modo
 *     estricto este apagado: una firma que no cuadra no es un cliente viejo).
 *  4. Con identidad valida, el tope por comprador se respeta.
 *  5. CONTRAPRUEBA: el ataque real —una identidad nueva por peticion— ya no
 *     puede acaparar, porque cada identidad tiene que venir del servidor y esa
 *     emision esta limitada.
 *
 * El API debe correr con el limitador de RAFAGA elevado (10 req/s por omision,
 * y esta prueba dispara en bucle cerrado), y con la emision de identidades
 * limitada para poder comprobar ese tope:
 *
 *   GUEST_SESSION_STRICT=true GUEST_SESSION_ISSUE_LIMIT=10  *   THROTTLE_BURST_LIMIT=100000 THROTTLE_LIMIT=100000 node dist/main.js
 *
 * Entre ejecuciones hay que vaciar los contadores del limitador, que viven en
 * Redis con la clave hasheada y sobreviven al reinicio del API. Ojo: NO basta
 * con borrar `:hits` — el limitador escribe ademas una clave `:blocked` que
 * sigue devolviendo 429 aunque el contador este a cero:
 *
 *   docker exec boletera-redis sh -c 'redis-cli --scan --pattern "{*}:*"  *     | while read k; do redis-cli DEL "$k" > /dev/null; done'
 *
 * Uso:  API_URL=http://127.0.0.1:4001/api/v1 node e2e/load/bot-hoarding.mjs
 *
 * Resultado medido (19-ago-2026):
 *   permisivo  → el bot acaparo 17 boletos
 *   estricto   → el bot acaparo  0 boletos
 *   el comprador honesto topa en 10 con un 409 en ambos modos.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4001/api/v1';
const prisma = new PrismaClient();
const stamp = Date.now();

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function nuevaIdentidad() {
  const res = await fetch(`${API}/inventory/session`, { method: 'POST' });
  if (!res.ok) return { error: res.status };
  return res.json();
}

async function apartar(sessionId, eventId, offerId, quantity = 1) {
  const res = await fetch(`${API}/inventory/holds/best-available`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, offerId, quantity, sessionId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log(`\nAcaparamiento por bots · ${API}\n`);

  // --- siembra ---------------------------------------------------------------
  const org = await prisma.organization.findFirst();
  const venue = await prisma.venue.findFirst({ where: { organizationId: org.id } });
  const event = await prisma.event.create({
    data: {
      slug: `bots-${stamp}`,
      organizationId: org.id,
      venueId: venue.id,
      title: `Bots ${stamp}`,
      category: 'MUSIC',
      startsAt: new Date(Date.now() + 30 * 86_400_000),
      timezone: 'America/Mexico_City',
      status: 'SCHEDULED',
      totalCapacity: 500,
      salesStartAt: new Date(Date.now() - 3_600_000),
      minPrice: 100,
    },
  });
  const offer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'General',
      zone: 'General',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: 200,
      remainingQuantity: 200,
      startDate: new Date(Date.now() - 3_600_000),
      endDate: new Date(Date.now() + 29 * 86_400_000),
    },
  });
  await prisma.ticket.createMany({
    data: Array.from({ length: 200 }, (_, i) => ({
      code: `BOT-${stamp}-${i + 1}`,
      eventId: event.id,
      offerId: offer.id,
      status: 'AVAILABLE',
      section: 'GA',
      row: 'GA',
      seatNumber: String(i + 1),
    })),
  });

  // ---------------------------------------------------------------------------
  console.log('1. El servidor emite identidades firmadas');
  // ---------------------------------------------------------------------------
  const emitida = await nuevaIdentidad();
  check(
    'la ruta de emisión responde',
    Boolean(emitida?.sessionId),
    emitida?.sessionId ? `${emitida.sessionId.slice(0, 24)}…` : `error ${emitida?.error}`,
  );
  check(
    'la identidad va firmada (v2.id.emitido.firma)',
    typeof emitida?.sessionId === 'string' && emitida.sessionId.split('.').length === 4,
    `${emitida?.sessionId?.split('.').length} partes`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n2. Una identidad inventada por el cliente se rechaza');
  // ---------------------------------------------------------------------------
  const inventadaConFormato = `v2.${randomBytes(16).toString('base64url')}.${Date.now()}.firmafalsa`;
  let r = await apartar(inventadaConFormato, event.id, offer.id);
  check(
    'identidad con formato correcto pero firma falsa → rechazada',
    r.status === 400,
    `HTTP ${r.status}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n3. Manipular la firma de una identidad válida se detecta');
  // ---------------------------------------------------------------------------
  const partes = emitida.sessionId.split('.');
  // Se sube el reloj para intentar alargar la vida del token.
  const manipulada = `${partes[0]}.${partes[1]}.${Date.now() + 86_400_000}.${partes[3]}`;
  r = await apartar(manipulada, event.id, offer.id);
  check(
    'cambiar la fecha invalida la firma → rechazada',
    r.status === 400,
    `HTTP ${r.status}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n4. Con identidad válida, el tope por comprador se respeta');
  // ---------------------------------------------------------------------------
  const honesto = await nuevaIdentidad();
  let apartadosHonesto = 0;
  let topeAlcanzado = false;
  // Se registran los codigos reales: si el intento falla, hay que saber si fue
  // el tope por comprador (lo que se prueba) o el limite por IP (otra cosa).
  const codigos = new Map();
  let ultimoMensaje = '';
  for (let i = 0; i < 14; i++) {
    const res = await apartar(honesto.sessionId, event.id, offer.id, 1);
    codigos.set(res.status, (codigos.get(res.status) ?? 0) + 1);
    if (res.status === 201 || res.status === 200) apartadosHonesto++;
    else {
      ultimoMensaje = String(res.body?.message ?? '').slice(0, 70);
      if (res.status === 409) {
        topeAlcanzado = true;
        break;
      }
    }
  }
  const detalle = [...codigos.entries()].map(([c, n]) => `${n}×${c}`).join(' ');
  check(
    'un comprador topa en su límite por comprador (409), no por IP',
    topeAlcanzado,
    `apartó ${apartadosHonesto} · ${detalle}${ultimoMensaje ? ` · «${ultimoMensaje}»` : ''}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n5. CONTRAPRUEBA: el ataque real ya no acapara');
  // ---------------------------------------------------------------------------
  // Ataque tal y como se hacía: una identidad inventada distinta por petición.
  let acaparadosAntiguo = 0;
  for (let i = 0; i < 40; i++) {
    const res = await apartar(`bot-${randomBytes(8).toString('hex')}`, event.id, offer.id, 1);
    if (res.status === 201 || res.status === 200) acaparadosAntiguo++;
  }
  const estricto = process.env.GUEST_SESSION_STRICT === 'true';
  if (estricto) {
    check(
      'identidades sin firma → 0 apartados (modo estricto)',
      acaparadosAntiguo === 0,
      `acaparó ${acaparadosAntiguo}`,
    );
  } else {
    // Sin modo estricto se aceptan por compatibilidad: se documenta el hueco en
    // vez de fingir que no existe.
    check(
      'sin modo estricto las identidades viejas aún pasan (hueco conocido)',
      acaparadosAntiguo > 0,
      `acaparó ${acaparadosAntiguo} · GUEST_SESSION_STRICT=true lo cierra`,
    );
  }

  // La emisión sí está limitada: es el punto estrecho.
  let emitidas = 0;
  let limitadas = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${API}/inventory/session`, { method: 'POST' });
    if (res.ok) emitidas++;
    else if (res.status === 429) limitadas++;
  }
  check(
    'pedir identidades en masa se limita por IP',
    limitadas > 0,
    `${emitidas} emitidas, ${limitadas} rechazadas con 429`,
  );

  // --- limpieza --------------------------------------------------------------
  await prisma.event.delete({ where: { id: event.id } });

  const fallos = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - fallos.length}/${checks.length} comprobaciones\n`);
  if (fallos.length) {
    for (const f of fallos) console.log(`  ❌ ${f.name}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('\n❌', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
