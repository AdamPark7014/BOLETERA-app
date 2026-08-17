/**
 * Generadores de rutas SVG escritos a mano (sustituyen a d3-shape).
 * Todas las funciones son puras y devuelven el atributo `d` listo para usar.
 */

import type { Point } from './scale';

/** Redondea a 2 decimales: suficiente para sub-pixel y mantiene el `d` corto. */
function r(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Interpolacion cubica monotona (Fritsch-Carlson). A diferencia de una spline
 * cardinal, nunca sobrepasa los datos: una serie de ventas que nunca baja de
 * cero tampoco lo hace en la curva.
 */
function monotoneTangents(points: readonly Point[]): number[] {
  const n = points.length;
  const slopes: number[] = new Array<number>(n - 1);
  const tangents: number[] = new Array<number>(n).fill(0);

  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) {
      slopes[i] = 0;
      continue;
    }
    const dx = b.x - a.x;
    slopes[i] = dx === 0 ? 0 : (b.y - a.y) / dx;
  }

  tangents[0] = slopes[0] ?? 0;
  tangents[n - 1] = slopes[n - 2] ?? 0;

  for (let i = 1; i < n - 1; i += 1) {
    const previous = slopes[i - 1] ?? 0;
    const next = slopes[i] ?? 0;
    tangents[i] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i] ?? 0;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = (tangents[i] ?? 0) / slope;
    const beta = (tangents[i + 1] ?? 0) / slope;
    const magnitude = Math.hypot(alpha, beta);
    if (magnitude > 3) {
      const factor = 3 / magnitude;
      tangents[i] = factor * alpha * slope;
      tangents[i + 1] = factor * beta * slope;
    }
  }

  return tangents;
}

/**
 * Ruta poligonal o suavizada que atraviesa todos los puntos.
 * @param smooth Usa interpolacion cubica monotona en lugar de segmentos rectos.
 */
export function linePath(points: readonly Point[], smooth = false): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M${r(first.x)},${r(first.y)}`;

  if (!smooth) {
    let d = `M${r(first.x)},${r(first.y)}`;
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (point) d += `L${r(point.x)},${r(point.y)}`;
    }
    return d;
  }

  const tangents = monotoneTangents(points);
  let d = `M${r(first.x)},${r(first.y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dx = (b.x - a.x) / 3;
    const c1x = a.x + dx;
    const c1y = a.y + dx * (tangents[i] ?? 0);
    const c2x = b.x - dx;
    const c2y = b.y - dx * (tangents[i + 1] ?? 0);
    d += `C${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(b.x)},${r(b.y)}`;
  }
  return d;
}

/**
 * Area cerrada entre la serie y una linea base horizontal.
 * @param baseline Coordenada y del cierre inferior.
 */
export function areaPath(points: readonly Point[], baseline: number, smooth = false): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points, smooth)}L${r(last.x)},${r(baseline)}L${r(first.x)},${r(baseline)}Z`;
}

/** Convierte un angulo (radianes, 0 = arriba, sentido horario) a coordenadas. */
export function polarToCartesian(cx: number, cy: number, radius: number, angle: number): Point {
  return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
}

/**
 * Segmento anular (donut). Con `innerRadius` 0 produce un sector de pastel.
 * Los angulos van en radianes con 0 en las 12 en punto.
 */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return '';

  // Un arco completo no puede dibujarse con un solo comando A: se parte en dos.
  if (sweep >= Math.PI * 2 - 1e-6) {
    const half = Math.PI;
    return (
      arcPath(cx, cy, outerRadius, innerRadius, startAngle, startAngle + half) +
      arcPath(cx, cy, outerRadius, innerRadius, startAngle + half, startAngle + half * 2)
    );
  }

  const largeArc = sweep > Math.PI ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);

  if (innerRadius <= 0) {
    return [
      `M${r(cx)},${r(cy)}`,
      `L${r(outerStart.x)},${r(outerStart.y)}`,
      `A${r(outerRadius)},${r(outerRadius)} 0 ${largeArc} 1 ${r(outerEnd.x)},${r(outerEnd.y)}`,
      'Z',
    ].join('');
  }

  return [
    `M${r(outerStart.x)},${r(outerStart.y)}`,
    `A${r(outerRadius)},${r(outerRadius)} 0 ${largeArc} 1 ${r(outerEnd.x)},${r(outerEnd.y)}`,
    `L${r(innerEnd.x)},${r(innerEnd.y)}`,
    `A${r(innerRadius)},${r(innerRadius)} 0 ${largeArc} 0 ${r(innerStart.x)},${r(innerStart.y)}`,
    'Z',
  ].join('');
}

/** Rectangulo con esquinas superiores redondeadas (barras verticales). */
export function barPath(x: number, y: number, width: number, height: number, radius: number): string {
  const rr = Math.max(0, Math.min(radius, width / 2, height));
  if (rr === 0) return `M${r(x)},${r(y)}h${r(width)}v${r(height)}h${r(-width)}Z`;
  return [
    `M${r(x)},${r(y + height)}`,
    `V${r(y + rr)}`,
    `Q${r(x)},${r(y)} ${r(x + rr)},${r(y)}`,
    `H${r(x + width - rr)}`,
    `Q${r(x + width)},${r(y)} ${r(x + width)},${r(y + rr)}`,
    `V${r(y + height)}`,
    'Z',
  ].join('');
}

/** Trapecio de un tramo de embudo, centrado horizontalmente. */
export function funnelSegmentPath(
  centerX: number,
  top: number,
  bottom: number,
  topWidth: number,
  bottomWidth: number,
): string {
  const halfTop = topWidth / 2;
  const halfBottom = bottomWidth / 2;
  return [
    `M${r(centerX - halfTop)},${r(top)}`,
    `L${r(centerX + halfTop)},${r(top)}`,
    `L${r(centerX + halfBottom)},${r(bottom)}`,
    `L${r(centerX - halfBottom)},${r(bottom)}`,
    'Z',
  ].join('');
}
