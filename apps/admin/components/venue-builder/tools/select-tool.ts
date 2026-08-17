import type { SeatMapFurniture, SeatMapStage } from '@boletera/shared';
import type { SeatPatch, WorldPoint, WorldRect } from '@boletera/venue-engine/render';
import { poseOf, setVenueMetaCommand, transformSeatsCommand, type SeatPose } from '../store/commands';
import { selectSeatIndex, selectTotalSeats } from '../store/selectors';
import { selectableSeatIds } from '../transform/transform-ops';
import { handlesForRect, rectFromPoints, translateRect } from '../utils/geometry';
import { pickVenueEntity, STAGE_HALF_HEIGHT } from '../utils/picking';
import type { Tool, ToolContext } from './types';

type Dragged = { id: string; pose: SeatPose };

type SelectState =
  | { mode: 'idle' }
  | { mode: 'marquee'; anchor: WorldPoint; additive: boolean }
  | { mode: 'lasso'; points: WorldPoint[]; additive: boolean }
  | {
      mode: 'seats';
      anchor: WorldPoint;
      dragged: Dragged[];
      bounds: WorldRect;
      live: boolean;
      delta: WorldPoint;
    }
  | { mode: 'stage'; anchor: WorldPoint; origin: SeatMapStage; delta: WorldPoint }
  | { mode: 'furniture'; anchor: WorldPoint; origin: SeatMapFurniture; delta: WorldPoint };

const MOVE_THRESHOLD_WORLD = 0.5;

function seatPatchFor(dragged: readonly Dragged[], delta: WorldPoint): SeatPatch[] {
  return dragged.map((item) => ({
    id: item.id,
    x: item.pose.x + delta.x,
    y: item.pose.y + delta.y,
  }));
}

function stageRect(stage: SeatMapStage, delta: WorldPoint): WorldRect {
  return {
    minX: stage.x + delta.x,
    minY: stage.y + delta.y - STAGE_HALF_HEIGHT,
    maxX: stage.x + stage.width + delta.x,
    maxY: stage.y + delta.y + STAGE_HALF_HEIGHT,
  };
}

export function createSelectTool(): Tool {
  let state: SelectState = { mode: 'idle' };

  const reset = (ctx: ToolContext) => {
    state = { mode: 'idle' };
    ctx.clearGuides();
    ctx.paintOverlay(null);
  };

  return {
    id: 'select',
    label: 'Seleccionar',
    shortcut: 'V',
    hint: 'Clic para seleccionar · Shift suma · arrastra para marco · Alt arrastra para lazo',
    cursor: 'default',

    onPointerDown: (ctx, event) => {
      const editor = ctx.editor.getState();
      const hit = ctx.renderer.hitTest(event.screen);

      if (hit) {
        const alreadySelected = editor.selection.seatIds.includes(hit.seatId);
        if (event.shift) {
          editor.selectSeats([hit.seatId], 'toggle');
          return;
        }
        if (!alreadySelected) editor.selectSeats([hit.seatId], 'replace');

        const next = ctx.editor.getState();
        const index = selectSeatIndex(next.scene);
        const dragged: Dragged[] = [];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const id of next.selection.seatIds) {
          const found = index.get(id);
          if (!found || found.section.locked) continue;
          const pose = poseOf(found.seat);
          dragged.push({ id, pose });
          minX = Math.min(minX, pose.x);
          minY = Math.min(minY, pose.y);
          maxX = Math.max(maxX, pose.x);
          maxY = Math.max(maxY, pose.y);
        }
        if (dragged.length === 0) return;
        state = {
          mode: 'seats',
          anchor: event.world,
          dragged,
          bounds: { minX, minY, maxX, maxY },
          // Live seat previews rebuild the spatial index every frame; only
          // affordable on small/medium venues. Big maps drag a ghost box.
          live: selectTotalSeats(next.scene) <= ctx.liveDragBudget,
          delta: { x: 0, y: 0 },
        };
        return;
      }

      const tolerance = 12 / ctx.renderer.camera.zoom;
      const pick = pickVenueEntity(editor.scene, event.world, tolerance);
      if (pick?.kind === 'stage' && editor.scene.venue?.stage) {
        editor.setSelection({ seatIds: [], stage: true, furnitureIds: [] });
        state = {
          mode: 'stage',
          anchor: event.world,
          origin: editor.scene.venue.stage,
          delta: { x: 0, y: 0 },
        };
        return;
      }
      if (pick?.kind === 'furniture') {
        const item = (editor.scene.venue?.furniture ?? []).find((f) => f.id === pick.id);
        if (!item) return;
        editor.setSelection({ seatIds: [], stage: false, furnitureIds: [item.id] });
        state = { mode: 'furniture', anchor: event.world, origin: item, delta: { x: 0, y: 0 } };
        return;
      }

      if (event.alt) {
        state = { mode: 'lasso', points: [event.world], additive: event.shift };
      } else {
        state = { mode: 'marquee', anchor: event.world, additive: event.shift };
      }
    },

    onPointerMove: (ctx, event) => {
      if (state.mode === 'idle') {
        const hit = ctx.renderer.hitTest(event.screen);
        ctx.editor.getState().setHoverSeat(hit ? hit.seatId : null);
        ctx.paintOverlay(null);
        return;
      }

      if (state.mode === 'marquee') {
        ctx.paintOverlay({ marquee: rectFromPoints(state.anchor, event.world) });
        return;
      }

      if (state.mode === 'lasso') {
        const last = state.points[state.points.length - 1];
        if (Math.hypot(event.world.x - last.x, event.world.y - last.y) > 2 / ctx.renderer.camera.zoom) {
          state.points.push(event.world);
        }
        ctx.paintOverlay({ lasso: state.points });
        return;
      }

      if (state.mode === 'seats') {
        const raw = { x: event.world.x - state.anchor.x, y: event.world.y - state.anchor.y };
        const snapped = ctx.snap({ x: state.bounds.minX + raw.x, y: state.bounds.minY + raw.y });
        state.delta = {
          x: snapped.point.x - state.bounds.minX,
          y: snapped.point.y - state.bounds.minY,
        };
        const ghost = translateRect(state.bounds, state.delta.x, state.delta.y);
        ctx.paintOverlay({ marquee: ghost, handles: handlesForRect(ghost) });
        if (state.live) ctx.renderer.updateSeats(seatPatchFor(state.dragged, state.delta));
        return;
      }

      if (state.mode === 'stage') {
        const snapped = ctx.snap({
          x: state.origin.x + (event.world.x - state.anchor.x),
          y: state.origin.y + (event.world.y - state.anchor.y),
        });
        state.delta = {
          x: snapped.point.x - state.origin.x,
          y: snapped.point.y - state.origin.y,
        };
        const rect = stageRect(state.origin, state.delta);
        ctx.paintOverlay({ marquee: rect, handles: handlesForRect(rect) });
        return;
      }

      const snapped = ctx.snap({
        x: state.origin.x + (event.world.x - state.anchor.x),
        y: state.origin.y + (event.world.y - state.anchor.y),
      });
      state.delta = { x: snapped.point.x - state.origin.x, y: snapped.point.y - state.origin.y };
      ctx.paintOverlay({ handles: [snapped.point] });
    },

    onPointerUp: (ctx, event) => {
      const editor = ctx.editor.getState();

      if (state.mode === 'marquee') {
        const rect = rectFromPoints(state.anchor, event.world);
        const ids = selectableSeatIds(ctx, ctx.renderer.queryRect(rect));
        editor.selectSeats(ids, state.additive ? 'add' : 'replace');
        reset(ctx);
        return;
      }

      if (state.mode === 'lasso') {
        const ids =
          state.points.length >= 3
            ? selectableSeatIds(ctx, ctx.renderer.queryLasso(state.points))
            : [];
        editor.selectSeats(ids, state.additive ? 'add' : 'replace');
        reset(ctx);
        return;
      }

      if (state.mode === 'seats') {
        const { dragged, delta } = state;
        if (Math.hypot(delta.x, delta.y) >= MOVE_THRESHOLD_WORLD) {
          ctx.history.execute(
            transformSeatsCommand(
              `Mover ${dragged.length} asientos`,
              dragged.map((item) => ({
                id: item.id,
                before: item.pose,
                after: { ...item.pose, x: item.pose.x + delta.x, y: item.pose.y + delta.y },
              })),
            ),
          );
        } else if (state.live) {
          ctx.renderer.updateSeats(seatPatchFor(dragged, { x: 0, y: 0 }));
        }
        reset(ctx);
        return;
      }

      if (state.mode === 'stage') {
        const { origin, delta } = state;
        if (Math.hypot(delta.x, delta.y) >= MOVE_THRESHOLD_WORLD) {
          ctx.history.execute(
            setVenueMetaCommand(
              'Mover escenario',
              { stage: origin },
              { stage: { ...origin, x: origin.x + delta.x, y: origin.y + delta.y } },
            ),
          );
        }
        reset(ctx);
        return;
      }

      if (state.mode === 'furniture') {
        const { origin, delta } = state;
        if (Math.hypot(delta.x, delta.y) >= MOVE_THRESHOLD_WORLD) {
          const furniture = editor.scene.venue?.furniture ?? [];
          ctx.history.execute(
            setVenueMetaCommand(
              'Mover mobiliario',
              { furniture },
              {
                furniture: furniture.map((item) =>
                  item.id === origin.id
                    ? { ...item, x: origin.x + delta.x, y: origin.y + delta.y }
                    : item,
                ),
              },
            ),
          );
        }
        reset(ctx);
        return;
      }

      reset(ctx);
    },

    onDoubleClick: (ctx, event) => {
      const hit = ctx.renderer.hitTest(event.screen);
      if (!hit) return;
      const index = selectSeatIndex(ctx.editor.getState().scene);
      const found = index.get(hit.seatId);
      if (found) ctx.editor.getState().selectSection(found.section.id);
    },

    cancel: (ctx) => {
      if (state.mode === 'seats' && state.live) {
        ctx.renderer.updateSeats(seatPatchFor(state.dragged, { x: 0, y: 0 }));
      }
      reset(ctx);
    },
  };
}
