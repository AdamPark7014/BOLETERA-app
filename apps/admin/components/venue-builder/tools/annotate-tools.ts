import { mapToMeters } from '@boletera/venue-engine';
import type { WorldPoint } from '@boletera/venue-engine/render';
import { venueScale } from '../store/editor-store';
import { distance } from '../utils/geometry';
import { uid } from '../utils/ids';
import type { Tool, ToolContext } from './types';

export function createMeasureTool(): Tool {
  let anchor: WorldPoint | null = null;

  const clear = (ctx: ToolContext) => {
    anchor = null;
    ctx.editor.getState().setDraft(null);
    ctx.clearGuides();
  };

  return {
    id: 'measure',
    label: 'Medir',
    shortcut: 'M',
    hint: 'Arrastra entre dos puntos para acotar en metros',
    cursor: 'crosshair',

    onPointerDown: (ctx, event) => {
      anchor = ctx.snap(event.world).point;
    },

    onPointerMove: (ctx, event) => {
      if (!anchor) return;
      const to = ctx.snap(event.world).point;
      const scale = venueScale(ctx.editor.getState().scene);
      ctx.editor.getState().setDraft({
        kind: 'polyline',
        points: [anchor, to],
        label: `${mapToMeters(distance(anchor, to), scale).toFixed(2)} m`,
      });
    },

    onPointerUp: (ctx, event) => {
      if (!anchor) return;
      const to = ctx.snap(event.world).point;
      if (distance(anchor, to) > 1) {
        ctx.editor.getState().addMeasurement({ id: uid('measure'), a: anchor, b: to });
      }
      clear(ctx);
    },

    cancel: clear,
  };
}

export function createAnnotateTool(): Tool {
  return {
    id: 'annotate',
    label: 'Nota',
    shortcut: 'N',
    hint: 'Clic para dejar una nota y editar su texto en el panel de propiedades',
    cursor: 'text',

    onPointerDown: (ctx, event) => {
      ctx.editor.getState().addAnnotation({
        id: uid('note'),
        at: ctx.snap(event.world).point,
        text: 'Nota',
      });
      ctx.editor.getState().setRightPanel('properties');
    },

    onPointerMove: (ctx, event) => {
      ctx.editor.getState().setDraft({ kind: 'dot', at: ctx.snap(event.world).point, label: 'Nota' });
    },

    cancel: (ctx) => {
      ctx.editor.getState().setDraft(null);
      ctx.clearGuides();
    },
  };
}
