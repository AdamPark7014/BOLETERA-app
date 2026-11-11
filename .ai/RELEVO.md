# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-11-11
- **Rama:** main

## Hecho

- 2026-11-11 claude-code (2.ª tanda): series con lista, detalle, vista previa, extender y estado (`events/schedule/*`); crear serie ya guarda `EventSeries`.
- 2026-11-11 claude-code: membresías (módulo nuevo, migración `20261111230000_memberships`) y recomendaciones de precio deterministas con cola de aprobación (migración `20261111231000_pricing_recommendations`). `update-dynamic`, `revenue-estimate` e historial de oferta ahora exigen sesión y organización.
- 2026-11-11 claude-code: comprador: `POST /orders/:publicId/resend` (1/min, 3/h) y `PATCH /orders/:publicId/refunds/:refundId/clabe` con dígito verificador (migración `20261111220000_refund_payout_clabe`). `GET /admin/orders/:id` enmascara la CLABE salvo ADMIN, SUPER_ADMIN y FINANCE.
- 2026-11-11 claude-code: IA del admin (`/ai/*`) calculada con datos reales, sin modelo de lenguaje; sin fuente responde vacío con `reason`.
- 2026-11-11 claude-code: canales con campo numérico (Stepper `editable`); visor 3D con tokens BT; pósters con respaldo local y fotos de stock vigentes.
- 2026-11-11 claude-code: `pnpm run lint` y `format:check` en verde (ESLint en api y web; Prettier desde la raíz con `.prettierignore`; formateo masivo en su propio commit).
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

Antes de desplegar: correr las tres migraciones nuevas (`prisma migrate deploy`) y volver a sembrar o actualizar las fotos de eventos si la base vieja aún apunta a las de Unsplash que daban 404.
Permisos del front: `price:write` depende de VENUES_EDIT y `memberships.manage` de EVENTS_READ en `apps/admin/lib/use-session.ts`; el promotor ve Precios en solo lectura aunque el API le deja aplicar. Decidir con Adam.
Membresías: renovar y dar de alta solo registran un cobro hecho fuera; falta el flujo de compra en web. SEASON vale 12 meses (el plan no tiene fechas de temporada).
Precios: con `enableDynamic`, el checkout aplica su propio surge encima del `basePrice` ya ajustado por una recomendación (posible doble ajuste).
IA: sin chat ni acciones persistentes en el API (el chat es local, por plantillas). Aprobación de pagos, accesos, comparables, abandono e impacto estimado sin fuente.
Series: `scheduling-api.ts` apunta a más rutas `events/schedule/*` que no existen (alta directa, funciones sueltas, ventanas, calendario, bloqueos); ninguna pantalla actual las llama. Crear serie no crea Offer.
Visor 3D: también lo usan la compra web, InventoryPanel y venue-3d-studio; revisar ahí los colores nuevos. Quedan `.js` compilados viejos en `packages/venue-3d/src/`.
Lint: 26 avisos (any, variables sin uso, dependencias de efectos), ningún error.

## Ajuste de reglas compartidas — Codex, 2026-10-31
Se alinearon instrucciones genericas de Cursor con AGENT-POLICY y LOCAL-DELEGATION: instructores autonomos, main y un escritor por archivo; sin handoff automatico ni worktrees. Solo documentos de reglas; sin cambios de codigo. Se conservan A medias/Siguiente/No tocar anteriores. Verificacion: diff de reglas y comprobacion de rama.
