/**
 * TRANSFERENCIA DE BOLETOS — lo que pasa después de regalar tu entrada.
 *
 * La transferencia es la única forma legítima de dar un boleto a alguien: el QR
 * rota cada 15 s, así que mandar una captura no sirve. Por eso importa que
 * funcione bien, y sobre todo que el que lo regala DEJE de poder entrar.
 *
 * Lo que se verifica:
 *  1. Se puede iniciar una transferencia de un boleto propio.
 *  2. Quien no es dueño NO puede transferirlo.
 *  3. Al aceptarla, el boleto cambia de dueño.
 *  4. EL QUE LO REGALÓ YA NO PUEDE ENTRAR.  ← el que de verdad importa
 *  5. No se puede transferir el mismo boleto a dos personas a la vez.
 *
 * Uso:  API_URL=http://127.0.0.1:4000/api/v1 node e2e/load/ticket-transfer.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`);
};

/** Lo mismo que hace el teléfono. */
const qrDe = (keyHex, ticketId, eventId, nowMs = Date.now()) =>
  JSON.stringify({
    v: 2, t: ticketId, e: eventId,
    s: 'v2.' + createHmac('sha256', Buffer.from(keyHex, 'hex'))
      .update(`v2:${ticketId}:${eventId}:${Math.floor(nowMs / 15000)}`)
      .digest('hex').slice(0, 32),
  });

async function login(email, password = 'Admin123!') {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  return j.accessToken;
}

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function main() {
  console.log(`\nTransferencia de boletos · ${API}\n`);

  // --- localizar un boleto vivo y a su dueño ---------------------------------
  // Se parte de las ORDENES de usuarios de demo, no de los boletos a ciegas:
  // un `take` sobre Ticket puede agotar el cupo en filas que nunca calificaran
  // (sin dueño, o de usuarios cuya contraseña aqui no se conoce).
  const ordenesDemo = await prisma.order.findMany({
    where: {
      status: 'COMPLETED',
      user: { email: { endsWith: '@demo.boletera.mx' } },
    },
    select: {
      publicId: true,
      userId: true,
      items: {
        select: {
          tickets: {
            where: { status: 'SOLD' },
            include: { event: { select: { id: true, title: true, transferAllowed: true } } },
          },
        },
      },
    },
    take: 100,
  });
  const candidatos = ordenesDemo.flatMap((o) =>
    o.items.flatMap((i) =>
      i.tickets.map((t) => ({
        ...t,
        orderItem: { order: { userId: o.userId, publicId: o.publicId } },
      })),
    ),
  );
  // El boleto tiene que seguir EN MANOS del dueño de la orden: uno transferido
  // en una corrida anterior ya no aparece en su cartera (correctamente) y la
  // prueba se caería por falta de clave, no por un defecto.
  const duenos = new Map(
    (await prisma.user.findMany({
      where: { id: { in: candidatos.map((t) => t.orderItem?.order?.userId).filter(Boolean) } },
      select: { id: true, email: true },
    })).map((u) => [u.id, u.email.toLowerCase()]),
  );
  const ticket = candidatos.find((t) => {
    const uid = t.orderItem?.order?.userId;
    if (!uid) return false;
    const emailDueno = duenos.get(uid);
    // Solo dueños de demo: de los demás no se conoce la contraseña y el login
    // devolvería 401, tirando toda la prueba por un problema de datos.
    if (!emailDueno?.endsWith('@demo.boletera.mx')) return false;
    return !t.buyerEmail || t.buyerEmail.toLowerCase() === emailDueno;
  });
  if (!ticket) throw new Error('no hay boletos SOLD aún en manos de su comprador de demo');

  const dueño = await prisma.user.findUnique({ where: { id: ticket.orderItem.order.userId } });
  // Solo usuarios de demo: los residuales de otras pruebas de carga tienen
  // contraseñas que aqui no se conocen, y un 401 al aceptar haria que el caso
  // clave (el que regala ya no entra) pasara EN VACIO — que es peor que fallar.
  const destinatario = await prisma.user.findFirst({
    where: { email: { not: dueño.email, endsWith: '@demo.boletera.mx' }, role: 'CUSTOMER' },
  });
  if (!destinatario) throw new Error('no hay un segundo usuario de demo para recibir');

  // El evento tiene que permitir transferencias para que la prueba tenga sentido.
  if (!ticket.event.transferAllowed) {
    await prisma.event.update({ where: { id: ticket.event.id }, data: { transferAllowed: true } });
  }

  console.log(`  boleto ${ticket.code}`);
  console.log(`  de ${dueño.email} → ${destinatario.email}\n`);

  const tokenDueño = await login(dueño.email);
  const tokenDest = await login(destinatario.email);
  const tokenStaff = await login('admin@demo.boletera.com');

  // --- la clave que YA tiene el teléfono del que regala ----------------------
  const wRes = await fetch(`${API}/orders/${ticket.orderItem.order.publicId}/wallet`, {
    headers: auth(tokenDueño),
  });
  const wallet = await wRes.json();
  const enCartera = wallet.tickets?.find((t) => t.id === ticket.id);
  check('la cartera del dueño trae el boleto', Boolean(enCartera?.signingKey));
  const claveDelQueRegala = enCartera?.signingKey;

  // ---------------------------------------------------------------------------
  console.log('\n1. Quien NO es dueño no puede transferirlo');
  // ---------------------------------------------------------------------------
  let r = await fetch(`${API}/tickets/transfer`, {
    method: 'POST', headers: auth(tokenDest),
    body: JSON.stringify({ ticketId: ticket.id, toEmail: 'cualquiera@demo.mx' }),
  });
  check('un tercero no puede regalar tu boleto', r.status === 401 || r.status === 403, `HTTP ${r.status}`);

  // ---------------------------------------------------------------------------
  console.log('\n2. El dueño inicia la transferencia');
  // ---------------------------------------------------------------------------
  r = await fetch(`${API}/tickets/transfer`, {
    method: 'POST', headers: auth(tokenDueño),
    body: JSON.stringify({ ticketId: ticket.id, toEmail: destinatario.email }),
  });
  const transfer = await r.json();
  check('se crea la transferencia', r.ok && Boolean(transfer.transferCode), `HTTP ${r.status}`);

  // ---------------------------------------------------------------------------
  console.log('\n3. No se puede regalar el MISMO boleto dos veces');
  // ---------------------------------------------------------------------------
  const otro = await prisma.user.findFirst({
    where: {
      email: { notIn: [dueño.email, destinatario.email], endsWith: '@demo.boletera.mx' },
      role: 'CUSTOMER',
    },
  });
  r = await fetch(`${API}/tickets/transfer`, {
    method: 'POST', headers: auth(tokenDueño),
    body: JSON.stringify({ ticketId: ticket.id, toEmail: otro?.email ?? 'tercero@demo.mx' }),
  });
  const segunda = await r.json();
  check(
    'una segunda transferencia simultánea se rechaza',
    !r.ok,
    r.ok ? `SE CREÓ OTRA (${segunda.transferCode}) — dos personas pueden reclamar el mismo boleto` : `HTTP ${r.status}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n4. El destinatario acepta');
  // ---------------------------------------------------------------------------
  r = await fetch(`${API}/tickets/transfer/accept`, {
    method: 'POST', headers: auth(tokenDest),
    body: JSON.stringify({ transferCode: transfer.transferCode }),
  });
  const aceptada = await r.json();
  check('la transferencia se acepta', r.ok, `HTTP ${r.status}`);

  const trasAceptar = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  check(
    'el boleto queda a nombre del destinatario',
    trasAceptar?.buyerEmail?.toLowerCase() === destinatario.email.toLowerCase(),
    `${trasAceptar?.buyerEmail}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n5. EL QUE LO REGALÓ YA NO DEBE PODER ENTRAR');
  // ---------------------------------------------------------------------------
  // Su teléfono conserva la clave que descargó ANTES de regalarlo. Si con ella
  // sigue abriendo la puerta, dos personas entran con el mismo boleto y la
  // segunda se queda fuera sin entender por qué.
  const cambioDeDueño =
    trasAceptar?.buyerEmail?.toLowerCase() === destinatario.email.toLowerCase();
  if (!cambioDeDueño) {
    check(
      'el código del que regaló YA NO abre la puerta',
      false,
      'NO SE PUEDE JUZGAR: la transferencia no llegó a completarse',
    );
    return resumen();
  }

  const qrViejo = qrDe(claveDelQueRegala, ticket.id, ticket.event.id);
  r = await fetch(`${API}/access/scan`, {
    method: 'POST', headers: auth(tokenStaff),
    body: JSON.stringify({ qrPayload: qrViejo }),
  });
  const veredicto = await r.json().catch(() => null);
  const entro = r.ok && veredicto?.success === true;
  check(
    'el código del que regaló YA NO abre la puerta',
    !entro,
    entro
      ? 'ENTRÓ — el mismo boleto sirve a dos personas'
      : String(veredicto?.message ?? `HTTP ${r.status}`).slice(0, 70),
  );

  // ---------------------------------------------------------------------------
  console.log('\n6. Y EL NUEVO DUEÑO SÍ entra (la clave de la época vigente)');
  // ---------------------------------------------------------------------------
  // Invalidar al viejo no vale nada si de paso se dejó fuera al nuevo. Se firma
  // con la época que quedó en la base tras aceptar — que es exactamente la
  // clave que la cartera del destinatario descargará.
  const epoca = (await prisma.ticket.findUnique({
    where: { id: ticket.id },
    select: { keyEpoch: true },
  }))?.keyEpoch ?? 0;
  const secreto = process.env.TICKET_QR_SECRET;
  if (!secreto) {
    check('la clave de la época vigente SÍ abre la puerta', false, 'sin TICKET_QR_SECRET');
  } else {
    const material = epoca > 0
      ? `${ticket.id}:${ticket.event.id}:${epoca}`
      : `${ticket.id}:${ticket.event.id}`;
    const claveVigente = createHmac('sha256', secreto).update(material).digest('hex');
    const qrNuevo = qrDe(claveVigente, ticket.id, ticket.event.id);
    const rNuevo = await fetch(`${API}/access/scan`, {
      method: 'POST', headers: auth(tokenStaff),
      body: JSON.stringify({ qrPayload: qrNuevo }),
    });
    const vNuevo = await rNuevo.json().catch(() => null);
    check(
      'la clave de la época vigente SÍ abre la puerta',
      rNuevo.ok && vNuevo?.success === true,
      String(vNuevo?.message ?? vNuevo?.ticket?.code ?? `HTTP ${rNuevo.status}`).slice(0, 60),
    );
    // El boleto se deja sin usar para que la prueba sea repetible.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'SOLD', checkedInAt: null },
    });
    await prisma.ticketScan.deleteMany({ where: { ticketId: ticket.id } });
  }

  resumen();
}

function resumen() {
  const fallos = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - fallos.length}/${checks.length} comprobaciones\n`);
  if (fallos.length) {
    fallos.forEach((f) => console.log(`  ❌ ${f.n}`));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('\n❌', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
