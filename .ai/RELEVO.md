# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-08-30
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

Cerramos **Wave 4** (marca tenant + corte Z térmica + cache tenant + nav refunds) sobre olas 1–3 white-label. Árbol debía quedar limpio tras `relevo cerrar`.

No se tocó `enterprise-upgrade`, Banorte auto-refunds API, JWT httpOnly, env backups ni worktree `integracion/dinero`.

## Hecho en este turno

### brand-surfaces
- `useTenantBrand()` / `fetchTenantCurrent` en HomeHero, EventDiscoveryPanel, events/[slug], checkout, cuenta, login, OrderDetailClient.
- Fallback literal `BOLETERA` solo vía `FALLBACK_TENANT` / `DEFAULT_BRAND`.
- Header/footer alineados al mismo criterio.

### thermal-z
- `buildEscPosReceipt(lines, header?)` — default `TAQUILLA`, sin `BOLETERA TAQUILLA`.
- Corte Z: `printViaSerial` si hay puerto; si no, `printEscPos` (browser). Título = terminal.
- PosShell / login / home taquilla: chrome `TAQUILLA` (sin marca plataforma).

### cache-unsplash
- `fetchTenantCurrent` envuelto en `React.cache()` (dedupe layout+footer).
- Quitados preconnect/dns-prefetch Unsplash del layout web.
- `EventPosterArt` usa `/hero/*` local antes que Unsplash; `EVENT_STOCK_IMAGES` documentado como seed-only.
- CSS muerto `.newsletter*` borrado de SiteFooter.module.scss.
- Ciudades home: fallback local `/hero/01-festival.jpg`.

### nav-refunds
- Admin nav: enlace «Reembolsos» → `/orders/refunds` junto a Órdenes; match `orders` excluye `/orders/refunds`.

### Verificación
- `check-types` web, taquilla, admin en verde.

## Pendiente
- Probar tenants A vs B con hosts distintos (manual / Docker).
- Load scenarios E2E con API arriba.
- Refunds Banorte portal-manual / auto API; JWT httpOnly/CSRF; decidir `enterprise-upgrade`.
- Nombre de org en chrome taquilla (hoy genérico `TAQUILLA`; sesión no guarda org name).

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
