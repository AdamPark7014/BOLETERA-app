# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-08-31
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

Cerramos **Wave 5** (SEO megapresencia multi-tenant + QR vivo + P0 aislamiento API + stubs honestos + orgName taquilla) sobre Wave 4.

No se tocó `enterprise-upgrade`, Banorte auto-refunds API, JWT httpOnly/CSRF, env backups, worktree `integracion/dinero`, PAC CFDI real ni bank payouts.

## Hecho en este turno

### seo-foundation
- `apps/web/lib/site-url.ts`: origen absoluto desde Host / x-forwarded-host / customDomain, fallback `NEXT_PUBLIC_WEB_URL`.
- `metadataBase` + favicon/apple-touch default (`/favicon.svg`) en `layout.tsx`.
- `app/sitemap.ts` (revalidate 1h) y `app/robots.ts` (disallow cart/checkout/cuenta/orders/login).

### seo-hubs
- `generateMetadata` OG/Twitter/canonical en home, categoría, ciudades, venues (+ detail).
- Venue miss → `notFound()` (ya no soft-200).
- noindex en layouts de cart / checkout / cuenta / orders.
- Títulos legales/ayuda/reventa usan `tenant.name` (no “Boletera” hardcodeado en metadata).

### seo-jsonld
- `lib/seo/event-jsonld.ts`: Event con `offers[]` por tier + availability real, image absoluto con fallback `/hero/*`, BreadcrumbList.
- Organization + WebSite JSON-LD en layout root.

### qr-live
- `OrderQrCards` poll cada ~11s; cancel al unmount; copy de renovación (no captura estática).

### api-p0
- Refunds `mutate` + `complete`: `OrgAccessGuard` + check `order.organizationId`.
- `POST /payments/intents`: `idempotencyKey` (header o `order:${orderId}`) → Banorte Redis + fila `PaymentIntent`.
- Discovery `getBySlug`: fail-closed sin tenant; orgId obligatorio.
- `/search/*`: mismo scope host + `publicCatalogEventWhere` que discovery.

### stubs-taquilla
- Admin sponsorships / automations: página “no disponible” sin KPIs inventados.
- CFDI: banner sandbox más visible (también sin perfil).
- Login API devuelve `organizationName`; taquilla lo guarda y lo usa en PosShell + header térmico.

### Verificación
- `check-types` web, api, taquilla, admin en verde.

## Pendiente
- Probar tenants A vs B con hosts distintos (manual / Docker) + Rich Results Test en un evento real.
- Load scenarios E2E con API arriba.
- Ola 6 candidata: resale buyer checkout incompleto; métricas worker DLQ.
- Refunds Banorte portal-manual / auto API; JWT httpOnly/CSRF; decidir `enterprise-upgrade`.
- PAC CFDI real (producción); bank rail payouts.

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
- Banorte auto-refund API, JWT httpOnly/CSRF end-to-end, PAC CFDI real, bank payouts.
