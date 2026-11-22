/**
 * Flujo sala → apartado → orden → demo-confirm bajo carga.
 * Uso:
 *   DATABASE_URL=... API_URL=http://127.0.0.1:4000/api/v1 BUYERS=500 WAVE=100 node e2e/load/onsale-flow.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '../../packages/database/generated/client/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try {
  for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {
  // Imagen Docker del API no trae .env; DATABASE_URL ya viene del contenedor.
}

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const BUYERS = Number(process.env.BUYERS ?? 500);
const WAVE = Number(process.env.WAVE ?? 100);
const CAPACITY = Number(process.env.CAPACITY ?? BUYERS);
const prisma = new PrismaClient();
const stamp = Date.now();
const slug = `carga-${stamp}`;

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchRetry(url, init, max = 5) {
  let last;
  for (let i = 0; i < max; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status !== 503) return res;
      const ra = Number(res.headers.get('retry-after') || '1');
      await sleep(Math.max(200, ra * 1000));
      last = res;
    } catch (e) {
      last = e;
      await sleep(200 * (i + 1));
    }
  }
  if (last && typeof last.status === 'number') return last;
  throw last instanceof Error ? last : new Error('fetch failed');
}

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: `Carga ${stamp}`,
      slug: `org-${slug}`,
      email: `${slug}@carga.local`,
      country: 'MX',
      currency: 'MXN',
    },
  });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: `V${stamp}`,
      slug: `venue-${slug}`,
      address: 'x',
      city: 'CDMX',
      state: 'CDMX',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: CAPACITY,
    },
  });
  const batchSize = Math.max(50, Math.floor(BUYERS / 10));
  const event = await prisma.event.create({
    data: {
      slug,
      organizationId: org.id,
      venueId: venue.id,
      title: `Carga onsale ${stamp}`,
      startsAt: new Date(Date.now() + 86_400_000 * 30),
      timezone: 'America/Mexico_City',
      status: 'LIVE',
      publishedAt: new Date(),
      currency: 'MXN',
      totalCapacity: CAPACITY,
      minPrice: 100,
      maxPrice: 100,
      metadata: {
        waitingRoom: {
          enabled: true,
          opensAt: new Date(Date.now() - 60_000).toISOString(),
          batchSize,
          batchIntervalSeconds: 1,
        },
      },
    },
  });
  const offer = await prisma.offer.create({
    data: {
      eventId: event.id,
      name: 'GA',
      zone: 'ga',
      basePrice: 100,
      currency: 'MXN',
      totalQuantity: CAPACITY,
      remainingQuantity: CAPACITY,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000 * 30),
      maxPerOrder: 1,
    },
  });
  const chunk = 500;
  for (let i = 0; i < CAPACITY; i += chunk) {
    const n = Math.min(chunk, CAPACITY - i);
    await prisma.ticket.createMany({
      data: Array.from({ length: n }, (_, j) => ({
        code: `CG-${stamp}-${i + j}`,
        eventId: event.id,
        offerId: offer.id,
        status: 'AVAILABLE',
        section: 'GA',
      })),
    });
  }
  return { org, event, offer };
}

async function waitPass(eventId, memberId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await (
      await fetchRetry(
        `${API}/waiting-room/${eventId}/status?memberId=${encodeURIComponent(memberId)}`
      )
    ).json();
    if (st.admitted && st.pass) return st.pass;
    await sleep(250);
  }
  throw new Error('timeout waiting pass');
}

async function oneBuyer(i, ctx, holdLat) {
  // Pase firmado con memberId; inventory valida contra sessionId → mismo id.
  const sessionId = `m-${i}-${stamp}`;
  const join = await fetchRetry(`${API}/waiting-room/${ctx.event.id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: sessionId, sessionId }),
  });
  if (!join.ok) {
    return { ok: false, stage: 'join', status: join.status, s5: join.status >= 500 };
  }
  const pass = await waitPass(ctx.event.id, sessionId);
  const t0 = performance.now();
  const holdRes = await fetchRetry(`${API}/inventory/holds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: ctx.event.id,
      offerId: ctx.offer.id,
      quantity: 1,
      sessionId,
      queuePass: pass,
    }),
  });
  holdLat.push(performance.now() - t0);
  if (!holdRes.ok) {
    return { ok: false, stage: 'hold', status: holdRes.status, s5: holdRes.status >= 500 };
  }
  const holdBody = await holdRes.json();
  const holdIds = (holdBody.holds ?? []).map((h) => h.id);
  if (!holdIds.length) return { ok: false, stage: 'hold-empty', status: holdRes.status, s5: false };

  const orderRes = await fetchRetry(`${API}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': sessionId,
    },
    body: JSON.stringify({
      eventId: ctx.event.id,
      offerId: ctx.offer.id,
      holdIds,
      buyerName: `Carga ${i}`,
      buyerEmail: `carga-${i}-${stamp}@load.local`,
      paymentMethod: 'SPEI',
    }),
  });
  if (!orderRes.ok) {
    return { ok: false, stage: 'order', status: orderRes.status, s5: orderRes.status >= 500 };
  }
  const order = await orderRes.json();
  const publicId = order.publicId ?? order.order?.publicId;
  const accessToken = order.accessToken;
  if (!publicId) return { ok: false, stage: 'order-id', status: orderRes.status, s5: false };
  if (!accessToken) return { ok: false, stage: 'order-token', status: orderRes.status, s5: false };

  const conf = await fetchRetry(
    `${API}/orders/${publicId}/demo-confirm?accessToken=${encodeURIComponent(accessToken)}`,
    { method: 'POST' }
  );
  if (!conf.ok) {
    return { ok: false, stage: 'confirm', status: conf.status, s5: conf.status >= 500 };
  }
  return { ok: true, stage: 'done', status: conf.status, s5: false };
}

function pct(sorted, q) {
  if (!sorted.length) return 0;
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(0);
}

const ctx = await seed();
console.log(
  JSON.stringify({
    event: ctx.event.slug,
    eventId: ctx.event.id,
    offerId: ctx.offer.id,
    BUYERS,
    WAVE,
    CAPACITY,
  })
);

const holdLat = [];
const results = [];
for (let start = 0; start < BUYERS; start += WAVE) {
  const n = Math.min(WAVE, BUYERS - start);
  const wave = await Promise.all(
    Array.from({ length: n }, (_, j) =>
      oneBuyer(start + j, ctx, holdLat).catch((e) => ({
        ok: false,
        stage: 'error',
        status: 0,
        s5: false,
        detail: String(e).slice(0, 80),
      }))
    )
  );
  results.push(...wave);
  console.log(`wave ${start}-${start + n - 1} ok=${wave.filter((r) => r.ok).length}/${n}`);
}

holdLat.sort((a, b) => a - b);
const sold = await prisma.ticket.count({ where: { eventId: ctx.event.id, status: 'SOLD' } });
const ok = results.filter((r) => r.ok).length;
const s5 = results.filter((r) => r.s5).length;
const fail = results.length - ok;
const oversell = sold > CAPACITY;
const byStage = {};
for (const r of results.filter((x) => !x.ok)) {
  byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
}

const summary = {
  ok,
  fail,
  s5xx: s5,
  sold,
  capacity: CAPACITY,
  oversell,
  hold_p50_ms: pct(holdLat, 0.5),
  hold_p95_ms: pct(holdLat, 0.95),
  hold_n: holdLat.length,
  fail_by_stage: byStage,
};
console.log(JSON.stringify(summary));

await prisma.seatHold.deleteMany({ where: { eventId: ctx.event.id } }).catch(() => undefined);
await prisma.ticket.deleteMany({ where: { eventId: ctx.event.id } }).catch(() => undefined);
await prisma.offer.deleteMany({ where: { eventId: ctx.event.id } }).catch(() => undefined);
await prisma.event.delete({ where: { id: ctx.event.id } }).catch(() => undefined);
await prisma.organization.delete({ where: { id: ctx.org.id } }).catch(() => undefined);
await prisma.$disconnect();

process.exit(oversell || s5 > 0 ? 1 : 0);
