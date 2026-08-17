# Runbook de onsale

Objetivo: 30.000 usuarios concurrentes en el minuto 1. Este documento se lee a
las 3 de la mañana. Todo lo que hay aquí es copiar y pegar.

`$API` = origen público del API (p. ej. `https://api.boletera.com`).

---

## 1. Antes del onsale (T-60 min)

```bash
# Secretos presentes, fuertes y DISTINTOS entre sí.
# Cada línea debe imprimir un número >= 32 y los tres hashes deben diferir.
for v in JWT_SECRET TICKET_QR_SECRET INTERNAL_API_SECRET; do
  val=$(printenv "$v")
  printf '%-20s len=%s sha=%s\n' "$v" "${#val}" \
    "$(printf %s "$val" | sha256sum | cut -c1-8)"
done
```

- [ ] Los tres miden ≥ 32 y **ninguno repite hash**. Si `TICKET_QR_SECRET` es
      igual a `JWT_SECRET`, para: rotar sesiones invalidaría todos los boletos
      ya emitidos.
- [ ] El API arrancó. Si un secreto es débil o falta, el proceso no levanta —
      el error lo dice explícitamente.

```bash
# Salud del API: database=up, redis=up
curl -fsS "$API/api/v1/health" | jq .

# Migraciones al día (no debe faltar ninguna ni haber fallidas)
pnpm --filter @boletera/database exec prisma migrate status

# Worker vivo: debe haber logueado en los últimos 30 s
docker compose logs --since 2m worker | tail -20

# Redis vivo y con la política correcta (noeviction: desalojar un hold = sobreventa)
docker compose exec redis redis-cli ping
docker compose exec redis redis-cli config get maxmemory-policy
```

- [ ] `health.database = up`, `health.redis = up`.
- [ ] `migrate status` dice que no hay migraciones pendientes ni fallidas.
- [ ] El worker imprime actividad: sin él **los holds vencidos no se liberan
      nunca** y el inventario se muere en el minuto 1.
- [ ] `maxmemory-policy` es `noeviction`.

```bash
# Banorte en vivo, NO en modo demo
printenv BANORTE_MERCHANT_ID BANORTE_WEBHOOK_SECRET | sed 's/./*/g;s/^$/(VACÍO)/'
printenv BANORTE_ALLOW_UNSIGNED_WEBHOOK
printenv NODE_ENV
```

- [ ] `BANORTE_MERCHANT_ID` y `BANORTE_WEBHOOK_SECRET` **no vacíos**. Sin
      `MERCHANT_ID` el gateway entra en modo demo y "cobra" sin cobrar.
- [ ] `BANORTE_ALLOW_UNSIGNED_WEBHOOK` = `false`.
- [ ] `NODE_ENV` = `production`.

```bash
# Rate limiting global (no por réplica) y detrás del balanceador
docker compose logs api | grep -i "rate limiting"     # debe decir "sobre Redis"
printenv TRUST_PROXY                                   # 1 si hay un balanceador delante
printenv ENABLE_API_DOCS                               # false
```

- [ ] El log dice `Rate limiting sobre Redis`. Si dice **DEGRADANDO a memoria**,
      el límite se multiplica por el número de réplicas y el de login deja de
      frenar la fuerza bruta.
- [ ] `TRUST_PROXY` definido si hay balanceador o CDN. Sin él, todo el tráfico
      cuenta como una sola IP y el límite de ráfaga **corta el onsale entero**.

```bash
# Capacidad de base de datos:
#   PRISMA_CONNECTION_LIMIT * réplicas_api + worker  <  max_connections - 20
psql "$DATABASE_URL" -c 'SHOW max_connections;'
psql "$DATABASE_URL" -c 'SELECT count(*) AS abiertas FROM pg_stat_activity;'
```

---

## 2. Durante el pico — qué vigilar

| Señal | Dónde | Umbral de alarma |
| --- | --- | --- |
| Conexiones a Postgres | `SELECT count(*) FROM pg_stat_activity` | > 80 % de `max_connections` |
| Errores de pool | logs del API | cualquier `Timed out fetching a connection` |
| Consultas lentas | logs del API con `PRISMA_LOG_SLOW_QUERIES=true` | `Consulta lenta` recurrente sobre la misma tabla |
| Redis | `redis-cli info stats` | `evicted_keys > 0` (**sobreventa en curso**) o `rejected_connections > 0` |
| Rate limiting | logs del API | `Redis no responde al contar peticiones` → el límite está ABIERTO |
| Holds | `SELECT status, count(*) FROM "SeatHold" GROUP BY status` | `ACTIVE` con `expiresAt` pasado y creciendo → worker caído |
| Pagos | `SELECT status, count(*) FROM "Order" GROUP BY status` | `PENDING` creciendo sin `PAID` → gateway o IPN caídos |
| 429 | métricas del balanceador | subida brusca → revisa `TRUST_PROXY` antes de subir límites |
| 5xx | métricas del balanceador | > 1 % sostenido |

Consultas rápidas:

```sql
-- Holds vencidos que el worker no ha liberado
SELECT count(*) FROM "SeatHold" WHERE status = 'ACTIVE' AND "expiresAt" < now();

-- Qué está bloqueando a qué
SELECT pid, state, wait_event_type, wait_event, left(query, 80)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start LIMIT 20;
```

---

## 3. Interruptores para degradar bajo presión

Todos son variables de entorno: cambiar y reiniciar el servicio afectado.
Reiniciar el API **no** cierra sesiones; rotar `JWT_SECRET` sí.

| Síntoma | Interruptor | Efecto |
| --- | --- | --- |
| Postgres saturado (conexiones al tope) | Bajar `PRISMA_CONNECTION_LIMIT` y quitar réplicas | Menos concurrencia, pero deja de tumbar la base |
| Errores `Timed out fetching a connection` | Subir `PRISMA_POOL_TIMEOUT` a 30 | Las peticiones esperan más en vez de fallar |
| Transacciones abortadas a media compra | Subir `PRISMA_TRANSACTION_TIMEOUT` | Cuidado: transacciones largas mantienen bloqueos de fila |
| Bots o scraping | Bajar `THROTTLE_BURST_LIMIT` (10 → 5) y `THROTTLE_LIMIT` | Corta ráfagas; afecta también a usuarios legítimos rápidos |
| Falsos 429 masivos | Revisar `TRUST_PROXY` **antes** de subir límites | Casi siempre el problema es que se ve una sola IP |
| No sé qué consulta está matando la base | `PRISMA_LOG_SLOW_QUERIES=true` | Registra todo lo que pase de `PRISMA_SLOW_QUERY_MS` |
| Alguien pide "ver la documentación" | Dejar `ENABLE_API_DOCS=false` | Nunca se abre Swagger durante un onsale |
| Redis caído | No hay interruptor: los holds caen a solo-BD y el rate limiting se abre | Prioridad máxima: levantar Redis |
| Worker caído | Reiniciar `worker` | Sin él los asientos retenidos no vuelven a inventario |

Reinicio de un servicio suelto:

```bash
docker compose restart worker      # o: api, redis
docker compose logs -f --tail=100 worker
```

**Nunca durante un evento en puerta:**

- Rotar `TICKET_QR_SECRET` → invalida el QR de **todos** los boletos emitidos.
- `prisma migrate reset` → borra la base.
- Rotar `JWT_SECRET` → cierra la sesión de todos los usuarios y de todo el
  personal de taquilla a la vez.

---

## 4. Despliegue (orden obligatorio)

```bash
# 1) Copia de seguridad
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d%H%M).sql

# 2) Primera vez sobre una base creada con `db push`: marcar la baseline
#    SIN ejecutarla. Ver packages/database/prisma/migrations/README.md.
pnpm --filter @boletera/database exec prisma migrate resolve --applied 00000000000000_baseline

# 3) Migraciones
pnpm --filter @boletera/database exec prisma migrate deploy

# 4) API y worker
docker compose up -d --build api worker

# 5) Verificación
curl -fsS "$API/api/v1/ready" | jq .
docker compose logs --since 2m api | grep -iE "rate limiting|PostgreSQL conectado"
```

Rollback: volver a la imagen anterior del API y del worker. **Las migraciones no
se revierten automáticamente**; si una migración es incompatible con la versión
anterior del código, el rollback exige restaurar el dump del paso 1.
