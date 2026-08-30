# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-08-30
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

Turno de **robustez operativa** (patrones tipo red social / Ticketmaster: idempotencia cluster-safe, dedupe durable, observabilidad, tests de hold). Cuatro frentes en paralelo + integración.

Claude dejó en esta rama worker partidos + tests + load scripts. Este turno **no** reabrió el worker ni tocó `enterprise-upgrade`.

## Hecho en este turno

### Pagos — idempotencia Redis
- `packages/payments/src/security/idempotency.ts`: store pluggable; Redis con SET NX + singleflight; memoria sólo sin `REDIS_URL` / tests.
- `apps/api/.../payment-idempotency.wiring.ts` + `RedisService.setEx`.
- Tests payments **28/28**.

### POS offline — `clientSaleId` unique
- `Order.clientSaleId` + `@@unique([organizationId, clientSaleId])`.
- Migración `20260830140000_order_client_sale_id` (backfill desde `posOps`).
- Sync deja de depender del scan “últimos 100”; P2002 → replay idempotente.

### Observabilidad (A4-8 mínimo)
- `infra/observability/` versionado: Prometheus + Grafana + Redis exporter.
- `GET /api/v1/metrics/prometheus` → `boletera_up|db_ready|redis_ready`.
- Runbook sin `api.boletera.com` ni claim falso de 30k.

### Load + tests hold
- Escenarios load: todos default `:4000`.
- `inventory.service.hold-idempotency.spec.ts` **4/4**.
- `e2e/load/README.md` + nota THROTTLE en runner.

### Degradación
- Documentada en `infra/observability/README.md` (throttle fail-open, payment memory, `INVENTORY_REQUIRE_REDIS`).

## Verificación
- `pnpm --filter @boletera/payments build` + `check-types` API verde (tras rebuild payments).
- payments 28 + hold-idempotency 4 verdes.

## Pendiente
- Correr load scenarios **con** API+Docker arriba (aún no se probaron E2E reales).
- Refunds Banorte siguen portal-manual.
- A4-7 admin WIP sin tests.
- Decidir `enterprise-upgrade`.
- JWT en localStorage / CSRF server-side (no tocado).

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
