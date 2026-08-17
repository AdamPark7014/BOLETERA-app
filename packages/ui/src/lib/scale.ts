/**
 * Helpers de escala para los charts SVG. Reemplazan a d3-scale / d3-array con
 * las tres primitivas que realmente usamos: escala lineal, escala de bandas y
 * generacion de ticks "redondos".
 */

/** Punto 2D en coordenadas de pantalla (px). */
export interface Point {
  x: number;
  y: number;
}

/** Rango cerrado `[min, max]`. */
export type Extent = readonly [number, number];

/** Recorta `value` al intervalo `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Minimo y maximo de una serie, ignorando valores no finitos.
 * Devuelve `[0, 0]` si no hay ningun valor utilizable.
 */
export function extent(values: readonly number[]): Extent {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Number.POSITIVE_INFINITY) return [0, 0];
  return [min, max];
}

/** Suma de una serie ignorando valores no finitos. */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** Redondea a un "paso agradable" (1, 2, 2.5, 5 o 10 por decada). */
function niceStep(rawStep: number): number {
  if (rawStep <= 0 || !Number.isFinite(rawStep)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const stepped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return stepped * magnitude;
}

/**
 * Expande un dominio hasta limites redondos para que los ticks caigan en
 * valores legibles. Garantiza un dominio de amplitud no nula.
 */
export function niceDomain(domain: Extent, tickCount = 5): Extent {
  const [rawMin, rawMax] = domain;
  if (rawMin === rawMax) {
    const pad = Math.abs(rawMin) > 0 ? Math.abs(rawMin) * 0.1 : 1;
    return [rawMin - pad, rawMax + pad];
  }
  const step = niceStep((rawMax - rawMin) / Math.max(1, tickCount));
  return [Math.floor(rawMin / step) * step, Math.ceil(rawMax / step) * step];
}

/**
 * Ticks equiespaciados dentro de un dominio ya "nicificado".
 * Se corrigen los errores de coma flotante para evitar etiquetas tipo `0.30000000004`.
 */
export function ticks(domain: Extent, tickCount = 5): number[] {
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const step = niceStep((max - min) / Math.max(1, tickCount));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const out: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    out.push(Number(value.toFixed(decimals + 2)));
  }
  return out;
}

/** Proyeccion lineal dominio -> rango, con su inversa. */
export interface LinearScale {
  (value: number): number;
  /** Proyeccion inversa rango -> dominio (usada por los tooltips). */
  invert(position: number): number;
  domain: Extent;
  range: Extent;
}

/**
 * Escala lineal continua. Si el dominio es degenerado se proyecta al centro
 * del rango en lugar de dividir entre cero.
 */
export function linearScale(domain: Extent, range: Extent): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const ratio = span === 0 ? 0 : (r1 - r0) / span;
  const midpoint = (r0 + r1) / 2;

  const scale = ((value: number): number =>
    span === 0 ? midpoint : r0 + (value - d0) * ratio) as LinearScale;

  scale.invert = (position: number): number =>
    ratio === 0 ? d0 : d0 + (position - r0) / ratio;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/** Escala ordinal de bandas para barras y heatmaps. */
export interface BandScale {
  /** Coordenada inicial de la banda `index`. */
  (index: number): number;
  /** Ancho util de cada banda, ya descontado el padding. */
  bandwidth: number;
  /** Distancia entre inicios de banda consecutivos. */
  step: number;
  /** Centro de la banda `index`. */
  center(index: number): number;
  /** Indice de banda mas cercano a una coordenada del rango. */
  indexAt(position: number): number;
  count: number;
}

/**
 * Reparte `count` bandas en `range`.
 * @param padding Proporcion `[0, 1)` del paso reservada como separacion.
 */
export function bandScale(count: number, range: Extent, padding = 0.2): BandScale {
  const [r0, r1] = range;
  const safeCount = Math.max(1, count);
  const step = (r1 - r0) / safeCount;
  const gap = step * clamp(padding, 0, 0.9);
  const bandwidth = Math.max(1, step - gap);

  const scale = ((index: number): number => r0 + index * step + gap / 2) as BandScale;
  scale.bandwidth = bandwidth;
  scale.step = step;
  scale.count = safeCount;
  scale.center = (index: number): number => scale(index) + bandwidth / 2;
  scale.indexAt = (position: number): number =>
    step === 0 ? 0 : clamp(Math.floor((position - r0) / step), 0, safeCount - 1);
  return scale;
}

/**
 * Indice del punto cuya coordenada x esta mas cerca de `position`.
 * Los puntos deben venir ordenados por x (siempre lo estan: los generamos nosotros).
 */
export function nearestIndex(points: readonly Point[], position: number): number {
  if (points.length === 0) return -1;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const candidate = points[i];
    if (!candidate) continue;
    const distance = Math.abs(candidate.x - position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}
