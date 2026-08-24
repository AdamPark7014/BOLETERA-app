# Prototipos

Codigo exploratorio que NO forma parte del workspace de pnpm (el workspace solo
incluye `apps/*` y `packages/*`). Vive aqui a proposito:

## staff-mobile-expo

Prototipo en Expo/React Native de una app movil PARA PERSONAL (escanear en
puerta, taquilla, ventas), hecho en otra sesion.

Esta fuera del workspace por dos razones:

1. **Trae React 18** (`react@18.3.1`, `@types/react@18`) mientras todo el
   monorepo esta en React 19. Dentro de `apps/*`, pnpm metia los tipos 18 en el
   almacen y el tipado de taquilla se rompia con el clasico
   «'Suspense' cannot be used as a JSX component».
2. La app movil del comprador (`apps/mobile-native`) es NATIVA —Kotlin +
   Compose, como NEXARA— y con el QR rotativo sin conexion ya probado de punta
   a punta. Antes de invertir en este prototipo hay que decidir si la app de
   personal sera Expo o nativa; mientras tanto, el prototipo no debe costar
   nada al resto del repo.

Para trabajarlo: `cd prototypes/staff-mobile-expo && npm install` (npm, no
pnpm: fuera del workspace no hay enlaces de workspace:*; sustituye la
dependencia `@boletera/shared` por una copia local si hace falta).
