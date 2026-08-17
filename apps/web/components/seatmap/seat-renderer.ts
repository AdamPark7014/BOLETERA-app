/**
 * Pintado en canvas 2D del mapa de butacas.
 *
 * Decisiones de rendimiento (el porqué, que el código no dice solo):
 *
 * · Dos canvas apilados. El de secciones sólo se repinta cuando cambia la
 *   transformación o un filtro; el de butacas se repinta además con cada delta
 *   del SSE. Separarlos evita reconstruir ~30 polígonos + texto en cada cambio
 *   de estado de una butaca suelta.
 * · Un `Path2D` por color. `fillStyle` es el cambio de estado más caro del
 *   contexto 2D; agrupando, 45.000 butacas caben en 4-6 `fill()`.
 * · Proyección manual (`x * scale + tx`) en vez de `ctx.scale()`. Así los
 *   grosores de línea y el tamaño de fuente van en píxeles CSS reales y no hay
 *   que dividir por la escala en cada trazo.
 * · `devicePixelRatio` con techo de 2: un móvil con DPR 3 y un canvas a pantalla
 *   completa serían ~2,2× más píxeles que a DPR 2, sin diferencia perceptible.
 */

import type { SeatGrid } from './spatial-index';
import { forEachSeatInRect } from './spatial-index';
import type { SectionShape } from './section-shapes';
import type { RenderSeat, SeatStatus, ViewTransform } from './types';

/** Techo de densidad: por encima de 2 sólo se gasta memoria y fill-rate. */
export const MAX_DPR = 2;

export type CanvasSize = { width: number; height: number; dpr: number };

/**
 * Ajusta el buffer del canvas al tamaño CSS y deja el contexto en píxeles CSS.
 * Devuelve null si el navegador no da contexto 2D (el visor cae al selector
 * accesible, que no depende del canvas).
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  size: CanvasSize,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;
  const bw = Math.max(1, Math.round(size.width * size.dpr));
  const bh = Math.max(1, Math.round(size.height * size.dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  return ctx;
}

export function resolveDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/**
 * Acepta `#rgb`, `#rrggbb` y `rgb(r,g,b)`: los heat del motor de venue
 * (`priceHeatColor`, `sightlineHeatColor`) devuelven la forma `rgb(...)`.
 */
function parseColor(color: string): [number, number, number] | null {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const raw = hex[1];
    if (raw.length === 3) {
      return [
        parseInt(raw[0] + raw[0], 16),
        parseInt(raw[1] + raw[1], 16),
        parseInt(raw[2] + raw[2], 16),
      ];
    }
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Mezcla dos colores hex. `t=0` → a, `t=1` → b. */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// ---------------------------------------------------------------------------
// Capa de secciones (zoom bajo = esto ES el mapa)
// ---------------------------------------------------------------------------

export type SectionPaint = {
  shape: SectionShape;
  /** Relleno agregado ya calculado (color de zona teñido por ocupación). */
  fill: string;
  outline: string;
  dimmed: boolean;
  /** Nombre corto para la etiqueta. */
  title: string;
  /** Segunda línea: «312 libres», «Agotada»… */
  subtitle: string;
  /** Patrón diagonal además del color: daltonismo (WCAG 1.4.1). */
  hatched: boolean;
};

let hatchPattern: CanvasPattern | null = null;

function getHatch(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (hatchPattern) return hatchPattern;
  if (typeof document === 'undefined') return null;
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  tctx.strokeStyle = 'rgba(9,9,11,0.55)';
  tctx.lineWidth = 2;
  tctx.beginPath();
  tctx.moveTo(-2, 10);
  tctx.lineTo(10, -2);
  tctx.moveTo(2, 14);
  tctx.lineTo(14, 2);
  tctx.stroke();
  hatchPattern = ctx.createPattern(tile, 'repeat');
  return hatchPattern;
}

export function drawSectionLayer(
  ctx: CanvasRenderingContext2D,
  size: CanvasSize,
  view: ViewTransform,
  paints: readonly SectionPaint[],
  opts: { showLabels: boolean; faded: boolean },
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  const { scale, tx, ty } = view;
  // Con las butacas dibujadas encima, la mancha de zona pasa a ser contexto:
  // baja la opacidad para que no compita con el estado de cada asiento.
  const baseAlpha = opts.faded ? 0.22 : 0.92;

  for (const paint of paints) {
    const pts = paint.shape.points;
    if (pts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * scale + tx, pts[0][1] * scale + ty);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0] * scale + tx, pts[i][1] * scale + ty);
    }
    ctx.closePath();

    ctx.globalAlpha = paint.dimmed ? baseAlpha * 0.3 : baseAlpha;
    ctx.fillStyle = paint.fill;
    ctx.fill();

    if (paint.hatched && !opts.faded) {
      const pattern = getHatch(ctx);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fill();
      }
    }

    ctx.globalAlpha = paint.dimmed ? 0.25 : 1;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = paint.outline;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (!opts.showLabels) return;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const paint of paints) {
    if (paint.dimmed) continue;
    const cx = paint.shape.centroid[0] * scale + tx;
    const cy = paint.shape.centroid[1] * scale + ty;
    if (cx < -120 || cy < -60 || cx > size.width + 120 || cy > size.height + 60) continue;

    ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const titleWidth = ctx.measureText(paint.title).width;
    ctx.font = '600 9.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    const subWidth = ctx.measureText(paint.subtitle).width;
    const boxW = Math.max(titleWidth, subWidth) + 14;

    // Placa opaca detrás del texto: sobre el relleno de zona el contraste no
    // llegaría a 4.5:1 en las zonas claras.
    ctx.fillStyle = 'rgba(9,9,11,0.86)';
    ctx.fillRect(cx - boxW / 2, cy - 15, boxW, 30);
    ctx.strokeStyle = withAlpha(paint.outline, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxW / 2, cy - 15, boxW, 30);

    ctx.fillStyle = '#fafafa';
    ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(paint.title, cx, cy - 5);
    ctx.fillStyle = 'rgba(250,250,250,0.78)';
    ctx.font = '600 9.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(paint.subtitle, cx, cy + 7);
  }
}

// ---------------------------------------------------------------------------
// Capa de butacas
// ---------------------------------------------------------------------------

export type SeatLayerInput = {
  seats: readonly RenderSeat[];
  grid: SeatGrid;
  /** Estado efectivo (incluye la selección local, que no viene del API). */
  statusAt: (index: number) => SeatStatus;
  /** Fuera de filtro: se pinta apagada y no es seleccionable. */
  dimmedAt: (index: number) => boolean;
  /** Color de relleno; lo decide el visor (heat de precio, de vista, zona…). */
  fillAt: (index: number, status: SeatStatus, dimmed: boolean) => string;
  /** Lado mayor de la butaca en píxeles CSS. */
  seatPx: number;
  /** Butaca con foco de teclado o bajo el cursor. */
  focusedIndex: number;
  /** Butacas perdidas en un 409: laten en ámbar hasta que el usuario reacciona. */
  conflictIndexes: readonly number[];
  /** 0..1, fase del latido del conflicto. */
  conflictPhase: number;
  /** Filtro «solo lugares accesibles»: el resto se apaga. */
  accessibleOnly: boolean;
  showLabels: boolean;
};

/**
 * Pinta las butacas visibles. Devuelve cuántas dibujó (para telemetría/tests).
 *
 * El recorrido va por celdas de la rejilla, no por el array completo: con zoom
 * alto se tocan cientos de butacas en vez de 45.000.
 */
export function drawSeatLayer(
  ctx: CanvasRenderingContext2D,
  size: CanvasSize,
  view: ViewTransform,
  input: SeatLayerInput,
): number {
  ctx.clearRect(0, 0, size.width, size.height);
  const { scale, tx, ty } = view;
  const { seats, grid, seatPx } = input;

  const w = seatPx;
  const h = seatPx * 0.82;
  const hw = w / 2;
  const hh = h / 2;
  // Margen de un asiento para que no aparezcan/desaparezcan en el borde.
  const pad = (Math.max(w, h) + 6) / scale;
  const worldMinX = (0 - tx) / scale - pad;
  const worldMinY = (0 - ty) / scale - pad;
  const worldMaxX = (size.width - tx) / scale + pad;
  const worldMaxY = (size.height - ty) / scale + pad;

  // Un path por color; se rellenan todos al final.
  const rectPaths = new Map<string, Path2D>();
  const circlePaths = new Map<string, Path2D>();
  const heldMarks = new Path2D();
  const soldMarks = new Path2D();
  const restrictedMarks = new Path2D();
  const selectedRings = new Path2D();
  const accessibleRings = new Path2D();

  // Las marcas de forma (aspa, diagonal, anillo) sólo son legibles a partir de
  // ~7 px; por debajo sólo añadirían ruido y coste.
  const showMarks = seatPx >= 7;
  const useRotation = seatPx >= 9;
  let drawn = 0;

  forEachSeatInRect(grid, worldMinX, worldMinY, worldMaxX, worldMaxY, (i) => {
    const seat = seats[i];
    const sx = seat.x * scale + tx;
    const sy = seat.y * scale + ty;
    if (sx < -w || sy < -h || sx > size.width + w || sy > size.height + h) return;

    const status = input.statusAt(i);
    const dimmed = input.dimmedAt(i) || (input.accessibleOnly && !seat.accessible);
    const fill = input.fillAt(i, status, dimmed);
    drawn += 1;

    if (seat.accessible) {
      // Silueta distinta (círculo) además del color: el estado y la condición
      // de lugar accesible no pueden depender sólo del color (WCAG 1.4.1).
      let path = circlePaths.get(fill);
      if (!path) circlePaths.set(fill, (path = new Path2D()));
      path.moveTo(sx + hw, sy);
      path.arc(sx, sy, hw, 0, Math.PI * 2);
      if (showMarks && !dimmed) {
        accessibleRings.moveTo(sx + hw + 1.2, sy);
        accessibleRings.arc(sx, sy, hw + 1.2, 0, Math.PI * 2);
      }
    } else {
      let path = rectPaths.get(fill);
      if (!path) rectPaths.set(fill, (path = new Path2D()));
      const rot = seat.rotation ?? 0;
      if (useRotation && Math.abs(rot) > 0.5) {
        const rad = (rot * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        path.moveTo(sx + c * -hw - s * -hh, sy + s * -hw + c * -hh);
        path.lineTo(sx + c * hw - s * -hh, sy + s * hw + c * -hh);
        path.lineTo(sx + c * hw - s * hh, sy + s * hw + c * hh);
        path.lineTo(sx + c * -hw - s * hh, sy + s * -hw + c * hh);
        path.closePath();
      } else {
        path.rect(sx - hw, sy - hh, w, h);
      }
    }

    if (!showMarks || dimmed) return;

    if (status === 'held') {
      // Diagonal = apartada.
      heldMarks.moveTo(sx - hw * 0.6, sy + hh * 0.6);
      heldMarks.lineTo(sx + hw * 0.6, sy - hh * 0.6);
    } else if (status === 'sold' || status === 'blocked') {
      // Aspa = no disponible.
      soldMarks.moveTo(sx - hw * 0.55, sy - hh * 0.55);
      soldMarks.lineTo(sx + hw * 0.55, sy + hh * 0.55);
      soldMarks.moveTo(sx + hw * 0.55, sy - hh * 0.55);
      soldMarks.lineTo(sx - hw * 0.55, sy + hh * 0.55);
    } else if (status === 'selected') {
      selectedRings.rect(sx - hw - 2, sy - hh - 2, w + 4, h + 4);
    }
    if (seat.restricted && status !== 'sold') {
      restrictedMarks.moveTo(sx - hw * 0.5, sy + hh * 0.75);
      restrictedMarks.lineTo(sx + hw * 0.5, sy + hh * 0.75);
    }
  });

  for (const [color, path] of rectPaths) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  for (const [color, path] of circlePaths) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }

  if (showMarks) {
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, seatPx * 0.09);
    ctx.strokeStyle = 'rgba(9,9,11,0.72)';
    ctx.stroke(heldMarks);
    ctx.strokeStyle = 'rgba(250,250,250,0.55)';
    ctx.stroke(soldMarks);
    ctx.strokeStyle = 'rgba(226,232,240,0.85)';
    ctx.lineWidth = Math.max(1, seatPx * 0.08);
    ctx.stroke(restrictedMarks);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke(selectedRings);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke(accessibleRings);
  }

  if (input.showLabels) {
    ctx.fillStyle = 'rgba(250,250,250,0.62)';
    ctx.font = `600 ${Math.min(11, seatPx * 0.42)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    forEachSeatInRect(grid, worldMinX, worldMinY, worldMaxX, worldMaxY, (i) => {
      if (input.dimmedAt(i)) return;
      const seat = seats[i];
      const sx = seat.x * scale + tx;
      const sy = seat.y * scale + ty;
      if (sx < 0 || sy < 0 || sx > size.width || sy > size.height) return;
      ctx.fillText(seat.label, sx, sy + hh + 2);
    });
  }

  // Foco: anillo doble (oscuro + claro) para que se vea sobre cualquier relleno
  // — WCAG 2.4.11 pide que el indicador sea perceptible, no sólo que exista.
  if (input.focusedIndex >= 0 && input.focusedIndex < seats.length) {
    const seat = seats[input.focusedIndex];
    const sx = seat.x * scale + tx;
    const sy = seat.y * scale + ty;
    const r = Math.max(hw + 4, 8);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(9,9,11,0.9)';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fafafa';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (input.conflictIndexes.length) {
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(input.conflictPhase * Math.PI));
    ctx.strokeStyle = `rgba(251,146,60,${pulse.toFixed(3)})`;
    ctx.lineWidth = 3;
    for (const i of input.conflictIndexes) {
      if (i < 0 || i >= seats.length) continue;
      const seat = seats[i];
      const sx = seat.x * scale + tx;
      const sy = seat.y * scale + ty;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(hw + 6, 11), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  return drawn;
}
