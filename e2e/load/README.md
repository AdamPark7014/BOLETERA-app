# Escenarios de carga

Once escenarios en esta carpeta (`*.mjs`) más `onsale-k6.js` (binario k6 aparte).

## Cómo lanzarlos

```bash
pnpm load:<escenario>          # uno
pnpm load:all                  # todos en secuencia
pnpm load:all --syntax         # sólo sintaxis (CI; sin API)
pnpm load:all --check          # ¿responde el API?
pnpm load:onsale               # k6 (requiere k6 instalado)
```

`API_URL` sobrescribe el destino (por defecto `http://127.0.0.1:4000/api/v1`).

## Precondiciones

Hace falta la plataforma arriba:

```bash
docker compose up -d postgres redis
pnpm db:migrate:deploy && pnpm db:seed
THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 pnpm dev:api
```

El throttle elevado no es opcional: varios escenarios disparan cientos de
compradores desde la misma IP y, con los límites por defecto, mueren en 429
antes de poder competir por inventario.
