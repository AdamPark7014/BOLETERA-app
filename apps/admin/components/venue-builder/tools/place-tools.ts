import type { SeatMapFurniture } from '@boletera/shared';
import { mapToMeters } from '@boletera/venue-engine';
import type { WorldPoint } from '@boletera/venue-engine/render';
import { setVenueMetaCommand } from '../store/commands';
import { venueScale } from '../store/editor-store';
import { rectFromPoints } from '../utils/geometry';
import { STAGE_HALF_HEIGHT } from '../utils/picking';
import { uid } from '../utils/ids';
import type { Tool, ToolContext } from './types';

export function createPlaceFurnitureTool(): Tool {
  return {
    id: 'place-furniture',
    label: 'Mobiliario',
    shortcut: 'F',
    hint: 'Clic para colocar el elemento seleccionado (LED, audio o puerta)',
    cursor: 'copy',

    onPointerMove: (ctx, event) => {
      ctx.editor.getState().setDraft({
        kind: 'dot',
        at: ctx.snap(event.world).point,
        label: ctx.editor.getState().drawParams.furnitureKind,
      });
    },

    onPointerDown: (ctx, event) => {
      const state = ctx.editor.getState();
      const point = ctx.snap(event.world).point;
      const furniture = state.scene.venue?.furniture ?? [];
      const item: SeatMapFurniture = {
        id: uid('furniture'),
        type: state.drawParams.furnitureKind,
        x: point.x,
        y: point.y,
        rotation: 0,
      };
      ctx.history.execute(
        setVenueMetaCommand(
          'Colocar mobiliario',
          { furniture },
          { furniture: [...furniture, item] },
        ),
      );
      ctx.editor.getState().setSelection({ furnitureIds: [item.id], seatIds: [], stage: false });
    },

    cancel: (ctx) => {
      ctx.editor.getState().setDraft(null);
      ctx.clearGuides();
    },
  };
}

export function createPlaceStageTool(): Tool {
  let anchor: WorldPoint | null = null;

  const clear = (ctx: ToolContext) => {
    anchor = null;
    ctx.editor.getState().setDraft(null);
    ctx.clearGuides();
  };

  return {
    id: 'place-stage',
    label: 'Escenario',
    shortcut: 'G',
    hint: 'Arrastra para definir el ancho y la posición del escenario',
    cursor: 'crosshair',

    onPointerDown: (ctx, event) => {
      anchor = ctx.snap(event.world).point;
    },

    onPointerMove: (ctx, event) => {
      if (!anchor) return;
      const to = ctx.snap(event.world).point;
      const scale = venueScale(ctx.editor.getState().scene);
      ctx.editor.getState().setDraft({
        kind: 'rect',
        a: { x: Math.min(anchor.x, to.x), y: anchor.y - STAGE_HALF_HEIGHT },
        b: { x: Math.max(anchor.x, to.x), y: anchor.y + STAGE_HALF_HEIGHT },
        label: `${mapToMeters(Math.abs(to.x - anchor.x), scale).toFixed(1)} m`,
      });
    },

    onPointerUp: (ctx, event) => {
      if (!anchor) return;
      const to = ctx.snap(event.world).point;
      const rect = rectFromPoints(anchor, to);
      const width = Math.max(40, rect.maxX - rect.minX);
      const state = ctx.editor.getState();
      const stage = state.scene.venue?.stage;
      ctx.history.execute(
        setVenueMetaCommand(
          'Definir escenario',
          { stage },
          {
            stage: {
              ...(stage ?? { elevation: 0 }),
              x: rect.minX,
              y: anchor.y,
              width,
            },
          },
        ),
      );
      ctx.editor.getState().setSelection({ stage: true, seatIds: [], furnitureIds: [] });
      clear(ctx);
    },

    cancel: clear,
  };
}
