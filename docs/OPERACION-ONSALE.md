# Operación en el día de venta (onsale)

Cómo medir, qué mirar y qué cambió en la Fase 2 del plan maestro.

## Cómo correr las pruebas de carga

Demo Docker (no borrar datos): API `http://127.0.0.1:4000`, Postgres `127.0.0.1:5445`, Redis `127.0.0.1:6390`.

```powershell
$env:API_URL = 'http://127.0.0.1:4000/api/v1'
$env:DATABASE_URL = 'postgresql://postgres:<DEMO_PASSWORD>@127.0.0.1:5445/boletera?schema=public'

# Lectura (cartelera / ficha / facetas)
node e2e/load/catalog-read.mjs

# Inventario
pnpm load:concurrent-hold   # BUYERS=200 por omisión
pnpm load:oversell
pnpm load:waiting-room

# Pico grande (requiere k6 + EVENT_ID / OFFER_ID)
pnpm load:onsale
```

Variables útiles: `BUYERS`, `CONCURRENCY=10,50,200`, `DURATION_MS=8000`, `PRISMA_CONNECTION_LIMIT` (default 20; subir con cuidado vs `max_connections` de Postgres).

## Línea base (antes)

Fuente: `C:\dev\tmp\boletera-demo\PRUEBA-AL-LIMITE.md` (14-11-2026) y medición 21-11-2026 contra la demo.

| Escenario                           | Antes (14-11)                    | Medido 21-11 (pre-cambio, demo)                                                        |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Cartelera `GET /discovery/events`   | ~110 rps; p95 ~2.4 s @ 200 conc. | Degradado tras tormenta de holds: ~2–6 rps útiles, muchos `fetch failed`, 0 × 5xx HTTP |
| Ficha `GET /discovery/events/:slug` | ~170 rps; p95 ~1.4 s @ 200 conc. | Similar; p95 hasta ~6 s @ 200 conc. con errores de red                                 |
| Concurrent hold 200 → 1 butaca      | 0 sobreventa                     | 0 sobreventa (1 ACTIVE / 1 HELD); muchos `fetch failed` por saturación                 |
| Oversell / waiting-room             | 0 sobreventa (docs)              | ECONNRESET al saturar el API (mismo pool 20)                                           |
| 5,000 GA                            | 385 × 503/timeout de pool        | Criterio: 503 con `Retry-After` reintentable; 0 sobreventa                             |

### Medición 21-11-2026 (demo Docker, API contenedor previo)

| Ruta         | Conc. |  rps |  p50 |  p95 |  p99 | err | 5xx |
| ------------ | ----: | ---: | ---: | ---: | ---: | --: | --: |
| events       |    10 |  8.7 |  366 |  743 | 1484 |  10 |   0 |
| events/:slug |    10 |  8.5 |  196 |  354 |  366 |  10 |   0 |
| facets       |    10 | 65.3 |  152 |  242 |  274 |   0 |   0 |
| events       |    50 |  8.7 | 1231 | 1555 | 1587 |  50 |   0 |
| events/:slug |    50 |  9.0 | 1501 | 1704 | 1885 |  50 |   0 |
| facets       |    50 | 65.0 |  798 | 1056 | 1274 |   0 |   0 |

Concurrent-hold 100 compradores: **0 sobreventa** (1 ACTIVE / 1 HELD).

Después (código nuevo en repo): pendiente de rebuild del contenedor API; ver `.ai/drafts/resultado-09.md`.

## Después (objetivo / verificación)

Tras caché Redis + singleflight, ETag, reintento web en 503, pase de fila atado a sesión, topes por comprador, reto antibots y tablero admin:

| Criterio                | Meta                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| Sobreventa              | 0                                                                   |
| 5xx definitivos         | 0 (503 con Retry-After que el cliente recupera no cuentan)          |
| p95 apartado            | < 1.5 s                                                             |
| Lectura cartelera/ficha | Sube vs ~110/170 rps gracias a Redis (medir con `catalog-read.mjs`) |

Repite con ~5,000 y ~20,000 compradores simulados (sala + apartado + confirmación demo) y anota la fila «después» en la tabla de arriba.

## Pool de Prisma

Documentado en `apps/api/src/modules/prisma/prisma.service.ts`:

- `PRISMA_CONNECTION_LIMIT` (default 20)
- `PRISMA_POOL_TIMEOUT` (default 20 s)
- `PRISMA_CONNECT_TIMEOUT` (default 10 s)
- `PRISMA_TRANSACTION_MAX_WAIT` / `PRISMA_TRANSACTION_TIMEOUT`

Regla: `PRISMA_CONNECTION_LIMIT * réplicas_api + worker < max_connections` de Postgres.

## Lista de comprobación del día de venta

### 24 h antes

- [ ] `prisma migrate deploy` al día
- [ ] Redis saludable; prueba de `waiting-room` en verde
- [ ] Cartelera/ficha con caché: `catalog-read.mjs` sin 5xx
- [ ] Evento con `metadata.waitingRoom` (opensAt, batchSize, batchIntervalSeconds)
- [ ] Topes `metadata.purchaseLimits` si aplica
- [ ] Throttle de API elevado o edge delante; `PRISMA_CONNECTION_LIMIT` acordado
- [ ] Tablero «Operación en vivo» abre en admin

### 1 h antes

- [ ] Abrir tablero del evento; fila en 0 o pre-fila saneada
- [ ] Probar un hold + pago demo de punta a punta
- [ ] Confirmar MSI / métodos activos
- [ ] Contacto de guardia (quién pausa admisión / cierra venta)

### Durante

- [ ] Mirar fila, ritmo de admisión, apartados, órdenes/boletos por minuto, tasa de pago, 4xx/5xx
- [ ] Pausar admisión si la base se satura; subir/bajar `batchSize`
- [ ] Cerrar venta solo si hace falta

### Después

- [ ] Cerrar venta; dejar caducar holds
- [ ] Exportar liquidaciones / CSV de finanzas
- [ ] Anotar rps y errores reales en este documento
- [ ] Revisar auditoría de retos antibots (`BUYER_RISK_CHALLENGE`)

## Paridad

- Web: caché SSR vía API, reintento 503, reto «Soy una persona», fila con sesión firmada
- API: caché Redis, ETag, topes, pase en pago, ops en vivo
- Android: pendiente (mismos contratos de hold/fila/reto)
- iOS: pendiente (no hay proyecto)
