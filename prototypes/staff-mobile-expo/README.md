# Nexara App

Aplicación móvil nativa (Expo + React Native) para operación de BOLETERA: promotores, taquilla y staff.

## Arquitectura

- **Expo Router** — navegación por archivos (`app/`)
- **expo-secure-store** — token JWT en almacenamiento seguro del dispositivo
- **@boletera/shared** — enums y contratos compartidos con web/API
- **lib/api.ts** — cliente HTTP hacia `EXPO_PUBLIC_API_URL` (default `http://localhost:4000`)

## Desarrollo

```bash
pnpm --filter nexara-app install
pnpm --filter nexara-app start
```

Variables:

- `EXPO_PUBLIC_API_URL` — base del API NestJS

## Pantallas iniciales

- Login con credenciales demo (`admin@demo.boletera.com` / `Admin123!`)
- Tabs: Inicio, Eventos (catálogo discovery), Boletos, Perfil

## Próximos pasos

- Push notifications (Expo Notifications)
- Deep links `nexara://events/:slug`
- Escaneo QR (expo-camera)
- Modo offline con cola de sincronización
