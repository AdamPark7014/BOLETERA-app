import { rectFromPoints } from '../utils/geometry';
import type { Tool, ToolContext } from './types';
import type { WorldPoint } from '@boletera/venue-engine/render';

const ZOOM_STEP = 1.35;

export function createPanTool(): Tool {
  let panning = false;
  let velocity: WorldPoint = { x: 0, y: 0 };

  return {
    id: 'pan',
    label: 'Encuadrar',
    shortcut: 'H',
    hint: 'Arrastra para desplazar · rueda para zoom',
    cursor: 'grab',

    onPointerDown: (ctx) => {
      panning = true;
      velocity = { x: 0, y: 0 };
      ctx.renderer.camera.stopInertia();
      ctx.setCursor('grabbing');
    },

    onPointerMove: (ctx, event) => {
      if (!panning) return;
      ctx.renderer.camera.panByScreen(event.deltaScreen.x, event.deltaScreen.y);
      const dt = Math.max(1, event.deltaTimeMs);
      velocity = {
        x: -event.deltaScreen.x / ctx.renderer.camera.zoom / dt,
        y: -event.deltaScreen.y / ctx.renderer.camera.zoom / dt,
      };
    },

    onPointerUp: (ctx) => {
      if (!panning) return;
      panning = false;
      ctx.setCursor('grab');
      ctx.renderer.camera.settleInertia(velocity.x, velocity.y);
    },

    cancel: (ctx) => {
      panning = false;
      ctx.setCursor('grab');
      ctx.renderer.camera.stopInertia();
    },
  };
}

export function createZoomTool(): Tool {
  let anchor: WorldPoint | null = null;

  const finish = (ctx: ToolContext) => {
    anchor = null;
    ctx.paintOverlay(null);
  };

  return {
    id: 'zoom',
    label: 'Zoom',
    shortcut: 'Z',
    hint: 'Clic acerca · Alt+clic aleja · arrastra un marco para encuadrarlo',
    cursor: 'zoom-in',

    onPointerDown: (_ctx, event) => {
      anchor = event.world;
    },

    onPointerMove: (ctx, event) => {
      if (!anchor) return;
      ctx.paintOverlay({ marquee: rectFromPoints(anchor, event.world) });
    },

    onPointerUp: (ctx, event) => {
      if (!anchor) return;
      const rect = rectFromPoints(anchor, event.world);
      const spanScreen = Math.max(
        Math.abs(rect.maxX - rect.minX),
        Math.abs(rect.maxY - rect.minY),
      ) * ctx.renderer.camera.zoom;
      if (spanScreen > 16) {
        ctx.renderer.camera.fitToBounds(rect, 32, true);
      } else {
        ctx.renderer.camera.zoomAtScreen(
          event.screen,
          event.alt ? 1 / ZOOM_STEP : ZOOM_STEP,
          true,
        );
      }
      finish(ctx);
    },

    cancel: finish,
  };
}
