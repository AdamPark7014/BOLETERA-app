/**
 * Polígonos de sección: lo que se pinta cuando el zoom está bajo.
 *
 * Con 45.000 butacas, alejado no tiene sentido dibujar butacas (cada una
 * mediría menos de 3 px y sería ruido); se pinta un polígono por sección
 * coloreado por ocupación. Eso baja el trabajo por frame de 45.000 rectángulos
 * a ~30 polígonos, y es lo que hace viable el recinto completo en un móvil.
 *
 * El polígono sale de la forma dibujada a mano en el editor (`section.shape`)
 * cuando existe; si no, del casco convexo de sus butacas, calculado UNA vez.
 */

import type { Bounds, RenderSeat } from './types';

export type SectionShape = {
  id: string;
  name: string;
  slug: string;
  color: string;
  levelId?: string;
  /** Polígono en coordenadas de mundo, ya cerrado implícitamente. */
  points: [number, number][];
  centroid: [number, number];
  bounds: Bounds;
  seatCount: number;
  /** Índices dentro del array plano de butacas (para contar sin buscar por id). */
  seatIndexes: number[];
};

type SectionInput = {
  id: string;
  name: string;
  slug: string;
  color: string;
  levelId?: string;
  shape?: { points: [number, number][] } | undefined;
};

/** Casco convexo (monotone chain). O(n log n) y sólo se corre una vez por mapa. */
export function convexHull(points: readonly [number, number][]): [number, number][] {
  if (points.length < 4) return [...points];
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * El casco de un bloque rectangular de butacas pasa por los CENTROS de las
 * butacas del borde, así que la mitad de cada asiento del perímetro queda
 * fuera. Se infla el polígono desde su centroide para que la mancha cubra las
 * butacas de verdad.
 */
function inflate(points: [number, number][], centroid: [number, number], pad: number): [number, number][] {
  return points.map(([x, y]) => {
    const dx = x - centroid[0];
    const dy = y - centroid[1];
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * pad, y + (dy / len) * pad] as [number, number];
  });
}

export function buildSectionShapes(
  sections: readonly SectionInput[],
  seats: readonly RenderSeat[],
  seatPitch: number,
): SectionShape[] {
  const indexesBySection = new Map<string, number[]>();
  for (let i = 0; i < seats.length; i++) {
    const list = indexesBySection.get(seats[i].sectionId);
    if (list) list.push(i);
    else indexesBySection.set(seats[i].sectionId, [i]);
  }

  const shapes: SectionShape[] = [];
  for (const section of sections) {
    const indexes = indexesBySection.get(section.id) ?? [];
    if (!indexes.length && !section.shape?.points?.length) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumY = 0;
    const pts: [number, number][] = [];
    for (const i of indexes) {
      const s = seats[i];
      pts.push([s.x, s.y]);
      sumX += s.x;
      sumY += s.y;
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }

    const authored = section.shape?.points ?? [];
    for (const [x, y] of authored) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) continue;

    const centroid: [number, number] = indexes.length
      ? [sumX / indexes.length, sumY / indexes.length]
      : [(minX + maxX) / 2, (minY + maxY) / 2];

    const polygon = authored.length >= 3
      ? authored
      : inflate(convexHull(pts), centroid, seatPitch * 0.7);

    shapes.push({
      id: section.id,
      name: section.name,
      slug: section.slug,
      color: section.color || '#5b9fd4',
      levelId: section.levelId,
      points: polygon.length >= 3 ? polygon : rectPolygon(minX, minY, maxX, maxY),
      centroid,
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
      },
      seatCount: indexes.length,
      seatIndexes: indexes,
    });
  }
  return shapes;
}

function rectPolygon(minX: number, minY: number, maxX: number, maxY: number): [number, number][] {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/** Ray casting. Se usa para «toqué esta zona» cuando el zoom es bajo. */
export function pointInPolygon(x: number, y: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
