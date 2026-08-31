# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-08-30
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

Cerramos el plan **white-label storefront pro** (olas 1–3): Host→tenant, chrome CMS, pulido público y caja/admin creíbles. No se tocó `enterprise-upgrade` ni refunds Banorte.

El turno anterior de robustez (Redis idempotencia, `clientSaleId`, métricas) sigue en `34224d5`; el WIP white-label ola 1 quedó en `1693681`.

## Hecho en este turno

### Ola 2 — pulido público
- Footer sin newsletter/`#` ni redes fake; marca desde `fetchTenantCurrent`.
- Footers duplicados quitados en cart/checkout/orders (layout ya tiene uno).
- Checkout H1 → «Pago»; legales: banner borrador solo fuera de prod (`LegalDraftNotice`).
- `discovery.getBySlug(slug, orgId?)` + controller con host → no leak cross-tenant.

### Ola 3 — caja / admin
- Cash-drop exige `managerPin` en DTO/API/cliente; prod sin hash de PIN → 403 (no default `2468`).
- Admin Z-reports: retiros, esperado, contado, diferencia + export CSV.
- Nav: quitados stubs Patrocinios y Automatizaciones.
- Taquilla Ajustes: `Button`/`Input` de `@boletera/ui`.
- Header usa `useTenantBrand` (nombre + logo).

### Verificación
- `check-types` web, admin, api, taquilla en verde.

## Pendiente
- Probar tenants A vs B con hosts distintos (manual / Docker).
- Load scenarios E2E con API arriba.
- Refunds Banorte portal-manual; JWT httpOnly/CSRF; decidir `enterprise-upgrade`.
- Corte Z a térmica (si hay puerto) / PDF browser — no hecho en esta ola.

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
