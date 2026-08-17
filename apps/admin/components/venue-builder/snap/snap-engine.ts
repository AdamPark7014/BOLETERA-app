import { snapValue } from '@boletera/venue-engine';
import type { SeatMapRenderer, WorldPoint } from '@boletera/venue-engine/render';
import type { SnapGuide } from '../store/types';

export type SnapOptions = {
  enabled: boolean;
  /** Grid pitch in map units. */
  pitch: number;
  /** Magnet radius in world units (derive from zoom for constant screen feel). */
  tolerance: number;
};

export type SnapOutcome = {
  point: WorldPoint;
  guides: SnapGuide[];
};

/** Nearest seat coordinate on each axis inside the magnet window. */
function alignToSeats(
  renderer: SeatMapRenderer,
  point: WorldPoint,
  tolerance: number,
): { x?: number; y?: number } {
  const scene = renderer.getScene();
  if (!scene || scene.seatCount === 0) return {};
  const window = tolerance * 4;
  const ids = renderer.queryRect({
    minX: point.x - window,
    minY: point.y - window,
    maxX: point.x + window,
    maxY: point.y + window,
  });
  if (ids.length === 0) return {};

  let bestX: number | undefined;
  let bestY: number | undefined;
  let bestDx = tolerance;
  let bestDy = tolerance;
  for (const id of ids) {
    const index = scene.idToIndex.get(id);
    if (index === undefined) continue;
    const dx = Math.abs(scene.xs[index] - point.x);
    if (dx < bestDx) {
      bestDx = dx;
      bestX = scene.xs[index];
    }
    const dy = Math.abs(scene.ys[index] - point.y);
    if (dy < bestDy) {
      bestDy = dy;
      bestY = scene.ys[index];
    }
  }
  return { x: bestX, y: bestY };
}

/**
 * Magnetic snapping: seat alignment wins over the grid, so rows stay collinear
 * even when the grid pitch does not match the authored seat pitch.
 */
export function computeSnap(
  renderer: SeatMapRenderer,
  point: WorldPoint,
  options: SnapOptions,
): SnapOutcome {
  if (!options.enabled) return { point, guides: [] };

  const aligned = alignToSeats(renderer, point, options.tolerance);
  const guides: SnapGuide[] = [];
  let x: number;
  let y: number;

  if (aligned.x !== undefined) {
    x = aligned.x;
    guides.push({ axis: 'x', value: x });
  } else {
    x = snapValue(point.x, options.pitch);
  }

  if (aligned.y !== undefined) {
    y = aligned.y;
    guides.push({ axis: 'y', value: y });
  } else {
    y = snapValue(point.y, options.pitch);
  }

  return { point: { x, y }, guides };
}

/** Grid-only snap for deltas, keeping a dragged cluster rigid. */
export function snapDelta(
  delta: WorldPoint,
  options: Pick<SnapOptions, 'enabled' | 'pitch'>,
): WorldPoint {
  if (!options.enabled) return delta;
  return { x: snapValue(delta.x, options.pitch), y: snapValue(delta.y, options.pitch) };
}
