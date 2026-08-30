# Observability (local)

Prometheus + Grafana + Redis exporter for local / compose use. This is the
versioned stack the onsale runbook refers to — not a production SLA claim.

## Start

From the **repo root**:

```bash
docker compose -f infra/observability/docker-compose.observability.yml up -d
```

Stop:

```bash
docker compose -f infra/observability/docker-compose.observability.yml down
```

## Ports (loopback)

| Service        | URL                                      |
| -------------- | ---------------------------------------- |
| Prometheus UI  | http://127.0.0.1:9090                    |
| Grafana        | http://127.0.0.1:3100 (admin / admin)    |
| Redis exporter | http://127.0.0.1:9121/metrics            |
| API scrape     | http://127.0.0.1:4000/api/v1/metrics/prometheus |

Override Grafana credentials with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`
(compose env or a local `.env` next to this compose file — `.env` is gitignored).

## Scrape target

Prometheus scrapes:

- **API:** `host.docker.internal:4000` → path `/api/v1/metrics/prometheus`
- **Redis exporter:** `redis-exporter:9121`

Quick check without Prometheus:

```bash
curl -fsS http://127.0.0.1:4000/api/v1/metrics/prometheus
```

Expected gauges (v1): `boletera_up`, `boletera_db_ready`, `boletera_redis_ready`.

## API must be up

Start the API (and Postgres/Redis) first — this stack only scrapes. Typical local:

```bash
docker compose up -d postgres redis
# then your usual API start, or the root compose `api` service
```

If Redis is not on host `:6379`, set `REDIS_EXPORTER_ADDR` (e.g.
`redis://host.docker.internal:6380`).

## Degradación cuando Redis falla

| Pieza | Sin Redis / Redis caído | Producción |
| ----- | ----------------------- | ---------- |
| Rate limit (`Throttler`) | Fail-open a memoria del proceso (límites por réplica, no globales) | Exige `REDIS_URL` |
| Idempotencia payment intents | Memoria del proceso (no cluster-safe) | Wiring Redis al boot si hay `REDIS_URL` |
| Holds / inventario | Con `INVENTORY_REQUIRE_REDIS=true` (implícito en prod) falla duro; en local puede degradar | Redis obligatorio |
| `/ready` | Puede marcar Redis opcional en local | Mirar `boletera_redis_ready` en Prometheus |

No inventes “estamos bien” si `boletera_redis_ready` es 0 en un onsale.

## Grafana

Datasource **Prometheus** is provisioned at `http://prometheus:9090`.
Explore → metric names `boletera_*` after the first successful scrape.

## Sharing the root compose network (optional)

If the API container is named `api` on network `boletera-network`, change
`prometheus.yml` target to `api:4000` and attach Prometheus to that external
network. Default stays `host.docker.internal` so a host-run Nest process works
without editing networks.
