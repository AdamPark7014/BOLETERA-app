# Mapas de experiencia — Boletera Platform

> Borrador **0.1** · 2026-09-02 · rama `mejora/worker-y-tests`
> Continúa `docs/PERSONAS.md`. Sin esas personas, estos mapas no se sostienen:
> un mapa siempre es *de alguien*, nunca del producto.

**Aviso de honestidad.** Los mapas heredan la deuda de las personas: nadie ha
observado todavía a un usuario real. Por eso cada fricción va marcada con una de
dos etiquetas, y no se mezclan nunca:

- **✔ verificado** — se comprueba leyendo el repo. Va con archivo y línea.
- **? hipótesis** — habría que observarlo. Va con la hipótesis `H1`–`H5` de
  `PERSONAS.md` que lo cubre.

Un mapa lleno de "?" no es un mapa malo: es la lista de lo que hay que ir a ver.
Lo grave sería no distinguirlos.

---

## 01 · Método

Las personas contestan **quién**. Los mapas contestan **qué le pasa, en qué
orden y dónde se le cae el ánimo**. Se hacen en este orden porque un mapa sin
persona termina siendo el diagrama de flujo del sistema con caritas encima.

| Instrumento | Pregunta que responde | Alcance | Dónde |
|---|---|---|---|
| Journey map | ¿Qué vive de principio a fin y dónde se rompe? | Una persona, un ciclo completo | §02–§06 |
| Blueprint de servicio | ¿Qué tiene que ocurrir por debajo para que eso funcione? | El sistema entero, un momento | §07 |
| Mapa de empatía | ¿Qué piensa y siente en el instante de más tensión? | Una persona, un minuto | §08 |
| Mapa de oportunidades | ¿Qué hacemos el lunes? | Producto | §10 |

**Cómo se lee cada journey.** Fase · qué hace · dónde ocurre (ruta real de la
app) · qué piensa · ánimo · fricción · oportunidad.

**Escala de ánimo:** `▲▲` bien y con confianza · `▲` bien · `·` neutro ·
`▼` incómodo · `▼▼` a punto de abandonar o de llamar por teléfono.

**Lo que a propósito no se mapea:** ecosistema competitivo, artista y
patrocinador. Están fuera de alcance en `PERSONAS.md` y mapearlos aquí sería
justificar funciones que nadie pidió.

---

## 02 · Journey — La promotora (PRIMARIA)

### «De la fecha cerrada al dinero en el banco»

Ciclo completo: ~10 semanas. Es el mapa que manda: si una decisión obliga a
elegir, gana esta curva.

| # | Fase | Qué hace | Dónde | Qué piensa | Ánimo |
|---|---|---|---|---|---|
| 1 | Elige plataforma | Compara comisión y días de liquidación | Fuera del producto | «¿Cuándo me pagan y cuánto me quedo?» | `·` |
| 2 | Monta el evento | Alta, recinto, mapa, precios, fases | `admin/(platform)/events`, `/venues`, `/maps`, `/pricing` | «Esto lo tengo que dejar listo hoy» | `▼` |
| 3 | Publica y preventa | Abre preventa, manda la liga por WhatsApp/IG | `/events` → `web/events/[slug]` | «Ya está afuera, a ver qué pasa» | `▲` |
| 4 | On-sale | Mira vender en vivo | `/dashboard`, `/analytics` | «¿Va o no va?» | `▲▲` o `▼▼` |
| 5 | Meseta | Ajusta precio, mete cortesías, promociona | `/pricing`, `/inventory`, `/campaigns` | «Me faltan 300 y quedan tres semanas» | `▼` |
| 6 | Últimas 72 h | Vigila la curva hora por hora | `/dashboard`, `/reports` | «Se decide ahorita» | `▲` |
| 7 | Noche del evento | Puerta, taquilla, incidencias por WhatsApp | `apps/taquilla`, `/scanner` | «Que no se caiga nada» | `·` |
| 8 | Corte y depósito | Espera el estado de cuenta y el payout | `/reports`, `/payouts` | «¿Cuánto me quedó de verdad?» | `▼▼` |
| 9 | Repite o se va | Decide la siguiente fecha con el mismo proveedor | Fuera del producto | «¿Me conviene quedarme?» | `·` |

**La curva:** `· ▼ ▲ ▲▲ ▼ ▲ · ▼▼ ·` — sube sola en el on-sale y se hunde en el
montaje (fase 2) y en el cobro (fase 8). Son los dos valles donde se pierde un
cliente, y ninguno de los dos es una función que falte: son **espera** y
**opacidad**.

### Fricciones por fase

| Fase | Fricción | Tipo | Evidencia / hipótesis |
|---|---|---|---|
| 2 | El montaje toca cinco secciones distintas (evento, recinto, mapa, precios, fases) sin un hilo que las una | ✔ verificado | Rutas separadas en `apps/admin/app/(platform)/` |
| 2 | Publicar sobre un mapa en borrador y no enterarse | ? hipótesis | El estado explícito `DRAFT`/`IN_REVIEW`/`PUBLISHED` es requisito del operador del recinto |
| 4 | El panel tarda, o no distingue web / taquilla / cortesía | ? hipótesis | `H1` — hace falta la curva por canal de 20 eventos |
| 5 | Las cortesías crecen sin dueño ni tope | ? hipótesis | `SalesChannel.COURTESY` existe; el control nominal, no |
| 8 | El depósito no coincide con el reporte | ? hipótesis | `H3`; el job `pending-payouts` existe (`apps/worker/src/jobs/pending-payouts.ts`), el riel bancario real no |
| 8 | Un refund cerrado a mano en el portal Banorte deja el sistema en «pendiente» | ✔ verificado | Refunds con cierre manual auditado, `apps/api/src/modules/reconciliation` |

Oportunidades que salen de este mapa → §10 (O1, O2, O7).

---

## 03 · Journey — El comprador de último minuto

### «Del grupo de WhatsApp a la puerta»

Ciclo completo: nueve minutos, en un camión, con una barra de señal. Es el mapa
donde está el volumen y donde más barato sale arreglar las cosas.

| # | Fase | Qué hace | Dónde | Qué piensa | Ánimo |
|---|---|---|---|---|---|
| 1 | Llega | Abre la liga que le mandaron | `web/events/[slug]` | «A ver si todavía hay» | `▲` |
| 2 | Elige lugares | Mueve el mapa con el pulgar, busca dos juntos | `web/components/seatmap` | «Estos dos están bien» | `·` |
| 3 | **Ve el precio real** | Pasa al carrito y aparece el cargo por servicio | `web/app/cart` | «¿Por qué subió?» | `▼▼` |
| 4 | Paga | Tarjeta, o referencia OXXO/SPEI | `web/app/checkout` | «Ojalá pase a la primera» | `▼` |
| 5 | Espera | Si fue OXXO/SPEI, espera la acreditación | `orders/[publicId]` + `DeferredPaymentPanel` | «¿Ya quedó o no?» | `▼` |
| 6 | Recibe el boleto | Abre el QR y se lo enseña a sus amigos | `web/components/OrderQrCards.tsx` | «Ya está, es real» | `▲▲` |
| 7 | Entra | Lo escanean en la puerta | `taquilla/acceso` | «Que no me batallen» | `▲` |

**La curva:** `▲ · ▼▼ ▼ ▼ ▲▲ ▲` — un solo hoyo, profundo y temprano, en la
fase 3.

### El hoyo de la fase 3 está verificado, no supuesto

`apps/web/lib/pricing.ts` lo dice con todas sus letras: en México el precio
anunciado tiene que ser el que se cobra, y `POST /pricing/calculate-cart` es
**público**, así que no hay excusa para enseñar solo el subtotal.

Pero ese helper se usa en `cart`, `checkout`, `cuenta` y `orders/[publicId]` —
**no en la página del evento**. Ahí, en
`apps/web/app/events/[slug]/EventPurchaseClient.tsx:658`, la etiqueta dice
**«Total $…»** sobre una suma de `basePrice`: sin cargo por servicio y sin IVA.
El comprador elige asiento contra un número que se llama total y no lo es, y
descubre el verdadero una pantalla después.

Eso no es un debate de diseño: es exactamente la sorpresa que `H2` acusa de
provocar el abandono, y el propio repo ya tomó postura en contra por escrito.
Es la primera oportunidad de la lista (O3).

### Lo que ya está bien resuelto y no hay que tocar

Un mapa también sirve para decir dónde **no** gastar:

- **El contador del hold es honesto.** `web/components/HoldCountdown.tsx`
  recalcula siempre contra el `expiresAt` del servidor, nunca con un decremento
  local: al volver de segundo plano el número salta a la realidad en vez de
  mentir. Y admite renovar (`onRenew`). El mismo componente cubre el reloj largo
  del pago diferido OXXO/SPEI.
- **El pago diferido tiene pantalla propia** (`DeferredPaymentPanel`) y un job
  que lo concilia (`apps/worker/src/jobs/reconcile-spei.ts`).
- **El QR es vivo**, no una imagen reenviable (`OrderQrCards`).

Fricciones que quedan en este mapa: el mapa de asientos con el pulgar (fase 2,
`? H2`) y la desconfianza del «pagué en OXXO y no sé si quedó» (fase 5, `?`),
que es de comunicación, no de sistema.

---

## 04 · Journey — La taquillera

### «De la apertura al corte Z»

Ciclo: una noche. Poca luz, ruido, fila de sesenta y diez minutos de
capacitación.

| # | Fase | Qué hace | Dónde | Qué piensa | Ánimo |
|---|---|---|---|---|---|
| 1 | Abre turno | Entra y elige evento | `taquilla/login`, `/eventos` | «Que agarre la sesión» | `·` |
| 2 | Cobra | Efectivo, tarjeta, general o numerado | `/venta` | «Que avance la fila» | `▲` |
| 3 | Se cae la red | Sigue cobrando con la cola offline | `taquilla/lib/offline-queue.ts` + `NetStatus` | «¿Esto se está guardando?» | `▼` |
| 4 | Incidencia | Cancela o corrige una venta | `/venta`, `/buscar` | «Necesito al supervisor» | `▼▼` |
| 5 | Cash-drop | Saca efectivo de la caja con PIN | `/corte` | «Ya traigo mucho dinero aquí» | `·` |
| 6 | Corte Z | Imprime y cuadra por método | `/corte` | «Que no me falte» | `▲` o `▼▼` |
| 7 | Entrega | Firma y se va | Físico | «Cuadró» | `▲▲` |

**La curva:** `· ▲ ▼ ▼▼ · ▲ ▲▲` — todo el riesgo emocional está en las fases 3
y 4, y las dos son **momentos de duda**, no de lentitud.

### Lo verificado

- La venta sin red **existe y es idempotente**: `taquilla/lib/offline-queue.ts`
  encola en IndexedDB con un `clientSaleId` estable, y el servidor resuelve
  contra `Order.(organizationId, clientSaleId)`. Nadie cobra dos veces por
  reintentar.
- Hay indicador de red visible (`taquilla/components/NetStatus.tsx`).
- Cash-drop con PIN y corte Z con desglose por método viven en `/corte`
  (`taquilla/lib/pos.ts` + `apps/api/src/modules/taquilla-pos`).

### Lo que el mapa deja al descubierto

| Fase | Fricción | Tipo |
|---|---|---|
| 3 | La cola offline funciona, pero ella no tiene forma de saber cuántas ventas trae pendientes ni si ya subieron: es confianza ciega a media fila | ✔ verificado (no hay contador de cola en la pantalla de venta) |
| 4 | Depender del supervisor para cancelar detiene la fila entera | ? `H4` |
| 6 | Si el corte no cuadra a las 2 am, no hay a quién preguntarle | ? `H4` — se resuelve con dos noches de campo |

---

## 05 · Journey corto — El operador del recinto

### «Los quince segundos de la puerta B»

| # | Fase | Qué hace | Dónde | Ánimo |
|---|---|---|---|---|
| 1 | Prepara | Descarga el manifiesto del evento | `taquilla/lib/manifest.ts` | `▲` |
| 2 | Abre | Tres puertas, seis escaneadores prestados | `/acceso` | `·` |
| 3 | Escanea | Ritmo alto, Wi-Fi que no llega al lobby | `/acceso` | `▼` |
| 4 | **Duplicado** | El mismo boleto otra vez, treinta personas empujando | `/acceso` | `▼▼` |
| 5 | Sincroniza | Aparecen los `conflicts` de otras puertas | `manifest.ts` | `▼` |
| 6 | Cierra aforo | Compara sistema contra conteo físico | `/scanner`, `/access-control` | `·` |

**Aquí el producto ya hizo lo difícil, que es no mentir.**
`taquilla/lib/manifest.ts` documenta —y la pantalla muestra— lo que el modo sin
red **no** garantiza: no verifica la firma rotativa del QR, no conoce reembolsos
posteriores a `issuedAt`, y no detecta duplicados de *otra* puerta también sin
red; eso solo aparece como `conflicts` al sincronizar
(`apps/taquilla/app/acceso/page.tsx:592`).

La fricción que queda no es de información, es de **decisión**: a las 21:10, con
gente empujando, saber que «no se puede verificar» no le dice si deja pasar o
retiene. Falta una política por evento —dejar pasar y marcar, o retener— que se
configure antes y aparezca como instrucción en pantalla, no como advertencia
(O5).

---

## 06 · Journey corto — La contadora

### «El lunes del corte»

| # | Fase | Qué hace | Dónde | Ánimo |
|---|---|---|---|---|
| 1 | Exporta | Baja el reporte del evento | `admin/(platform)/reports` | `·` |
| 2 | Cuadra | Compara contra el estado de cuenta del banco | Su hoja de cálculo | `▼▼` |
| 3 | Persigue refunds | Uno se hizo a mano en el portal Banorte | `/orders` + reconciliation | `▼` |
| 4 | Timbra | CFDI 4.0 | `/api/v1/billing/:orgId/cfdi/stamp` | `▼` |
| 5 | Entrega | Manda el cierre al promotor | WhatsApp / correo | `▲` |

Dos verdades del repo que hay que enseñarle **antes** de que las descubra sola:
CFDI corre en **sandbox** y Banorte en **modo demo** sin credenciales reales
(`README.md`). Un estado visible y honesto de ambos sale más barato que una
llamada el lunes (O6).

---

## 07 · Blueprint de servicio — el on-sale móvil

El journey del comprador visto por debajo. Las tres líneas clásicas
—interacción, visibilidad, interacción interna— separan lo que él ve de lo que
sostiene la promesa.

| Capa | 1 · Llega | 2 · Elige | 3 · Paga | 4 · Espera | 5 · Entra |
|---|---|---|---|---|---|
| **Evidencia física** | Liga de WhatsApp/IG | Mapa del recinto | Total y método | Correo / referencia | QR en el celular |
| **Acción del comprador** | Abre el evento | Selecciona asientos | Confirma pago | Revisa si se acreditó | Se deja escanear |
| *— línea de interacción —* | | | | | |
| **Frontstage** (`apps/web`) | `events/[slug]`, sala de espera | `components/seatmap`, `HoldCountdown` | `checkout` | `orders/[publicId]`, `DeferredPaymentPanel` | `OrderQrCards` |
| *— línea de visibilidad —* | | | | | |
| **Backstage** (API) | `discovery`, `tenant` | `inventory` (holds), `pricing` | `orders`, `payment` | `reconciliation`, `notification` | `access` |
| *— línea de interacción interna —* | | | | | |
| **Soporte** | Postgres · caché de tenant | Redis (hold) + DB | `packages/payments` → Banorte **demo** | Worker: `reconcile-spei`, `expire-holds` | Firma del QR · manifiesto |
| **Falla posible** | F1 sala de espera mal calibrada | F2 el hold expira mientras el grupo decide | F3 el total no es el anunciado | F4 SPEI/OXXO sin conciliar | F5 duplicado sin red |
| **Qué la contiene hoy** | — | `HoldCountdown` honesto + renovar ✔ | **nada en la fase 2** ✘ | `reconcile-spei` + panel ✔ | `conflicts` al sincronizar ✔ |

De las cinco fallas, cuatro ya tienen contención construida. La que no la tiene
—**F3**— es justo la del valle más profundo del journey del comprador. Ese es el
hallazgo del blueprint.

---

## 08 · Mapas de empatía (los dos instantes de más tensión)

### La promotora — martes, 8:00 pm del on-sale

| | |
|---|---|
| **Ve** | Un panel con números que no separan canal · WhatsApp del socio · Instagram con 40 comentarios |
| **Oye** | «¿Ya vendimos?» del artista · el socio preguntando si sube el precio |
| **Piensa y siente** | «Si esto no llena, lo pago yo» · orgullo si sube, pánico frío si no |
| **Dice y hace** | Refresca el panel cada dos minutos · manda capturas · piensa en meter cortesías |
| **Dolores** | No saber si el número incluye taquilla y cortesías · no poder explicar el neto |
| **Ganancias** | Un número en el que confía, a las ocho de la noche, sin pedirle nada a nadie |

### El comprador — viernes, 7:40 pm, en el camión

| | |
|---|---|
| **Ve** | Una barra de señal · el mapa a medio cargar · el precio que cambió |
| **Oye** | El grupo de WhatsApp decidiendo por él · «¿ya compraste?» |
| **Piensa y siente** | «¿Me están viendo la cara?» · miedo a quedarse fuera y a pagar de más, a la vez |
| **Dice y hace** | Captura la pantalla y la manda al grupo · compara con la reventa |
| **Dolores** | El total que no era total · el reloj corriendo mientras el grupo no se decide |
| **Ganancias** | Entrar con sus amigos, juntos, sin sentirse engañado |

---

## 09 · Cruce: qué hipótesis prueba cada momento del mapa

| Momento del mapa | Hipótesis que pone a prueba | Instrumentación que hace falta |
|---|---|---|
| Promotora, fases 4 y 6 | `H1` (la venta se concentra al final) | Curva de venta por hora **y canal** de los últimos 20 eventos |
| Comprador, fase 3 | `H2` (abandona por la sorpresa, no por el monto) | Embudo móvil evento→carrito→pago + A/B con total desde la primera pantalla |
| Promotora, fases 1 y 9 | `H3` (elige por velocidad de pago y comisión) | 8 entrevistas sobre el último cambio de proveedor |
| Taquillera, fases 3 a 6 | `H4` (PIN y botones grandes > funciones avanzadas) | Dos noches con cronómetro: segundos por venta, diferencia de caja |
| Operador, fases 4 y 5 | `H5` (el QR estático genera duplicados) | Conteo de `conflicts` y de escaneos repetidos por puerta |

**Lo que hoy no se puede medir:** el embudo móvil de la fase 3 del comprador no
existe como evento instrumentado. Sin eso `H2` no se resuelve — y `H2` es la
hipótesis más barata de las cinco.

---

## 10 · Mapa de oportunidades

Ordenado por evidencia primero, esfuerzo después. Ninguna está comprometida:
esto entra a la sesión de acuerdo del paso 04, no al sprint.

| # | Oportunidad | Sale de | Persona | Evidencia | Esfuerzo | Cómo se mide |
|---|---|---|---|---|---|---|
| O3 | Total real (servicio + IVA) desde la página del evento y el mapa, no desde el carrito | §03 · F3 | Comprador | ✔ verificado | Bajo — `calculate-cart` ya es público | Conversión móvil carrito→pago |
| O4 | Contador visible de ventas en cola offline dentro de la pantalla de venta | §04 fase 3 | Taquillera | ✔ verificado | Bajo | Ventas perdidas por red · dudas en el corte |
| O1 | Panel de la promotora que separe web / taquilla / cortesía y muestre neto y fecha de depósito | §02 fases 4 y 8 | Promotora | ? `H1` | Medio | Segundos hasta el número · consultas a soporte |
| O5 | Política de duplicado por evento (pasar y marcar / retener), visible como instrucción en la puerta | §05 fase 4 | Operador | ? `H5` | Bajo | Segundos de decisión · duplicados por evento |
| O6 | Estado honesto y visible de CFDI sandbox y Banorte demo en reportes y billing | §06 | Contadora | ✔ verificado | Bajo | Facturas rechazadas · llamadas del lunes |
| O2 | Hilo único de montaje (asistente que enlace evento → recinto → mapa → precios → fases) | §02 fase 2 | Promotora | ? | Alto | Minutos para publicar sin ayuda |
| O7 | Cortesías con tope y autorización nominal | §02 fase 5 | Promotora | ? | Medio | Cortesías por evento sin dueño |
| O8 | Instrumentar el embudo móvil | §09 | Producto | — | Bajo | Habilita resolver `H2` |

**Si hay que hacer una sola cosa:** O3. Es la única que cae en el valle más
profundo de un journey, tiene evidencia verificada en el código, contradice una
decisión que el propio repo ya dejó escrita, y el endpoint que la resuelve ya
existe y ya es público.

---

## 11 · Qué falta para que estos mapas dejen de ser hipótesis

1. **Instrumentar el embudo móvil** (O8). Sin eso, la mitad del journey del
   comprador es opinión.
2. **Dos noches detrás de la ventanilla, con cronómetro.** El journey de la
   taquillera está construido con lo que el código deja ver, no con lo que ella
   hace.
3. **Acompañar un lunes de corte completo.** El mapa de la contadora es el más
   flaco de los cinco: cinco fases y ninguna medida.
4. **Llevar los cinco mapas impresos a la sesión de acuerdo del paso 04** de
   `PERSONAS.md`. Un mapa con un valle marcado desempata discusiones que una
   ficha de persona no desempata.

Cuando eso ocurra, este documento sube a **1.0** y las etiquetas «? hipótesis»
se convierten en cita textual o desaparecen.
