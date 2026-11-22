/**
 * Lectura de cartelera y ficha: rps / p50 / p95 / p99 / errores.
 * Uso: API_URL=http://127.0.0.1:4000/api/v1 node e2e/load/catalog-read.mjs
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const DURATION_MS = Number(process.env.DURATION_MS ?? 8000);
const CONCURRENCY = (process.env.CONCURRENCY ?? '10,50,200').split(',').map(Number);
const TENANT_HOST = process.env.TENANT_HOST ?? 'localhost';
// x-tenant-host: Node fetch no permite forzar Host; desde la red Docker hace falta.
const headers = { 'x-tenant-host': TENANT_HOST, Accept: 'application/json' };

async function bench(path, concurrency, durationMs) {
  const lat = [];
  let ok = 0,
    err = 0,
    s5 = 0,
    s503 = 0;
  const start = Date.now();
  async function one() {
    const t0 = performance.now();
    try {
      const r = await fetch(API + path, { headers });
      lat.push(performance.now() - t0);
      if (r.status === 503) s503++;
      else if (r.status >= 500) s5++;
      else if (r.ok || r.status === 304) ok++;
      else err++;
    } catch {
      err++;
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() - start < durationMs) await one();
    })
  );
  lat.sort((a, b) => a - b);
  const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
  const secs = durationMs / 1000;
  return {
    path,
    concurrency,
    n: lat.length,
    rps: +(ok / secs).toFixed(1),
    ok,
    err,
    s5,
    s503,
    p50: +p(0.5).toFixed(0),
    p95: +p(0.95).toFixed(0),
    p99: +p(0.99).toFixed(0),
  };
}

const events = await (await fetch(API + '/discovery/events?limit=1', { headers })).json();
const slug = events?.[0]?.slug;
if (!slug) throw new Error('Sin eventos en cartelera');
console.log('slug', slug);
for (const c of CONCURRENCY) {
  console.log(JSON.stringify(await bench('/discovery/events?limit=20', c, DURATION_MS)));
  console.log(JSON.stringify(await bench('/discovery/events/' + slug, c, DURATION_MS)));
  console.log(JSON.stringify(await bench('/discovery/facets', c, DURATION_MS)));
}
