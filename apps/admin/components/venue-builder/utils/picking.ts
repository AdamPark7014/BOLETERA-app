import type { SeatMapData } from '@boletera/shared';
import type { WorldPoint } from '@boletera/venue-engine/render';

export type VenuePick =
  | { kind: 'stage' }
  | { kind: 'furniture'; id: string };

/** Half height used by the renderer when it draws the stage plate. */
const STAGE_HALF_HEIGHT = 18;

/**
 * Non-seat picking. Venue meta holds a handful of items, so a linear scan is
 * cheaper than maintaining a second spatial index.
 */
export function pickVenueEntity(
  scene: SeatMapData,
  world: WorldPoint,
  tolerance: number,
): VenuePick | null {
  const furniture = scene.venue?.furniture ?? [];
  let best: { id: string; dist: number } | null = null;
  for (const item of furniture) {
    const dist = Math.hypot(item.x - world.x, item.y - world.y);
    if (dist <= tolerance && (!best || dist < best.dist)) best = { id: item.id, dist };
  }
  if (best) return { kind: 'furniture', id: best.id };

  const stage = scene.venue?.stage;
  if (stage) {
    const insideX = world.x >= stage.x - tolerance && world.x <= stage.x + stage.width + tolerance;
    const insideY =
      world.y >= stage.y - STAGE_HALF_HEIGHT - tolerance &&
      world.y <= stage.y + STAGE_HALF_HEIGHT + tolerance;
    if (insideX && insideY) return { kind: 'stage' };
  }
  return null;
}

export { STAGE_HALF_HEIGHT };
