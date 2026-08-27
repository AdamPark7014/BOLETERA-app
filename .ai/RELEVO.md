# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-08-27
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

Este turno arrancó con un encargo que **el disco desmintió en tres puntos**. Se
documentan aquí porque el próximo agente puede recibir el mismo encargo:

1. **El worker NO era un stub.** `apps/worker/src/index.ts` ya implementaba la
   expiración de holds *y* la conciliación SPEI, y bien: advisory lock de
   Postgres, CAS con `SKIP LOCKED`, lotes acotados, y el arreglo de F1-10 (los
   holds de admisión general dejaban boletos `HELD` para siempre). No había
   ningún hueco funcional que tapar. Lo que faltaba de verdad era **estructura y
   tests**: 203 líneas con las tres tareas, el reloj y el arranque mezclados, y
   cero pruebas.
2. **El worker ya arrancaba en `docker-compose.yml`**, con su servicio, su
   `DATABASE_URL` de cupo reducido y su `INTERNAL_API_SECRET`. No se tocó.
3. **Los artefactos Gradle (A4-9) ya estaban ignorados.** `apps/mobile-native/`
   `android/.gitignore` (versionado) cubre `build/` y `.gradle/` desde antes;
   `git status` estaba limpio en esa ruta. No había nada que arreglar.

Y un cuarto, más peligroso:

4. **Las "8 copias fósiles de migraciones" de `.claude/worktrees/`**
   `gifted-goodall-0331d1/` **no son fósiles.** Ese directorio es el *worktree
   activo* de la rama viva `integracion/dinero`. Borrarlas habría destruido un
   worktree en uso. No se tocaron. Lo que sí se hizo es mover la regla
   `.claude/worktrees/` de `.git/info/exclude` (local, no se comparte) al
   `.gitignore` versionado, que es la forma correcta de que dejen de ensuciar
   las búsquedas.

## Hecho en este turno

### `b469050` — worker partido en jobs, y con tests

`apps/worker` pasa de 3 archivos a 15. Un archivo por responsabilidad:

| Archivo | Qué hace |
|---|---|
| `jobs/expire-holds.ts` | Barrido de holds vencidos (F1-10) |
| `jobs/reconcile-spei.ts` | Conciliación SPEI contra el API interno |
| `jobs/pending-payouts.ts` | Aviso de liquidaciones pendientes |
| `runner.ts` | Reloj y aislamiento de fallos entre tareas |
| `config.ts` | Configuración de entorno, ya validada |
| `ports.ts` | Lo mínimo que cada job necesita de la base |
| `index.ts` | Sólo arranque: aquí vive el `prisma` real |

**El comportamiento se conserva entero.** Advisory lock `7301472109`, CAS con
`SKIP LOCKED`, lotes de 500 con tope de 20 rondas, cerrojo de re-entrada,
liberación de admisión general por conteo con `updatedAt` refrescado (sin eso el
SSE de disponibilidad no ve la liberación), y **el mismo texto en cada línea de
log**. Se verificó línea por línea contra el `index.ts` anterior.

Lo que cambia es que **los jobs ya no importan `@boletera/database`**: reciben la
base por parámetro. Eso es lo que permite probarlos con dobles en memoria, sin
Postgres ni cliente de Prisma generado — la razón por la que nunca habían tenido
un test.

Añadido de paso, todo respaldado por test:
- `WORKER_SWEEP_BATCH=abc` ya no produce `LIMIT NaN` (reventaba en cada tick).
- `WORKER_INTERVAL_MS` configurable.
- Apagado ordenado en `SIGTERM`/`SIGINT` con `prisma.$disconnect()`.

`packages/crypto` (firma y rotación del QR) tampoco tenía **un solo test**, y es
lo que decide si alguien entra al recinto. Se cubren: rotación de ventana de
15 s, gracia de una ventana, rechazo a las dos ventanas, clave derivada por
boleto (la firma de un boleto no vale para otro), invalidación por `keyEpoch` al
transferir, que la clave offline que se entrega al teléfono no es el secreto
maestro, y la firma del manifiesto offline contra reordenar / recortar /
reetiquetar entradas.

### `d975c02` — escenarios de carga ejecutables y poda de documentación

**Carga (A4-3).** Los 11 escenarios de `e2e/load/` no tenían forma de lanzarse.
Ahora `pnpm load:<escenario>` para los 11, `pnpm load:onsale` para el de k6, y
`scripts/run-load-scenarios.mjs` que los corre en tanda **y comprueba la
precondición antes**: sin API arriba morían con un `TypeError: fetch failed` y
un volcado de pila; ahora se explica qué arrancar, incluido el throttle alto sin
el cual varios chocan con el límite por IP antes de poder competir.
`pnpm load:all --syntax` valida los 11 sin API ni base, y **entra en CI**: es lo
único que cabe ahí, y es justo lo que los estaba pudriendo.

**Documentación (A4-6).** 23 markdowns en la raíz → **2**. Ocho movidos a
`docs/`; trece borrados por afirmar lo que el repo desmiente ("PRODUCTION
READY", "Phase 1 Complete", "85% Implementado") en un proyecto **jamás
desplegado**.

**Ramas y worktrees (A4-4 / A4-5).** Ver la tabla de abajo.

## Números

| | Antes | Después |
|---|---|---|
| Specs verdes en `pnpm test` | **42** | **127** |
| Archivos de test | 11 | 18 |
| Tareas `test` en turbo | 7 | 9 |
| Tareas `check-types` | 11 | 12 (el worker ya declara la suya) |
| Markdowns en la raíz | 23 | 2 |
| Ramas locales | 8 | 5 |
| Worktrees | 3 | 2 |

Desglose de los 127: `worker` 53 · `crypto` 32 · `payments` 25 · `shared` 16 ·
`api` 1. **Ningún test se perdió.** `check-types` 12/12 en verde.

> Ojo con el "~11 tests" del relevo anterior: eran 11 *archivos*, no 11 casos.
> El monorepo ya corría 42 specs. El número honesto de partida es 42.

## Ramas — qué se borró y qué NO

Antes de borrar nada se comprobó `git log main..<rama>` y `git branch --merged`.
Las cinco borradas se fueron con `git branch -d` (borrado seguro: git verifica
que están contenidas en `main`).

**Borradas — 0 commits fuera de `main`:**
- `claude/auditoria-plataforma-boleteria-23db5a` (`86571f9`)
- `claude/gifted-goodall-0331d1` (`380aed9`)
- `claude/instalame-ultra-viewer-58c50f` (`2fc9547`)
- `claude/prende-local-host-d605e7` (`2fc9547`)
- `claude/software-folder-duplicates-3c59a0` (`2fc9547`)

**NO borradas:**
- **`enterprise-upgrade` — venía en la lista de "fósiles claras" y NO lo es.**
  Tiene **2 commits que no están en `main`**: `2a83884` ("Ship enterprise
  upgrade: OS admin, storefront, security, and infra") y `f28ed0d`
  ("checkpoint: estado previo al upgrade enterprise"). Está pusheada a
  `origin/enterprise-upgrade`. **Alguien tiene que decidir si ese trabajo se
  integra o se tira.** No es una decisión de agente.
- `ui/reforma-admin` — viva. 1 commit fuera de `main` (`efc648a`, reforma de
  interfaz de otra sesión).
- `integracion/dinero` — viva. Está contenida en `main`, pero tiene **worktree
  activo** en `.claude/worktrees/gifted-goodall-0331d1/`, con un
  `apps/admin/next-env.d.ts` modificado sin commitear (generado por Next; no se
  tocó, es de otro turno).

**Worktrees:** `git worktree prune` eliminó el que apuntaba a la ruta de
OneDrive que ya no existe. Quedan el principal y el de `integracion/dinero`.

## Pendiente

### A4-7 — los 179 archivos de autoría desconocida (sin resolver)
El WIP `9402327` metió 179 archivos, sobre todo `.tsx` y `.module.scss` del
panel admin, sin tests que los respalden. **Sigue igual.** Este turno dio
cobertura a lo que toca dinero y aforo (worker, QR), que era lo urgente; el
admin no se tocó. Hay que decidirlos uno por uno y no hay atajo.

### A4-8 — runbook y observabilidad (verificado, sin resolver)
- `docs/RUNBOOK_ONSALE.md` promete 30k concurrentes y usa `api.boletera.com`
  como placeholder (1 aparición). Un runbook con un dominio que no existe no se
  puede seguir en una madrugada de onsale.
- **`infra/` no tiene un solo archivo versionado.** En disco sólo hay
  `infra/observability/.env`, que está ignorado. O sea: la observabilidad que el
  runbook da por hecha no existe.

### Documentación
`docs/ARCHITECTURE.md` (293 líneas, "mega pesado, impecable") y
`docs/ARCHITECTURE_TECNICA.md` (579 líneas, la que estaba en la raíz) **se
solapan y las dos son pre-fork**. No se fusionaron: hacerlo bien exige decidir
qué sigue siendo cierto, y eso no es trabajo de una poda. Quedan las dos en
`docs/`, señaladas aquí.

### Carga
Los 11 escenarios están cableados, pero **no se pudieron correr de verdad**:
Docker no estaba levantado en esta máquina. Se verificó que `tenant-isolation`,
`concurrent-hold` y `oversell` **arrancan** — cargan `.env`, resuelven el
cliente de Prisma y llegan a la llamada al API, fallando sólo en `ECONNREFUSED`.
Falta pasarlos con la plataforma arriba. `pnpm load:onsale` no se pudo probar:
**k6 no está instalado**.

Detalle menor: `bot-hoarding.mjs` y `profeco-disclosure.mjs` apuntan por defecto
al puerto **4001**; los otros nueve al **4000**. Con `API_URL` se corrige, pero
la inconsistencia está ahí.

### Sin pushear
El relevo anterior decía "37 commits locales sin pushear". **Ya no es cierto:**
`main` está exactamente en `origin/main` (`e8584bc`), 0 commits de diferencia.
Se subieron en algún momento entre turnos.

Lo único sin subir son **los 2 commits de este turno**, en
`mejora/worker-y-tests`. No se pusheó porque no se pidió.

## No tocar

- Los `*.env.docker-backup` (raíz, `apps/api/`, `packages/database/`) — llevan
  secretos reales, están fuera de git a propósito (`.gitignore:12`). No se
  leyeron ni se movieron en este turno.
- `.claude/worktrees/gifted-goodall-0331d1/` — **worktree activo** de
  `integracion/dinero`. No es basura: borrarlo destruye trabajo.
- `enterprise-upgrade` — hasta que alguien decida qué hacer con sus 2 commits.
