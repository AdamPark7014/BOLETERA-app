# Integración `claude/auditoria-plataforma-boleteria` ↔ `enterprise-upgrade`

## Qué pasó

Dos esfuerzos de endurecimiento avanzaron **en paralelo** sobre el mismo commit
base (`2fc9547`), sin saber uno del otro:

- `enterprise-upgrade` (`2a83884`) — 1,213 archivos.
- Esta rama — auditoría por fases con pruebas de integración.

No son rama vieja y rama nueva: **resolvieron problemas distintos del mismo
sistema**, y en varios casos el mismo problema con arquitecturas distintas. Un
`git merge` directo produce **135 archivos en conflicto**, muchos en el camino
crítico de dinero e inventario. Resolverlos a ojo es la forma segura de perder
en silencio una corrección de seguridad de cualquiera de los dos lados.

Por eso la integración va **por dominio, con decisión explícita y verificada en
cada uno**, no de un tirón.

## Método

Para cada dominio, antes de mover una línea:

1. Listar los hallazgos de la auditoría que tocan ese dominio.
2. Comprobar **en el código de la otra rama** si están cubiertos.
3. Adoptar como base la implementación mejor, portar encima lo que falte.
4. Verificar con las pruebas de integración antes de confirmar.

El paso 2 no es opcional: en el dominio de dinero, la otra rama tenía **el mismo
fallo idéntico** que yo había corregido, y a la vez una base mejor que la mía.
Suponerlo en cualquiera de los dos sentidos habría sido un error.

## Estado por dominio

### 1. Dinero — INTEGRADO (`144e88b`)

**Base adoptada: `enterprise-upgrade`** (`packages/shared`, `packages/payments`).

| Aporta | Por qué gana |
|---|---|
| Aritmética en centavos (`MoneyAmount`, `amountMinor`) | La mía operaba con `Number` y arrastraba error de redondeo en cada conversión |
| `security/{idempotency,redact,retry}` con pruebas | No existía equivalente; `redact` evita filtrar FIRMA/CLABE a los logs |
| DTOs con class-validator, catálogo de errores | Validación real en el borde |

**Portado encima (esa rama NO lo tenía):**

| Hallazgo | Qué pasaba |
|---|---|
| F1-04 | `includes('aprobada')` casaba con «no aprobada»: un cobro RECHAZADO se conciliaba como completado y emitía boletos gratis |
| F1-05 | El webhook no devolvía el importe liquidado: no existía ningún punto donde comparar lo cobrado con lo debido |
| F1-01 | El registry no comprobaba el canal que cada proveedor declara: `CashProvider` era invocable desde web anónima |

**Trampa que casi cuesta cara:** el proveedor importa el clasificador desde
`payworks.ts`, no desde `webhook.ts`. Se verificó que `payworks` **reexporta**
en vez de duplicar; si hubiera sido copia, la corrección habría quedado en
código muerto. **Comprobar esto en cada injerto.**

Pruebas del monorepo: 1 → 42.

### 2. Inquilinos — INTEGRADO (`7767f46`)

**Base adoptada: `enterprise-upgrade`** — `TenantContextService` sobre
`AsyncLocalStorage` con interceptor global desde `AuthModule`. Fija el inquilino
para toda la petición, así un servicio puede exigir `requireOrganization()` esté
donde esté. Es defensa que **no depende de recordar un guard** al añadir una ruta.

**Conservado de esta rama:**

- `OrgAccessGuard` endurecido. El suyo corrigió la exención de `ADMIN`, pero
  mantiene `if (!requested) return true`, que aprueba a ciegas cualquier
  petición sin `organizationId` y deja el guard decorativo.
- Sistema de invitaciones (`OrgInvitation` + interfaz). Ambas ramas dejaron de
  otorgar `PROMOTER` en el SSO; **solo ésta añadió el camino de alta** que hace
  falta después de cerrarlo.

Las dos capas son consistentes por construcción: derivan del mismo
`req.user.organizationId`.

### 3. Inventario — SE CONSERVA ESTA RAMA (verificado)

| Hallazgo | `enterprise-upgrade` | Esta rama |
|---|---|---|
| F1-02a reserva GA atómica (`FOR UPDATE SKIP LOCKED`) | ausente | ✅ |
| F1-02b la venta exige `HELD` | ✅ | ✅ |
| F1-08 SSE con productor compartido y deltas | ausente | ✅ |
| F1-10 el worker libera los holds de admisión general | ausente | ✅ |

Es además el único lado con **prueba de concurrencia** que demuestra ausencia de
sobreventa, validada por contra-prueba.

### 4. Interfaz — PENDIENTE (~689 archivos)

`apps/admin` 502 · `apps/web` 118 · `apps/taquilla` 69.

Es el grueso del volumen pero **sin riesgo de correctitud**: ningún hallazgo de
dinero o inventario vive aquí. Se puede hacer pantalla por pantalla, en
cualquier orden, sin bloquear nada.

Lo que esta rama aporta y conviene no perder: render del mapa en canvas (45.000
nodos DOM → 0), reautenticación que reenvía la petición original en vez de
perder el trabajo, pantallas que distinguen vacío / error / sin permiso, y el
escáner de puerta con veredictos separados.

## La red que hace esto seguro

Tres pruebas que deben pasar **antes de confirmar cada dominio**:

```bash
docker compose up -d postgres redis
pnpm --filter @boletera/api build
cd apps/api && THROTTLE_LIMIT=100000 THROTTLE_BURST_LIMIT=100000 node dist/main.js
```

```bash
node e2e/load/oversell.mjs          # 500 compradores sobre 3 butacas
node e2e/load/tenant-isolation.mjs  # el personal de A no toca inventario de B
pnpm run check-types && pnpm run build && pnpm run test
```

`oversell.mjs` falla si hay sobreventa, si la reserva concede inventario
inexistente, **o si ninguna venta prospera** — cero sobreventa con cero compras
es lo que devuelve un API caído, y no demuestra nada.

## Pendiente de decisión

**Las migraciones siguen congeladas.** La base de desarrollo está migrada con el
`_init` de `enterprise-upgrade`; esta rama tiene su propia baseline, que lo
duplica. Mientras no se resuelva, no se pueden añadir al esquema:

- Bloqueo real de inventario (hoy un «bloqueo» es un hold de 300 s que se
  libera solo).
- Ventana de venta (`salesStartAt` / `salesEndAt`): el asistente de alta de
  evento valida la regla y avisa de que el dato no se persiste.
- `PromoterPayout.currency`: la tabla de liquidaciones asume MXN mientras las
  órdenes ya son multi-moneda.

Cerrar el dominio 4 y luego reconciliar migraciones desde el `_init` existente
es el camino natural.
