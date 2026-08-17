# Migraciones de Boletera

Hasta ahora el esquema se aplicaba con `prisma db push`: sin historial, sin
forma de revisar un cambio destructivo antes de que llegara a producción y sin
manera de saber si la base y `schema.prisma` seguían coincidiendo. Este
directorio sustituye ese flujo.

## Migraciones existentes

| Migración | Contenido |
| --- | --- |
| `00000000000000_baseline` | Esquema completo tal como lo dejaba `db push`. **No se ejecuta nunca sobre una base que ya existía** (ver más abajo). |
| `20260815119000_order_status_pending_refund` | `OrderStatus.PENDING_REFUND`. En su propia migración porque PostgreSQL no permite usar un valor de enum dentro de la misma transacción que lo añade. |
| `20260815120000_onsale_hardening` | Endurecimiento del onsale: token de acceso de orden, invitaciones de organización e índices asociados. |

---

## ⚠️ BASES DE DATOS EXISTENTES (creadas con `db push`): LEE ESTO ANTES DE DESPLEGAR

Una base creada con `db push` **ya tiene todas las tablas**, pero no tiene la
tabla `_prisma_migrations`. Si lanzas `prisma migrate deploy` directamente,
Prisma cree que la base está vacía e intenta ejecutar `00000000000000_baseline`
entero. Ese script hace `CREATE TABLE …` de todo el esquema:

- El despliegue **falla** con `relation "Organization" already exists`.
- La migración queda registrada como fallida y **bloquea todos los despliegues
  siguientes** hasta que alguien la resuelva a mano.

La baseline hay que **marcarla como aplicada sin ejecutarla**, una sola vez por
base de datos (producción, staging, y cualquier entorno de desarrollo que ya
tuviera datos).

### Procedimiento, una vez por base existente

```bash
# 0) Copia de seguridad. Siempre.
pg_dump "$DATABASE_URL" > backup-pre-migraciones-$(date +%Y%m%d%H%M).sql

# 1) Comprobar que la base NO tiene ya historial de migraciones.
#    Si esto devuelve filas, la base ya está inicializada: salta al paso 4.
psql "$DATABASE_URL" -c 'SELECT migration_name, finished_at FROM _prisma_migrations;'

# 2) Marcar la baseline como aplicada SIN ejecutarla.
pnpm --filter @boletera/database exec \
  prisma migrate resolve --applied 00000000000000_baseline

# 3) Verificar que quedó registrada.
psql "$DATABASE_URL" -c 'SELECT migration_name, finished_at FROM _prisma_migrations;'

# 4) Ahora sí, aplicar el resto del historial.
pnpm --filter @boletera/database exec prisma migrate deploy
```

Si el paso 2 falla con "migration not found", estás ejecutando el comando desde
un directorio equivocado: tiene que resolverse contra
`packages/database/prisma/migrations`.

### Bases de datos nuevas (vacías)

No hay nada especial que hacer: `prisma migrate deploy` aplica la baseline y el
resto en orden.

```bash
pnpm --filter @boletera/database exec prisma migrate deploy
```

---

## Flujo de trabajo diario

**Nunca más `prisma db push` contra una base compartida.** Cualquier cambio de
esquema va acompañado de su migración en el mismo commit.

```bash
# 1) Editar packages/database/prisma/schema.prisma
# 2) Generar la migración (crea el SQL y lo aplica en tu base local)
pnpm --filter @boletera/database exec prisma migrate dev --name descripcion_corta

# 3) Revisar el SQL generado antes de commitear
#    packages/database/prisma/migrations/<timestamp>_descripcion_corta/migration.sql
```

Revisa siempre el SQL a mano: Prisma resuelve un rename de columna como
`DROP COLUMN` + `ADD COLUMN`, lo que borra los datos de esa columna.

### CI comprueba que no hay deriva

El pipeline ejecuta:

```bash
prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code
```

Si el esquema cambia sin su migración correspondiente, el comando devuelve un
código de salida distinto de cero y **el build falla**. No hay forma de que un
cambio de esquema llegue a `main` sin migración.

## Enums en PostgreSQL

Añadir un valor a un enum (`ALTER TYPE … ADD VALUE`) no puede ir en la misma
transacción que lo use después. Cada valor nuevo de enum va en **su propia
migración**, como `20260815119000_order_status_pending_refund`.

## Si una migración falla en producción

```bash
# Ver cuál quedó a medias
psql "$DATABASE_URL" -c \
  'SELECT migration_name, started_at, finished_at, logs FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;'

# Opción A: se aplicó de verdad aunque Prisma no lo registrara
prisma migrate resolve --applied <nombre_migracion>

# Opción B: no se aplicó nada; se marca como revertida y se corrige el SQL
prisma migrate resolve --rolled-back <nombre_migracion>
```

`prisma migrate reset` **borra la base entera**. No existe para producción.
