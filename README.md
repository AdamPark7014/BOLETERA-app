# Boletera Platform

SaaS de boletería orientada a **México / LATAM**: promotores, venues, taquilla, Banorte (CARD/SPEI/OXXO), mapas de asientos y control de acceso por QR.

> Estado: **spine de compra funcional** + módulos operativos en madurez desigual. Banorte corre en **modo demo** sin credenciales reales. No es un clon listo de Ticketmaster.

## Qué funciona hoy

- Holds de asientos (Redis + DB) → órdenes → tickets / QR firmado
- Pagos Banorte (demo o Payworks cuando hay `BANORTE_*`)
- Admin (eventos, venues, órdenes, waitlist, partners, audit)
- Taquilla POS (requiere JWT rol `TAQUILLA`+)
- Waitlist, transferencias de boleto, API keys partner (`/api/v1/partner/v1/*`)
- CFDI 4.0 **sandbox** (`/api/v1/billing/:orgId/cfdi/stamp`)
- Refunds auditados + cierre manual cuando Banorte portal completa el reembolso

## Stack

| Capa | Tech |
|------|------|
| Monorepo | pnpm + Turborepo |
| API | NestJS 11 · Prisma 6 · PostgreSQL 16 · Redis 7 |
| Apps | Next.js (web, admin, taquilla) · worker Node |
| Pagos | Banorte Payworks / SPEI / OXXO (`packages/payments`) — **sin Stripe** |

## Arranque local

```bash
# 1. Docker: Postgres en host 5434 (5432/5433 suelen estar ocupados en Windows)
docker compose up -d postgres redis

# 2. Env (copiar si hace falta)
cp .env.example .env
# DATABASE_URL=postgresql://postgres:postgres@localhost:5434/boletera?schema=public

# 3. Schema + seed
pnpm db:generate
pnpm --filter @boletera/database exec prisma db push
pnpm --filter @boletera/database run prisma:seed

# 4. Dev
pnpm dev
```

Seed: `admin@demo.boletera.com` / `taquilla@demo.boletera.com` — password `Admin123!` · org `demo-boletera`.

API: `http://localhost:4000/api/v1` · Swagger en `/api/docs` · health `/api/v1/health` · ready `/api/v1/ready`.

## Partner API

```http
GET /api/v1/partner/v1/events
X-Api-Key: blk_…
```

Scopes típicos: `read:events`, `read:inventory`, `write:orders`.

## Roadmap (prioridad)

1. Banorte producción (IPN, SPEI bank confirm, refunds API)
2. CFDI con PAC real
3. Liquidaciones SPEI a promotor (sin fake-complete del worker)
4. SSO Admin · abonos · scanner PWA offline
5. Stripe / multi-región solo después de PMF México

## Apps

| App | Puerto típico | Rol |
|-----|---------------|-----|
| `apps/api` | 4000 | Backend |
| `apps/web` | 3000 | Comprador |
| `apps/admin` | 3001 | Promotor / ops |
| `apps/taquilla` | 3002 | POS |
| `apps/worker` | — | Expira holds + reconcile SPEI |

## Pruebas

```bash
pnpm test          # unitarios de todo el monorepo
pnpm check-types   # typecheck de apps y paquetes
pnpm test:e2e      # Playwright (necesita la plataforma arriba)
```

### Escenarios de carga

Doce escenarios en `e2e/load/`: sobreventa, acaparamiento por bots, aislamiento
entre inquilinos, reparto por fases de venta, sala de espera, cancelación de
evento, transferencia de boleto, cadena de cartera móvil, precios all-in y
disclosure PROFECO.

Necesitan el API y Postgres arriba, y el throttle alto (varios lanzan cientos de
compradores simultáneos y si no chocan con el límite por IP antes de competir):

```bash
docker compose up -d postgres redis
THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 pnpm dev:api

pnpm load:oversell            # uno suelto
pnpm load:all                 # todos en secuencia
pnpm load:all --check         # ¿está la plataforma lista?
pnpm load:all --syntax        # sólo validar el código (esto sí corre en CI)
```

`pnpm load:onsale` usa k6 y necesita el binario instalado aparte.

## Documentación

El resto vive en [`docs/`](docs/): referencia de API, arquitectura, setup de
desarrollo y Docker, webhooks e integraciones, y el runbook de onsale.

## Licencia

Privado — uso interno Boletera.
