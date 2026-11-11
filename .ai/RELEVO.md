# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-11-11
- **Rama:** main

## Hecho

- 2026-11-11 claude-code: auditoría visual de las 107 pantallas (capturas antes/después fuera del repo, en `C:\dev\tmp\boletera-audit`).
- 2026-11-11 claude-code: la cartelera salía vacía: `publicCatalogEventWhere` descartaba todo evento con metadata sin la llave `visibility` (NULL en Postgres). Arreglado con prueba.
- 2026-11-11 claude-code: todo el admin queda en el índice Black Ticket. Oficios nuevos Venta, Lectura y Sistema, y Cancelación en el evento. Órdenes y reservaciones ya no rompen (sobre paginado); CRM y órdenes toman `expectedAmount` si falta `totalAmount`.
- 2026-11-11 claude-code: login, recuperar y restablecer de admin en BT; recuperar/restablecer ya abren sin sesión (guarda en SessionProvider).
- 2026-11-11 claude-code: web: carrito, cuenta, boleto, pago, reventa, recintos, ciudades, recuperar contraseña, ayuda, legales y pie en el lienzo oscuro (antes títulos hueso sobre blanco).
- 2026-11-11 claude-code: taquilla: corte sin desborde, 50¢ rotulado, sin errores de hidratación en corte y ajustes; buscar en BT.

- 2026-10-25 cursor: Equipo asigna a una persona uno de los 15 roles de Prisma; el catálogo y las llaves siguen en lectura.
- 2026-10-25 cursor: el saldo de lealtad se guarda en User al pagar; si la campaña trae un número, ese valor se descuenta al cobrar por la misma vía que un código.
- 2026-10-25 cursor: tarjeta, SPEI y OXXO se guardan en settings; si la clave no está, el método sigue activo.
- 2026-10-25 cursor: cargo por servicio e IVA se guardan en settings de la organización; vacío sigue la tasa del entorno.
- 2026-10-25 cursor: días para cerrar, días del banco y plazo de transferencia se guardan en settings de la organización; vacío sigue en 5, 10 y 7 días.
- 2026-10-25 cursor: recinto y abonos se guardan en las columnas que ya existían; los días de reembolso y de transferencia siguen en lectura porque no hay columna.
- 2026-10-25 cursor: el editor del plano queda en el lienzo admin; Guardar sección persiste la geometría que ya tenía.
- 2026-10-25 cursor: Descuentos, cumplimiento, recinto, mapa, organización, marca, partners, abonos, espera, pagos y plataforma en fichas; se edita solo lo que el API ya guarda.
- 2026-10-25 cursor: Fases se guardan; liquidaciones, facturación, reportes y fraude muestran lo que el API ya devuelve.
- 2026-10-25 cursor: Equipo muestra los 15 roles de Prisma; el menú reconoce 8 y las llaves se leen, sin Guardar.
- 2026-10-24 cursor: puerta en el lenguaje visual: zonas que ya devuelve el acceso, escáner de admin y acceso de taquilla.
- 2026-10-24 cursor: el corte muestra esperado, contado y la diferencia; el descuadre se guarda en el reporte Z que ya existía.
- 2026-10-24 cursor: el cargo del anuncio usa resaleCommission; vacío sigue en el 8% del servicio.
- 2026-10-24 cursor: el apartado caduca con los minutos de holdExpiration; vacío sigue en 15 min web y 5 min taquilla.
- 2026-10-24 cursor: fichas de Apartados (anuncio editable; caducidad real en lectura), Reembolsos y transferencias (plazos y cola en lectura; cierre manual).
- 2026-10-24 cursor: fichas de Comisiones (editables), Cargos e IVA (lectura: tasas de entorno).
- 2026-10-24 cursor: admin de eventos en lenguaje visual (lista, ficha, agenda, zonas, canales). El alta no crea Offer: el arreglo es del API.
- 2026-10-24 cursor: el alta persiste Event en borrador y Offer (zona, precio MXN, cupo, vigencia de la función). minPrice y maxPrice quedan en ese precio.

Lenguaje visual de Black Ticket en `@boletera/ui`.
- Taquilla (`apps/taquilla`): lienzo `BlackTicketRoot` densidad taquilla, Cobrar fijo, folio tras el cobro.
- Compra pública de `apps/web` redibujada con `BlackTicketRoot` densidad compra: cartelera, ficha, zona, apartado, datos, pago, boleto y cuenta. Reenvío y CLABE de reembolso no tienen API de comprador.

- Tokens y tema oscuro único, opt-in con `data-black-ticket`. Densidades `compra`, `taquilla` y `admin` como datos y atributo: misma paleta.
- Componentes: `TicketButton` (primario hueso), `Field`, `Money`, `NamedStatus`, `ParameterCard`, `BlackTicketRoot`.
- `formatTicketAmount`: `$1,250.00` y `−$120.00`.
- El `Button` anterior queda como está, para no cambiar las pantallas que ya lo usan.

## Siguiente

Reenvío del comprador y captura de CLABE no existen en el API público (haría falta `POST /orders/:publicId/resend` con token de orden y `PATCH /refunds/:id/clabe` con validación de CLABE).
Endpoints que el admin llama y dan 404: `ai/*` (summaries, anomalies, recommendations, fraud/risk, segmentation), `memberships/organization/:org/*`, `pricing/events/:id/recommendations` y `/pending`, `events/schedule/series` (no hay lectura de series; `events/schedule/preview` tampoco existe y bloquea Crear serie).
`lib/queries` tipa `/admin/orders` como arreglo con `totalAmount`; el API manda sobre paginado con `expectedAmount`. Las páginas lo toleran; conviene corregir el tipo.
Lint de api y web y `format:check` del monorepo ya fallaban en main antes de este turno (ESLint sin config; ~200 archivos, sobre todo `dist/`).
Visor 3D del paquete `@boletera/venue-3d` conserva su estilo viejo (insignia roja, escenario rosa).
Canales: Stepper de 1 en 1 para el reparto es lento; la barra Guardar queda a media página.

## Ajuste de reglas compartidas — Codex, 2026-10-31
Se alinearon instrucciones genericas de Cursor con AGENT-POLICY y LOCAL-DELEGATION: instructores autonomos, main y un escritor por archivo; sin handoff automatico ni worktrees. Solo documentos de reglas; sin cambios de codigo. Se conservan A medias/Siguiente/No tocar anteriores. Verificacion: diff de reglas y comprobacion de rama.
