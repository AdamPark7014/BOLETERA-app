/* Service worker de la taquilla.
 *
 * Objetivo: que la PWA ABRA sin red. Nada más. Los datos de operación viven en
 * IndexedDB (cola de ventas, cola de escaneos, manifiestos), no en este caché.
 *
 * Regla dura: NUNCA se cachean respuestas del API. La versión anterior cacheaba
 * cualquier GET del mismo origen y servía `cached ?? network`, así que una
 * pantalla podía quedarse mostrando disponibilidad de hace horas — y en
 * ventanilla eso significa vender un lugar que ya no existe.
 */

const CACHE = 'boletera-taquilla-v2';
const PRECACHE = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isAppAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/') ||
      url.pathname === '/manifest.json' ||
      /\.(css|js|woff2?|png|svg|ico)$/.test(url.pathname))
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // El API y el SSE nunca pasan por caché.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navegaciones: red primero, caché sólo como paracaídas al quedarse sin señal.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put('/', clone));
          return res;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  // Assets versionados de Next: caché primero, que son inmutables.
  if (isAppAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put(request, clone));
            }
            return res;
          }),
      ),
    );
  }
});
