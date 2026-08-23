# App móvil nativa

Cartera de boletos del comprador. **Kotlin + Jetpack Compose**, sin WebView, sin
Capacitor y sin React Native — mismo enfoque que `NEXARA-app/apps/mobile-native`.

## Qué resuelve, y por qué tiene que ser una app

El QR de acceso **rota cada 15 segundos**. Eso es lo que hace que una captura de
pantalla reenviada por WhatsApp no sirva para entrar, y es la razón por la que
las boleteras grandes exigen su app para los boletos con código rotativo.

Pero un código que rota necesita generarse en algún sitio. Si lo firmara el
servidor en cada refresco, el comprador necesitaría cobertura **justo en la
puerta**, que es exactamente donde no la hay: veinte mil personas en la misma
antena. La fila se detiene.

Por eso el servidor entrega la **clave derivada de cada boleto** y el teléfono
calcula el código en local:

```
GET /orders/:publicId/wallet →  signingKey = HMAC(maestro, "ticketId:eventId")
```

Con eso la app funciona en **modo avión**. Y la clave no es el secreto maestro:
solo firma ESE boleto, así que un teléfono comprometido expone una entrada, no
la boletera.

> Según el [análisis público de SafeTix](https://conduition.io/coding/ticketmaster/)
> su escáner sí consulta al servidor. Aquí la generación es local y la
> conciliación de escaneos sin conexión ya existía (`syncOfflineScans`).

## Requisitos

| | |
|---|---|
| JDK | 17 |
| Android SDK | compileSdk 36 · minSdk 24 |
| Gradle | 9.0 (incluido en el wrapper) |

`local.properties` con la ruta del SDK (no se versiona):

```
sdk.dir=C:/Users/<usuario>/AppData/Local/Android/Sdk
```

## Compilar y probar

```bash
cd apps/mobile-native/android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

La URL del API se inyecta en compilación; por omisión apunta al emulador
(`10.0.2.2` es el `localhost` del anfitrión visto desde el AVD):

```bash
./gradlew :app:assembleDebug -PAPI_BASE_URL=https://api.tudominio.mx/api/v1
```

## La prueba que no se puede saltar

`RotatingTicketCodeTest` compara la firma de Kotlin contra **vectores generados
por la implementación real del servidor** (`packages/crypto`, Node).

Si se pone roja, la app y el escáner han dejado de entenderse y **ningún boleto
abre la puerta**. Es el fallo más caro de este producto y no se ve hasta que hay
gente esperando fuera. Incluye un caso con eñe y acentos, que es el que delata
un fallo de codificación UTF-8.

Y de extremo a extremo, contra el API vivo:

```bash
node e2e/load/mobile-wallet-chain.mjs
```

Reproduce lo que hace el teléfono y lo manda al torniquete de verdad. Comprueba
además las dos contrapruebas que dan sentido a la rotación: un código de hace
dos minutos se rechaza, y una clave inventada no abre el boleto.

## Decisiones de diseño

- **El brillo sube al máximo** mientras el boleto está en pantalla, y se
  restaura al salir. Un lector de puerta con la pantalla al 20 % y sol de lado
  no lee.
- **La cuenta atrás es visible.** Sin ella, ver el código cambiar en la mano
  justo antes de pasar parece un fallo; verlo rotar es lo que lo convierte en
  garantía.
- **Corrección de errores del QR en nivel bajo (L).** Más corrección son más
  módulos, y más módulos en la misma pantalla es cada cuadrito más pequeño. En
  una puerta el enemigo es el brillo y la distancia, no que el código se raye.
- **No se exige crear cuenta**: se entra con el código de orden del correo.
  Obligar a registrarse para enseñar un boleto ya pagado solo genera llamadas a
  soporte el día del evento.
- **Lo guardado gana sobre la red.** Si la descarga falla pero hay copia local,
  el comprador no se entera: tiene su boleto. Solo se avisa cuando no hay nada
  que enseñar.
- **La `signingKey` vive en `EncryptedSharedPreferences`** (Keystore del
  dispositivo), nunca en preferencias en claro, y no se registra en logs.

## Pendiente

- **iOS.** El equivalente en Swift + SwiftUI, como en NEXARA.
- **Transferencia de boletos** desde la app (el API ya tiene `ticket-transfer`).
- **NFC** para entrada sin contacto donde el recinto tenga lectores.
- **Iconos de tienda**: hoy hay un vector adaptativo; para publicar hacen falta
  los PNG por densidad.
