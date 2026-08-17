# `@boletera/venue-engine`

Motor de mapas de venue: geometría (SVG/DXF, validación, sightlines, egress) y render GPU-first (WebGL2 con fallback Canvas2D).

## Subpaths

| Import | Uso |
|--------|-----|
| `@boletera/venue-engine` | Geometría + helpers (Node/API-safe, sin DOM) |
| `@boletera/venue-engine/render` | `SeatMapRenderer` y APIs de canvas |

Definido en el campo `exports` de este `package.json`.

Guía larga: [`docs/guias/motor-de-mapas.md`](../../docs/guias/motor-de-mapas.md).

## Consumo

```json
"@boletera/venue-engine": "workspace:*"
```

En Next: incluir en `transpilePackages`. Ejemplo mínimo de render (ciclo de vida del JSDoc del paquete):

```ts
import { SeatMapRenderer } from '@boletera/venue-engine/render';

const renderer = new SeatMapRenderer();
renderer.mount(canvas);
renderer.setScene(seatMapData);
// ...
renderer.destroy(); // obligatorio al desmontar
```

Integración React en progreso: `apps/admin/components/venue-builder/canvas/` (`CanvasHost`, `useRendererBridge`, …). Al completar el shell, crea la instancia una sola vez y pásala por `RendererProvider`.

## Scripts

```powershell
pnpm --filter @boletera/venue-engine build
pnpm --filter @boletera/venue-engine check-types
pnpm --filter @boletera/venue-engine smoke
pnpm --filter @boletera/venue-engine bench:render

# desde la raíz del monorepo:
pnpm smoke:venue-engine
```

Smokes: `scripts/run-smokes.cjs` + `scripts/smoke-*.cjs`. Bench: `scripts/bench-render.cjs`.
