# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-11-22
- **Rama:** main
- **Cierre:** f11d1fd — reto antibots alineado; stubs 3D reparados

## Hecho

- 2026-11-22 cursor — Paridad del reto antibots (fases 0–2 / día de venta) en web y Android con el contrato nuevo del API (`HumanChallengeService`): PoW `salt:challengeId:counter` → `POST /inventory/challenge/solve` → `clearanceToken` en holds (ya no `proof`/`challengeToken`). Web: `HumanChallenge.tsx` + `EventPurchaseClient` (parsea `challenge` del 428, manda `clearanceToken`, sesión de invitado al resolver). Android: `HumanChallenge.kt`, `BuyerApi`, `ApiClient`, `MainActivity`, tests. Docs: `docs/OPERACION-ONSALE.md` y `apps/mobile-native/README.md`. WIP showcase 3D: stubs inválidos (`__ticket` / `PLACEHOLDER_ONLY`) reparados en `venue3d/*`, `/venues/[slug]/3d` y `packages/venue-3d/src/index.ts` sin tocar compra/reventa. Verificado: API human-challenge + buyer-risk 10/10; Android `HumanChallengeTest` + `RotatingTicketCodeTest` OK; `@boletera/web` check-types OK.
  Paridad: Web hecho · API hecho · Android hecho (hold/fila/reto) · iOS pendiente (no hay proyecto).

## A medias

- Showcase 3D del recinto (`/venues/[slug]/3d`): ruta y contenedor válidos; el visor completo del recinto sigue en preparación (no bloquea compra).
- Plan maestro: fases 0–2 en código; medición de carga 5k/20k con el código nuevo sigue pendiente (`docs/OPERACION-ONSALE.md`).
- Buscador NL / asistente en Android (web ya tiene `/buscar` + smart-search del WIP rescatado).

## Siguiente

- iOS nativo (fase 4 del plan) o cerrar medición onsale.
- Integrar `InstancedSeats` / `SectionPriceLabels` en el visor de compra si Adam quiere el mapa 3D enriquecido.
- No CFDI PAC real ni Wallet sin pedido explícito.

## No tocar

- Compra/reventa/pago (salvo el contrato de reto ya alineado).
- Credenciales, `.env` de demo, CFDI producción, Apple/Google Wallet.
- `git push` en este turno (Adam: sin push).

## Contexto previo (resumen)

- Fases 0–2 del plan maestro ya entraron (ficha/PDF, dinero/PROFECO/MSI/payouts, caché/fila/reto/ops en vivo). Taquilla pulida (pago mixto, alcance de caja). Android comprador al día en preventa/MSI/reventa/espera/transferir. Commits WIP de rescate previos pueden dejar archivos a medias; disco y `git log` ganan a la memoria.
