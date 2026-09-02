# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-09-02
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

**Este turno tampoco tocó código.** Solo documentación de producto:
`docs/UX-MAPS.md` (nuevo), que continúa `docs/PERSONAS.md` del turno anterior.
El último estado de código sigue siendo el de Cursor (**Wave 5**: SEO
megapresencia multi-tenant, QR vivo, P0 aislamiento API, stubs honestos,
orgName en taquilla, sobre Wave 4). Nada de lo pendiente cambió.

## Hecho en este turno

### docs/UX-MAPS.md (nuevo)
Mapas de experiencia sobre las personas ya escritas. Cinco journey maps con
curva de ánimo (promotora, comprador, taquillera, operador del recinto,
contadora), un blueprint de servicio del on-sale móvil con las tres líneas
(interacción / visibilidad / interacción interna), dos mapas de empatía, el
cruce mapa × hipótesis H1–H5 y un mapa de oportunidades O1–O8.

Cada fricción va etiquetada **✔ verificado** (con archivo y línea del repo) o
**? hipótesis** (con la H que la cubre). No se mezclan: los mapas heredan la
misma deuda que las personas — nadie ha observado todavía a un usuario real.

### Hallazgo verificado que sale de los mapas (O3)
`apps/web/lib/pricing.ts` dice por escrito que el precio anunciado tiene que ser
el que se cobra, y `POST /pricing/calculate-cart` ya es público. Pero ese helper
se usa en `cart`, `checkout`, `cuenta` y `orders/[publicId]` — **no en la página
del evento**: en `apps/web/app/events/[slug]/EventPurchaseClient.tsx:658` la
etiqueta dice «Total $…» sobre una suma de `basePrice`, sin cargo por servicio
ni IVA. Es exactamente la sorpresa que `H2` acusa de provocar el abandono.
**Está diagnosticado, no arreglado.** Nadie ha tocado ese archivo.

### Entregables fuera del repo
- Artifact publicado con la versión presentable (curvas de ánimo y blueprint
  dibujados): https://claude.ai/code/artifact/b89f1693-0100-4ac1-9652-8e1111d14e54
- El HTML fuente queda en el scratchpad de la sesión, no en el repo.

## Pendiente
- Probar tenants A vs B con hosts distintos (manual / Docker) + Rich Results Test
  en un evento real.
- Load scenarios E2E con API arriba.
- Ola 6 candidata: resale buyer checkout incompleto; métricas worker DLQ.
- Refunds Banorte portal-manual / auto API; JWT httpOnly/CSRF; decidir
  `enterprise-upgrade`.
- PAC CFDI real (producción); bank rail payouts.
- Las personas siguen **sin firmar** (paso 04 del método). Antes de usarlas para
  priorizar hay que cerrar la sesión de acuerdo y resolver H1/H3. Los mapas se
  llevan impresos a esa sesión.
- **Nuevo:** O3 (total real desde la página del evento) y O4 (contador de cola
  offline en taquilla) son los dos candidatos de código con evidencia verificada.
  Ninguno está comprometido: entran a la sesión de acuerdo, no al sprint.
- **Nuevo:** el embudo móvil evento→carrito→pago no existe como evento
  instrumentado. Sin eso, H2 no se resuelve.

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
- Banorte auto-refund API, JWT httpOnly/CSRF end-to-end, PAC CFDI real, bank payouts.
