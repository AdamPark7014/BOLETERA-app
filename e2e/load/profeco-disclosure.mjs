/**
 * DIVULGACIÓN PREVIA A LA VENTA — lineamientos de PROFECO (DOF 19-feb-2026).
 *
 * Los lineamientos obligan, para eventos de MÁS DE 20.000 asistentes, a
 * publicar al menos 24 horas antes de la primera venta: plano del recinto con
 * secciones, número de asientos por sección, términos y PRECIO TOTAL por
 * sección. Además exigen disponibilidad real por sección durante cada fase.
 *
 * Lo que se verifica:
 *  1. Un evento POR DEBAJO del umbral no queda bloqueado: la ley no le aplica y
 *     bloquearlo costaría ventas por nada.
 *  2. Un evento POR ENCIMA del umbral sin divulgar NO cumple.
 *  3. Divulgar con menos de 24 h de antelación respecto al inicio de venta
 *     tampoco cumple — es la infracción concreta que se persigue.
 *  4. Divulgar con 24 h o más sí cumple.
 *  5. El precio divulgado por sección es el TOTAL (base + cargo + IVA), no el
 *     base. Divulgar el base es el *drip pricing* que la norma prohíbe.
 *  6. La divulgación es PÚBLICA: se lee sin credenciales.
 *  7. El hash detecta manipulación posterior del contenido.
 *  8. La disponibilidad por sección es real: coincide con el inventario.
 *
 * Uso:  API_URL=http://127.0.0.1:4000/api/v1 node e2e/load/profeco-disclosure.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const stamp = Date.now();
const HOUR = 3_600_000;

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: HTTP ${res.status}`);
  const json = await res.json();
  return json.accessToken ?? json.access_token;
}

/** Crea un evento con el aforo pedido y una sección con inventario. */
async function seedEvent({ orgId, venueId, capacity, salesStartAt, label }) {
  const event = await prisma.event.create({
    data: {
      slug: `profeco-${label}-${stamp}`,
      organizationId: orgId,
      venueId,
      title: `PROFECO ${label} ${stamp}`,
      category: 'MUSIC',
      startsAt: new Date(Date.now() + 60 * 24 * HOUR),
      timezone: 'America/Mexico_City',
      status: 'SCHEDULED',
      totalCapacity: capacity,
      salesStartAt,
      minPrice: 1000,
    },
  });
  await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'General',
      zone: 'General',
      basePrice: 1000,
      currency: 'MXN',
      totalQuantity: capacity,
      remainingQuantity: capacity,
      startDate: new Date(Date.now() - HOUR),
      endDate: new Date(Date.now() + 59 * 24 * HOUR),
    },
  });
  return event;
}

/** Copia del canonicalizador del servicio: si divergen, el hash no prueba nada. */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

async function main() {
  console.log(`\nDivulgación previa PROFECO · ${API}\n`);

  const token = await login('admin@demo.boletera.com', 'Admin123!');
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const org = await prisma.organization.findFirst();
  const venue = await prisma.venue.findFirst({ where: { organizationId: org.id } });
  if (!venue) throw new Error('no hay recinto para sembrar');

  // ---------------------------------------------------------------------------
  console.log('1. Evento pequeño: los lineamientos NO le aplican');
  // ---------------------------------------------------------------------------
  const pequeno = await seedEvent({
    orgId: org.id,
    venueId: venue.id,
    capacity: 500,
    salesStartAt: new Date(Date.now() + 2 * HOUR),
    label: 'pequeno',
  });

  let res = await fetch(`${API}/events/manage/${pequeno.id}/disclosure/compliance`, {
    headers: auth,
  });
  let verdict = await res.json();
  check(
    'aforo 500 → no aplica y no bloquea',
    verdict.applies === false && verdict.compliant === true,
    `${verdict.reason}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n2. Evento masivo sin divulgar: NO cumple');
  // ---------------------------------------------------------------------------
  const masivo = await seedEvent({
    orgId: org.id,
    venueId: venue.id,
    capacity: 45_000,
    // Venta dentro de 2 horas: imposible cumplir las 24 h divulgando ahora.
    salesStartAt: new Date(Date.now() + 2 * HOUR),
    label: 'masivo',
  });

  res = await fetch(`${API}/events/manage/${masivo.id}/disclosure/compliance`, { headers: auth });
  verdict = await res.json();
  check(
    'aforo 45.000 sin divulgar → no cumple',
    verdict.applies === true && verdict.compliant === false && verdict.reason === 'NOT_PUBLISHED',
    `${verdict.reason}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n3. Divulgar con menos de 24 h: sigue sin cumplir');
  // ---------------------------------------------------------------------------
  res = await fetch(`${API}/events/manage/${masivo.id}/disclosure`, {
    method: 'POST',
    headers: auth,
  });
  const publicado = await res.json();
  check('la publicación se asienta', res.status === 201 || res.status === 200, `HTTP ${res.status}`);

  res = await fetch(`${API}/events/manage/${masivo.id}/disclosure/compliance`, { headers: auth });
  verdict = await res.json();
  check(
    'venta en 2 h y divulgación de ahora → PUBLISHED_TOO_LATE',
    verdict.compliant === false && verdict.reason === 'PUBLISHED_TOO_LATE',
    `${verdict.reason}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n4. Con 24 h o más de antelación: cumple');
  // ---------------------------------------------------------------------------
  await prisma.event.update({
    where: { id: masivo.id },
    data: { salesStartAt: new Date(Date.now() + 30 * HOUR) },
  });
  res = await fetch(`${API}/events/manage/${masivo.id}/disclosure/compliance`, { headers: auth });
  verdict = await res.json();
  check(
    'venta a 30 h de la divulgación → cumple',
    verdict.compliant === true && verdict.reason === 'OK',
    `${verdict.reason}`,
  );

  // Y el límite exacto: 23 h 59 min NO debe pasar.
  await prisma.event.update({
    where: { id: masivo.id },
    data: { salesStartAt: new Date(Date.now() + 24 * HOUR - 60_000) },
  });
  res = await fetch(`${API}/events/manage/${masivo.id}/disclosure/compliance`, { headers: auth });
  verdict = await res.json();
  check(
    'a 23 h 59 min → NO cumple (el límite no se redondea a favor)',
    verdict.compliant === false,
    `${verdict.reason}`,
  );
  await prisma.event.update({
    where: { id: masivo.id },
    data: { salesStartAt: new Date(Date.now() + 30 * HOUR) },
  });

  // ---------------------------------------------------------------------------
  console.log('\n5. El precio divulgado es el TOTAL, no el base');
  // ---------------------------------------------------------------------------
  const seccion = publicado && (await (await fetch(`${API}/events/${masivo.id}/disclosure`)).json());
  const general = seccion?.sections?.find((s) => s.zone === 'General');
  const esperado = 1000 + 1000 * 0.1 + 1000 * 0.16; // base + cargo + IVA
  check(
    `precio total divulgado = $${esperado} (base $1000)`,
    general?.totalPrice === esperado,
    `divulgado $${general?.totalPrice}`,
  );
  check(
    'el desglose cuadra con el total',
    general &&
      Math.abs(general.basePrice + general.serviceFee + general.taxes - general.totalPrice) < 0.01,
    `${general?.basePrice} + ${general?.serviceFee} + ${general?.taxes}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n6. La divulgación es pública (sin credenciales)');
  // ---------------------------------------------------------------------------
  res = await fetch(`${API}/events/${masivo.id}/disclosure`);
  const publico = await res.json();
  check('se lee sin token', res.ok && publico.published === true, `HTTP ${res.status}`);
  check(
    'incluye lo que exige el lineamiento',
    Boolean(publico.capacity && publico.sections?.length && publico.terms && publico.venue?.name),
    `${publico.sections?.length} secciones, aforo ${publico.capacity}`,
  );
  check(
    'declara el régimen que le aplica',
    publico.regime?.applies === true && publico.regime?.appliesAboveCapacity === 20000,
    `${publico.regime?.source}`,
  );

  // Un evento sin divulgar responde 200 con published:false, no 404.
  res = await fetch(`${API}/events/${pequeno.id}/disclosure`);
  const sinDivulgar = await res.json();
  check(
    'sin divulgar → 200 con published:false, no 404',
    res.status === 200 && sinDivulgar.published === false,
    `HTTP ${res.status}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n7. El hash detecta manipulación posterior');
  // ---------------------------------------------------------------------------
  const fila = await prisma.eventDisclosure.findFirst({
    where: { eventId: masivo.id },
    orderBy: { publishedAt: 'desc' },
  });
  const recalculado = createHash('sha256').update(canonicalize(fila.payload)).digest('hex');
  check('el hash guardado reproduce el contenido', recalculado === fila.contentHash);

  const manipulado = JSON.parse(JSON.stringify(fila.payload));
  manipulado.sections[0].totalPrice = 1;
  const hashManipulado = createHash('sha256').update(canonicalize(manipulado)).digest('hex');
  check(
    'alterar el precio cambia el hash',
    hashManipulado !== fila.contentHash,
    'un cambio de precio no puede pasar inadvertido',
  );

  // El orden de las claves no debe alterar el hash, o no probaría nada.
  const reordenado = Object.fromEntries(Object.entries(fila.payload).reverse());
  check(
    'reordenar las claves NO cambia el hash',
    createHash('sha256').update(canonicalize(reordenado)).digest('hex') === fila.contentHash,
  );

  // ---------------------------------------------------------------------------
  console.log('\n8. Disponibilidad real por sección');
  // ---------------------------------------------------------------------------
  res = await fetch(`${API}/events/${masivo.id}/availability`);
  const disponibilidad = await res.json();
  const zona = disponibilidad.sections?.find((s) => s.zone === 'General');
  check('se lee sin token', res.ok, `HTTP ${res.status}`);
  check(
    'coincide con el inventario real',
    zona?.total === 45_000 && zona?.available === 45_000,
    `${zona?.available} de ${zona?.total}`,
  );

  // Vender inventario debe reflejarse: si no, la «disponibilidad real» es falsa.
  await prisma.offer.updateMany({
    where: { eventId: masivo.id },
    data: { remainingQuantity: 44_000, soldQuantity: 1_000 },
  });
  res = await fetch(`${API}/events/${masivo.id}/availability`);
  const tras = await res.json();
  const zonaTras = tras.sections?.find((s) => s.zone === 'General');
  check(
    'tras vender 1.000, la disponibilidad baja',
    zonaTras?.available === 44_000 && zonaTras?.sold === 1_000,
    `${zonaTras?.available} disponibles, ${zonaTras?.sold} vendidos`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n9. No se puede divulgar un evento sin precio');
  // ---------------------------------------------------------------------------
  const roto = await seedEvent({
    orgId: org.id,
    venueId: venue.id,
    capacity: 30_000,
    salesStartAt: new Date(Date.now() + 48 * HOUR),
    label: 'roto',
  });
  await prisma.offer.updateMany({ where: { eventId: roto.id }, data: { basePrice: 0 } });
  res = await fetch(`${API}/events/manage/${roto.id}/disclosure`, { method: 'POST', headers: auth });
  check(
    'divulgar sin precio se rechaza',
    res.status === 400,
    `HTTP ${res.status}`,
  );

  // ---------------------------------------------------------------------------
  console.log('\n10. El modo de aplicación decide si bloquea o solo avisa');
  // ---------------------------------------------------------------------------
  // El evento masivo divulgado está en regla; se rompe moviendo la venta a 1 h.
  await prisma.event.update({
    where: { id: masivo.id },
    data: { salesStartAt: new Date(Date.now() - HOUR), status: 'LIVE' },
  });
  await prisma.salePhase.create({
    data: {
      eventId: masivo.id,
      name: `publico-${stamp}`,
      kind: 'PUBLIC',
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + 20 * 24 * HOUR),
      status: 'ACTIVE',
    },
  });

  res = await fetch(`${API}/events/manage/${masivo.id}/sale-window`, { headers: auth });
  const ventana = await res.json();
  const modo = (process.env.PROFECO_ENFORCE_DISCLOSURE ?? 'warn').toLowerCase();

  if (modo === 'block') {
    check(
      'modo block → la venta se deniega',
      ventana.allowed === false && ventana.reason === 'DISCLOSURE_NOT_PUBLISHED',
      `${ventana.reason}`,
    );
  } else {
    check(
      'modo warn → la venta SIGUE abierta',
      ventana.allowed === true,
      `allowed=${ventana.allowed}, reason=${ventana.reason}`,
    );
    check(
      'modo warn → pero el aviso viaja en la decisión',
      typeof ventana.complianceWarning === 'string' && ventana.complianceWarning.length > 0,
      ventana.complianceWarning ? ventana.complianceWarning.slice(0, 60) : 'sin aviso',
    );
  }

  // --- limpieza --------------------------------------------------------------
  await prisma.event.deleteMany({
    where: { id: { in: [pequeno.id, masivo.id, roto.id] } },
  });

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
