# RELEVO

- **Último turno:** cursor
- **Fecha:** 2026-10-24
- **Rama:** main

## Hecho

- 2026-10-24 cursor: admin de eventos en lenguaje visual (lista, ficha, agenda, zonas, canales). El alta no crea Offer: el arreglo es del API.

Lenguaje visual de Black Ticket en `@boletera/ui`.
- Taquilla (`apps/taquilla`): lienzo `BlackTicketRoot` densidad taquilla, Cobrar fijo, folio tras el cobro.
- Compra pública de `apps/web` redibujada con `BlackTicketRoot` densidad compra: cartelera, ficha, zona, apartado, datos, pago, boleto y cuenta. Reenvío y CLABE de reembolso no tienen API de comprador.

- Tokens y tema oscuro único, opt-in con `data-black-ticket`. Densidades `compra`, `taquilla` y `admin` como datos y atributo: misma paleta.
- Componentes: `TicketButton` (primario hueso), `Field`, `Money`, `NamedStatus`, `ParameterCard`, `BlackTicketRoot`.
- `formatTicketAmount`: `$1,250.00` y `−$120.00`.
- El `Button` anterior queda como está, para no cambiar las pantallas que ya lo usan.

## Siguiente

Faltan el resto de secciones de admin. El alta no crea Offer (API). Reenvío del comprador y captura de CLABE no existen en el API público.
