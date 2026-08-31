# Personas — Boletera Platform

> Borrador **0.1** · 2026-08-31 · rama `mejora/worker-y-tests`
> Cada persona se identifica por su **puesto**, no por un nombre propio.

**Aviso de honestidad:** ninguna de estas personas viene de haber entrevistado a un
usuario. Son inferencias a partir de lo que el sistema ya modela (roles, canales,
métodos de pago) y del mercado mexicano. Son **hipótesis con puesto**, no hallazgos.
Dejan de valer en cuanto haya entrevistas que las contradigan — esa es su función.

---

## Método (los 5 pasos y dónde vamos)

| Paso | Qué pide | Qué se hizo | Estado |
|---|---|---|---|
| 01 | Recolectar datos amplios de usuarios objetivo | Inventario de roles, canales, métodos de pago y decisiones de operación ya tomadas | Hecho con datos internos |
| 02 | Determinar cualidades y diferencias | Seis ejes de comportamiento + matriz | Hecho |
| 03 | Formular hipótesis desde la investigación | Cinco hipótesis falsables con su prueba | Hecho |
| 04 | Acuerdo de stakeholders sobre la hipótesis | Quién firma, qué está en disputa, cómo se cierra | **Pendiente: falta la sesión** |
| 05 | Cuántas personas, con foco en una | 1 primaria + 4 secundarias + 1 antipersona | Propuesto |

**Regla de foco:** a la primaria se le satisface *por completo*; a las demás basta con
no dejarlas insatisfechas. Si una decisión obliga a elegir, gana la primaria.

---

## 01 · Datos

**Ya tenemos (interno, verificable en el repo):**
- 15 roles en `UserRole`: `CUSTOMER`, `PROMOTER`, `VENUE_MANAGER`, `TAQUILLA`,
  `TAQUILLA_SUPERVISOR`, `SCANNER`, `FINANCE`, `AUDITOR`, etc.
- 13 canales en `SalesChannel` (WEB, TAQUILLA, COURTESY, CORPORATE, PHONE, AFFILIATE,
  RESALE…): el producto ya asume venta multicanal.
- Métodos de pago mexicanos reales: CARD, SPEI, OXXO, CASH.
- Decisiones tomadas por presión de operación: PIN de cash-drop, corte Z térmico,
  QR vivo (`OrderQrCards`), refunds con cierre manual auditado.
- `docs/RUNBOOK_ONSALE.md`: lo que se teme el día del on-sale.

**Falta (nadie lo ha hecho todavía):**
- 8 entrevistas: 3 promotores, 2 jefes de taquilla, 1 operador de recinto, 2 contadoras.
- 2 noches de campo detrás de la ventanilla, con cronómetro.
- Embudo de compra móvil: dónde se cae la gente entre mapa y pago.
- Tickets de soporte del trimestre, clasificados por quién los abre.
- % de venta en las últimas 72 h y % de venta en puerta el mismo día.

---

## 02 · Ejes de diferenciación

Presión de tiempo · Frecuencia de uso · Manejo de efectivo · Dinero en riesgo ·
Condiciones físicas · Ante quién responde.

| Persona | Presión | Frecuencia | Efectivo | Dinero en riesgo | Condiciones | Responde ante |
|---|---|---|---|---|---|---|
| La promotora | media | media | media | **alta** | baja | artista, socio, banco |
| El comprador | **alta** | baja | media | baja | **alta** | sus amigos |
| La taquillera | **alta** | **alta** | **alta** | media | **alta** | jefe de taquilla |
| El operador del recinto | **alta** | media | baja | media | **alta** | Protección Civil |
| La contadora | baja | media | media | **alta** | baja | SAT y promotor |

---

## 03 · Hipótesis falsables

| # | Hipótesis | Cómo se comprueba | Qué la tira |
|---|---|---|---|
| H1 | La venta se concentra al final: buena parte del aforo se decide en las últimas 72 h y una porción relevante se vende en puerta el mismo día | Curva de venta por hora de los últimos 20 eventos, por canal | Que taquilla sea marginal → el POS deja de ser diferenciador |
| H2 | El comprador abandona por la *sorpresa* del cargo por servicio, no por el monto | Embudo móvil + A/B con precio total desde la primera pantalla | Que el abandono no se mueva → el problema es el mapa, no el precio |
| H3 | La promotora elige boletera por velocidad de pago y comisión, no por features | 8 entrevistas sobre el último cambio de proveedor | Que mencionen primero mapas/marketing → otro argumento de venta |
| H4 | En taquilla, PIN corto + botones grandes valen más que cualquier función avanzada | 2 noches de campo: segundos por venta, errores por turno | Que el cuello de botella sea la terminal bancaria |
| H5 | El QR estático se reenvía por WhatsApp y genera duplicados en puerta | Conteo de escaneos repetidos por evento y puerta | Que casi no haya duplicados → QR vivo es complejidad sin retorno |

---

## 04 · Acuerdo de stakeholders (pendiente)

**Firman:** producto · un promotor piloto real · el jefe de taquilla del recinto piloto ·
la contadora de ese promotor · ingeniería (para poner precio a cada compromiso).

**En disputa:**
1. **Quién es la primaria.** Comercial dirá que el comprador (es el volumen). La
   propuesta es la promotora: ella firma el contrato y, si se va, se lleva a sus
   compradores.
2. **Cuánto pesa el efectivo.** Si H1 falla, la taquillera baja de rango y la
   inversión se va al checkout móvil.
3. **Reventa: ¿combatir o administrar?** Tener módulo de reventa oficial ya es postura.

**Cómo se cierra:** sesión de 90 min con las fichas impresas; cada quien marca su
primaria *antes* de discutir; se decide con H1 y H3 sobre la mesa; lo acordado se
fecha y se versiona aquí.

---

## 05 · Las personas

| Quién | Rango | Rol | Dónde vive | Lo que no puede fallar |
|---|---|---|---|---|
| La promotora | **Primaria** | `PROMOTER` | `apps/admin` | Saber cuánto lleva vendido y cuándo le pagan |
| El comprador de último minuto | Secundaria | `CUSTOMER` | `apps/web` | Comprar en móvil con prisa y creerle al boleto |
| La taquillera | Secundaria | `TAQUILLA` | `apps/taquilla` | Cobrar rápido y que el corte cuadre |
| El operador del recinto | Secundaria | `VENUE_MANAGER` | acceso + mapas | Que nadie entre dos veces y el aforo sea real |
| La contadora del promotor | Secundaria | `FINANCE` | reportes/payouts/billing | Cuadrar el evento y timbrar sin rechazos |
| El revendedor | **Antipersona** | — | on-sale + resale | Que no se salga con la suya |

### La promotora — PRIMARIA
*Contrata la plataforma y responde por el evento.*
34 años, Guadalajara, 14 eventos/año en foros de 400–1,200. Ella, un socio y dos
personas por evento. WhatsApp para todo, Instagram, hoja de cálculo de cortesías.
Laptop de cinco años.

> "No necesito más botones. Necesito saber, a las ocho de la noche, cuánto llevo
> vendido y cuánto me va a quedar."

- **Quiere:** llenar sin quemar el margen · publicar de noche sin llamar a nadie ·
  cobrar pronto · repetir con el mismo recinto.
- **La quema:** liquidación a 21 días · cortesías que pasan de 50 a 200 sin dueño ·
  no poder separar web / taquilla / cortesía · mapa publicado distinto al que creía.
- **Momento clave:** martes 11 pm, cierra fecha a 7 semanas y necesita publicar hoy
  con preventa jueves, público viernes y bloque de cortesías apartado.
- **Obliga a construir:** panel que responde en 5 s (vendido hoy / total / neto /
  fecha de depósito) · cortesías con tope y autorización nominal · fases de venta
  autoservicio · **nunca inventarle un número** (los stubs honestos van en esa línea).
- **Métrica:** publicar evento completo en < 12 min sin soporte · % de eventos
  montados sin ayuda.

### El comprador de último minuto — secundaria
*Decide con sus amigos, en el camión, la noche anterior.*
23 años, Monterrey, primer empleo. Android de gama media, datos limitados. Compra 2–3
boletos decididos en un grupo de WhatsApp. Débito u OXXO.

> "Ya vamos, ¿no? Nada más déjame ver si todavía hay juntos y que no salga carísimo
> con lo del servicio."

- **Quiere:** entrar con sus amigos, juntos, sin gastar de más · saber el precio final
  antes de elegir lugar · una prueba de que el boleto es real.
- **Lo quema:** cargo por servicio hasta el final · mapa que no se usa con un pulgar ·
  el cronómetro del hold corriendo mientras el grupo decide · pagar en OXXO y no saber
  si se acreditó.
- **Momento clave:** viernes 7:40 pm, en el camión, una barra de señal, el evento es
  mañana. Si el flujo se rompe una vez, escribe "ya no alcancé".
- **Obliga a construir:** precio total desde la primera pantalla · hold honesto (tiempo
  visible + renovar + aviso al soltarse) · estado de OXXO/SPEI en su idioma · QR que se
  renueva solo dentro de la orden.
- **Métrica:** conversión móvil del carrito · % de holds expirados · tickets de "pagué
  y no me llegó".

### La taquillera — secundaria
*Cobra en efectivo, en la ventanilla, contratada por evento.*
41 años, 3–4 noches al mes. Ventanilla, poca luz, ruido, fila de 60. Terminal +
impresora térmica + terminal bancaria aparte. Capacitación: 10 minutos.

> "Yo lo que no quiero es quedar a deber en el corte. Si el sistema se cae, cobro en
> papel y luego vemos."

- **Quiere:** que la fila avance · no equivocarse con el cambio · irse con el corte
  cuadrado y firmado.
- **La quema:** internet del recinto a media fila · contraseña larga cada bloqueo ·
  depender del supervisor para cancelar · traer $8,000 en caja sin forma de sacarlos.
- **Momento clave:** 20:55, doce minutos para abrir, cuatro generales en efectivo, una
  tarjeta que rebota y cash-drop con PIN mientras el siguiente ya puso el dinero.
- **Obliga a construir:** botones grandes y pocos · PIN en vez de contraseña · corte Z
  impreso que cuadre solo con desglose por método · modo degradado sin internet.
- **Métrica:** segundos por venta · diferencia de caja en el corte · ventas caídas por red.

### El operador del recinto — secundaria
*Responde por el aforo ante Protección Civil.*
47 años, foro de 1,400 con tres puertas, seis escaneadores con celulares prestados.
El Wi-Fi no llega al lobby.

> "A mí no me multan por vender poco. Me multan por meter más gente de la que cabe."

- **Quiere:** abrir a la hora · saber cuánta gente hay adentro por puerta · que el mapa
  vendido sea la sala real.
- **Lo quema:** el mismo boleto en tres capturas · escáneres sin señal donde se forma
  la gente · mapas publicados sin revisión · no enterarse de bloques de cortesías.
- **Momento clave:** 21:10, 900 escaneados, dos duplicados trabados en la puerta B con
  treinta personas empujando; 15 segundos para decidir.
- **Obliga a construir:** boleto vivo, no imagen · escaneo offline que resuelva quién
  pasó primero al sincronizar · tablero de aforo por puerta · mapas con estado
  explícito (`DRAFT` / `IN_REVIEW` / `PUBLISHED`) y prohibido vender sobre borrador.
- **Métrica:** duplicados por evento · segundos de escaneo · aforo del sistema vs conteo físico.

### La contadora del promotor — secundaria
*Cuadra el evento el lunes siguiente.*
38 años, lleva la contabilidad de tres promotores. Su herramienta real es la hoja de
cálculo.

> "El reporte está bonito, pero no me cuadra con el estado de cuenta. Y al SAT no le
> enseño una gráfica."

- **Quiere:** que el depósito del banco coincida al peso · timbrar sin rechazos ·
  devolver un boleto sin desbalancear la caja.
- **La quema:** reportes que no separan comisión / efectivo / cortesías · refund ya
  hecho en el portal Banorte que el sistema sigue marcando pendiente · exportaciones
  sucias · enterarse tarde de que CFDI estaba en sandbox.
- **Momento clave:** lunes por la mañana, 1,180 boletos entre tarjeta, OXXO, SPEI,
  efectivo, 96 cortesías y 9 reembolsos — uno hecho a mano en el portal del banco.
- **Obliga a construir:** corte por canal y método que sume lo depositado · exportación
  contable limpia · refunds con rastro y evidencia (cierre manual incluido) · estado de
  CFDI visible y honesto mientras siga en sandbox.
- **Métrica:** minutos para cerrar el corte · % de refunds cerrados sin soporte ·
  facturas rechazadas.

### El revendedor — ANTIPERSONA
Guiones automatizados, varias cuentas, objetivo: vaciar la zona cara en el minuto uno.
El daño se lo hace al comprador, a la promotora y al artista.

Está aquí porque **toda decisión que no lo considera termina beneficiándolo**: cada
facilidad para el comprador honesto (hold generoso, compra sin fricción, boleto
transferible) es también una facilidad para él.

- Límite por comprador y evento, con fricción progresiva ante patrón repetido.
- Reventa oficial con precio tope: si el secundario existe, que ocurra adentro.
- Boleto que cambia, para que la captura no se pueda revender.
- **Regla:** ninguna medida contra él puede costarle al comprador más de un paso extra.

### Fuera de alcance a propósito
Operador internacional multimoneda · artista con panel propio · patrocinador con
reporte de activaciones. Reales en el mercado, no en este producto en esta etapa.
Escribirlos ahora solo justificaría funciones que nadie ha pedido.

---

## 06 · Plan de validación (3 semanas)

| Semana | Qué se hace | Qué queda |
|---|---|---|
| 1 | Datos que ya existen: curva de venta por hora y canal (20 eventos), embudo móvil, tickets de soporte clasificados | H1, H2 y H5 resueltas sin hablar con nadie |
| 2 | 8 entrevistas de 45 min + 2 noches de campo en taquilla con cronómetro | H3 y H4 resueltas; citas textuales sustituyen a las frases inventadas |
| 3 | Sesión de acuerdo con fichas corregidas; se firma la primaria y el orden | Versión 1.0 fechada aquí + lista de decisiones de producto que cambian |
