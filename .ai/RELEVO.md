# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-11-22
- **Rama:** main
- **Tarea:** Noche 22-11 — pulido Black-Ticket/BOLETERA: inventario huecos + 1–3 módulos con tests (sin push)

## Hecho

- **Reto antibots alineado al API (PoW + clearanceToken):**
  - Web: `HumanChallenge.tsx` resuelve PoW con `salt:challengeId:counter`, pide `clearanceToken`; `EventPurchaseClient` pasa el reto del 428 y limpia `pendingChallenge` al resolver.
  - Android: `HumanChallenge.kt` / `BuyerApi` / `ApiClient` / `MainActivity` usan `clearanceToken` + `IssuedPowChallenge`; tests unitarios actualizados.
  - Docs: `OPERACION-ONSALE.md` y `apps/mobile-native/README.md` (paridad fases 0–2 en Android; buscador NL pendiente en app).
- **Typecheck API:** `inventory.controller.release.spec.ts` inyecta el 6.º mock (`HumanChallengeService`) que faltaba tras el WIP de rescate.
- **Smart-search (módulo del WIP 7a02dd1):** nuevos `query-filters.spec.ts` y `smart-search.service.spec.ts` (consulta corta, assistantAvailable, rate limit 429).
- **Verificación:** API 30 pruebas (human-challenge + release + interpreter + filters + service) en verde; `check-types` api+web OK; Android `HumanChallengeTest` BUILD SUCCESSFUL. **Sin push remoto.**

## A medias

- Auto-reintento de hold en web tras resolver el reto (Android sí reintenta; web deja el `clearanceToken` y el comprador vuelve a apartar).
- Ollama saturado por flota noche: `implement` MCP/shell hizo timeout; tickets locales + drafts en `.ai/drafts/noche-22-*` para los specs nuevos.
- RELEVO histórico anterior (rediseño 14–21 nov) sigue siendo contexto; este archivo refleja el estado vivo del turno.

## Siguiente

- Medición de carga 5k/20k con el código de Fase 2 (`docs/OPERACION-ONSALE.md`).
- Buscador NL / asistente en Android (web ya tiene `/buscar` + smart-search).
- iOS: no hay proyecto (`apps/mobile-native` solo Android).
- Wallet Apple/Google; Turnstile en cliente web si `HUMAN_CHALLENGE_PROVIDER=turnstile`.
- Eval smart-search (`node apps/api/src/modules/smart-search/eval/run.mjs`) cuando haya hueco en Ollama/CI local.

## No tocar

- Push a `origin` esta noche (pedido de Adam).
- `apps/mobile-native/android/.kotlin/` (artefacto local).
- Carpetas protegidas / secretos / deploy.
- No matar la flota Ollama de otros productos.

## Paridad al cierre

| Plataforma | Estado |
|---|---|
| Web | Hecho (PoW + clearance en compra; buscar/asistente ya en disco del WIP) |
| API | Hecho (HumanChallengeService + specs smart-search; typecheck verde) |
| Android | Hecho (mismo contrato hold/fila/reto) |
| iOS | No aplica — no hay proyecto nativo |

- **Cierre relevo:** 2026-11-22 cursor (commit local 1ff625d; sin push).
