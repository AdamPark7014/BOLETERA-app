# `@boletera/ui`

Design system React 19 de Boletera: primitivas, layout, tablas, KPIs y charts SVG propios.

## Qué exporta

Superficie pública en `src/index.ts` (exports nombrados): tokens TS, formatters es-MX/MXN, hooks, y componentes (`Button`, `DataTable`, `KpiCard`, `Modal`, charts, etc.).

Guía larga con inventario y firmas de props: [`docs/guias/design-system.md`](../../docs/guias/design-system.md).

## Consumo en el workspace

```json
"@boletera/ui": "workspace:*"
```

El paquete apunta `main`/`types` a `./src/index.ts` (fuente, sin build). En Next:

```ts
transpilePackages: ['@boletera/ui', /* ... */]
```

Importa el tema **una vez** en el layout/globals de la app:

```scss
@use '@boletera/ui/src/styles/theme.scss';
// o ruta relativa al monorepo, como hace apps/admin/app/globals.scss
```

```tsx
import { Button, KpiCard, formatCurrency } from '@boletera/ui';

<KpiCard label="Ingreso bruto" value={formatCurrency(1284500)} delta={0.124} />
```

## Scripts

```powershell
pnpm --filter @boletera/ui check-types
```

No hay script `build`: las apps transpilan el paquete.

## Peer deps

`react` y `react-dom` `^19`.
