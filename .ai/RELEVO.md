# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-08-26
- **Rama:** main

## Hecho en este turno
- Rescate de 179 archivos sin commitear (commit `9402327`, WIP de autoría
  desconocida): sobre todo `.tsx` y `.module.scss` del panel admin.
- `.gitignore`: excluido `*.env.docker-backup`. Los tres archivos
  (`/`, `apps/api/`, `packages/database/`) llevaban **valores reales** de
  `JWT_SECRET`, `DATABASE_URL`, `DIRECT_DATABASE_URL` y `TICKET_QR_SECRET`, y
  estaban sin rastrear, o sea a un `git add -A` de entrar al historial. Siguen en
  disco, fuera de git.
- Verificado el estado del WIP:
  - `npm run check-types` → **11/11 verde**.
  - `npm run test` → **verde**, 7 tareas.

## A medias — CUIDADO
- **La red de tests es prácticamente inexistente:** todo el monorepo corre
  1 test, en `@boletera/api`. Que esté "verde" no dice gran cosa. Cualquier
  cambio de conducta hay que verificarlo a mano o escribiendo el test primero.
- **37 commits locales sin pushear** a `github.com/AdamPark7014/BOLETERA-app`
  (39 contando los dos de este turno). Nadie más los tiene.

## Siguiente paso
- Decidir si se pushean esos 39 commits.
- Si se va a seguir tocando el admin, empezar por dar cobertura mínima a lo que
  el WIP `9402327` cambió: no hay tests que respalden esos 165 archivos.

## No tocar
- Los `*.env.docker-backup` — fuera de git a propósito, llevan secretos reales.
  Si hacen falta en otra máquina, pásalos por un canal seguro, no por el repo.
