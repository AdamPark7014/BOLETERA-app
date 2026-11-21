# Plan maestro de Black Ticket (21-11-2026)

Documento completo, con la ingeniería inversa de los líderes, la matriz de brechas y las fuentes:
https://claude.ai/artifact/Tk4BCC2qe5dPJ1aYMgSUhw

## Fases (en orden; cada una cierra con una prueba visible)

0. **Cierres**: ficha en escritorio con mapa completo y panel fijo, PDF y reenviar en el boleto, titular y puerta en la cartera, cartelera sin pasados, desglose en reventa.
1. **Dinero y cumplimiento**: lineamientos PROFECO (DOF 19-02-2026), MSI al banco, pagos a vendedores de reventa, liquidaciones con conciliación, CFDI con proveedor real en pruebas. Prueba: compra + reventa + reembolso cuadran al centavo.
2. **Día de venta**: carga de 5,000 y 20,000 compradores, caché de borde, fila atada a cuenta verificada y validada en el pago, límites por comprador, tablero de operación en vivo. Prueba: 20,000 simulados sin sobreventa ni 5xx.
3. **Organizador**: editar y clonar eventos, rejilla de precios con escenarios, administrar fila y preventas, embudo y meta, enlaces de seguimiento, controles de reventa por evento. Prueba: evento con preventa y fila publicado y vendiendo en menos de 10 min.
4. **Boleto en el teléfono**: Google Wallet con código que rota, Apple Wallet, app de iOS, app de escaneo. Prueba: el mismo boleto entra desde web, Android, iOS y billetera.
5. **Público y recurrencia**: segmentos, campañas por correo y WhatsApp, recordatorios, carrito abandonado, abonos con asiento fijo.
6. **Plataforma**: API pública con llaves y webhooks, tienda incrustable y dominio propio, torniquetes de terceros, escaneo de salida y aforo, kiosco y terminal bancaria.

## Reglas

- La regla de negocio vive en la API; web, taquilla, Android e iOS la consumen.
- Estados de carga, vacío, error y éxito; revisión a 390 y 1440 px.
- Cierre de fase con una línea por plataforma: Web, API, Android, iOS.
- El precio nunca cambia dentro de una compra en curso.
- Cursor escribe (encargos en `.ai/drafts/encargo-NN-*.md`, lanzado desde PowerShell); Claude encarga, revisa en la demo, prueba y sube.
