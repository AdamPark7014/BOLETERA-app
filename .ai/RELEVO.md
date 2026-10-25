# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-10-24
- **Rama:** main

## Hecho

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

Faltan el resto de secciones de admin. Reenvío del comprador y captura de CLABE no existen en el API público.
