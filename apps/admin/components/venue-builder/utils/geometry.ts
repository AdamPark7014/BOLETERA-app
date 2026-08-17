import type { SeatMapData } from '@boletera/shared';
import type { WorldPoint, WorldRect } from '@boletera/venue-engine/render';

export function rectFromPoints(a: WorldPoint, b: WorldPoint): WorldRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function translateRect(rect: WorldRect, dx: number, dy: number): WorldRect {
  return {
    minX: rect.minX + dx,
    minY: rect.minY + dy,
    maxX: rect.maxX + dx,
    maxY: rect.maxY + dy,
  };
}

/** Corner + edge-midpoint handles, matching Figma's transform box. */
export function handlesForRect(rect: WorldRect): WorldPoint[] {
  const midX = (rect.minX + rect.maxX) / 2;
  const midY = (rect.minY + rect.maxY) / 2;
  return [
    { x: rect.minX, y: rect.minY },
    { x: midX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: midY },
    { x: rect.maxX, y: rect.maxY },
    { x: midX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
    { x: rect.minX, y: midY },
  ];
}

/** Andrew's monotone chain convex hull (counter-clockwise). */
export function convexHull(points: readonly WorldPoint[]): WorldPoint[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: WorldPoint, a: WorldPoint, b: WorldPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: WorldPoint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: WorldPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

export function polygonArea(points: readonly WorldPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(point: WorldPoint, points: readonly WorldPoint[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Circle through three points — used by the curved-row tool to turn
 * start/end/bulge clicks into a `generateCurvedRow` arc.
 */
export function circleFromThreePoints(
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
): { center: WorldPoint; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const ux =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
      (b.x * b.x + b.y * b.y) * (c.y - a.y) +
      (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
    d;
  const uy =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
      (b.x * b.x + b.y * b.y) * (a.x - c.x) +
      (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
    d;
  const center = { x: ux, y: uy };
  return { center, radius: distance(center, a) };
}

export function sceneBoundsOrDefault(scene: SeatMapData): WorldRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const section of scene.sections) {
    for (const seat of section.seats) {
      if (seat.x < minX) minX = seat.x;
      if (seat.y < minY) minY = seat.y;
      if (seat.x > maxX) maxX = seat.x;
      if (seat.y > maxY) maxY = seat.y;
    }
  }
  if (!Number.isFinite(minX)) {
    const viewport = scene.viewport;
    const originX = viewport?.minX ?? 0;
    const originY = viewport?.minY ?? 0;
    return {
      minX: originX,
      minY: originY,
      maxX: originX + (viewport?.width ?? 900),
      maxY: originY + (viewport?.height ?? 600),
    };
  }
  return { minX, minY, maxX, maxY };
}

export function rotatePoint(point: WorldPoint, pivot: WorldPoint, radians: number): WorldPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

export function scalePoint(
  point: WorldPoint,
  pivot: WorldPoint,
  factorX: number,
  factorY: number,
): WorldPoint {
  return {
    x: pivot.x + (point.x - pivot.x) * factorX,
    y: pivot.y + (point.y - pivot.y) * factorY,
  };
}
