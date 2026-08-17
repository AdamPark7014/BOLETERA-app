'use client';

/**
 * Capa de butacas sobre canvas.
 *
 * El editor dibujaba cada butaca como un `<g>` con tres `<rect>` y un `<text>`:
 * a 45.000 butacas son ~180.000 nodos del DOM, y el navegador no llega. Aquí las
 * butacas viven en un único `<canvas>`; lo estructural (secciones, escenario,
 * pasillos, salidas) sigue en SVG encima, que es donde el DOM sí compensa.
 *
 * Tres decisiones sostienen el rendimiento:
 *  1. Recorte por viewport: solo se dibuja lo que cabe en pantalla.
 *  2. Nivel de detalle: alejado se pintan secciones o manchas de densidad.
 *  3. Agrupación por color: un `fill()` por color en vez de uno por butaca.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  SEAT_FLAG,
  buildClusters,
  lodModeFor,
  querySeatsInRect,
  type LodMode,
  type SeatIndex,
} from '@boletera/venue-engine';

export type SeatCanvasProps = {
  index: SeatIndex;
  /** Índices internos seleccionados (no ids: la comparación debe ser O(1)). */
  selected: ReadonlySet<number>;
  /** Índices con solapamiento detectado por la validación. */
  overlaps?: ReadonlySet<number>;
  /** Puntuación de visibilidad por índice, para el mapa de calor. */
  sightlines?: Float32Array | null;
  /** Nivel arquitectónico activo; `null` = todos. */
  levelFilter?: string | null;
  scale: number;
  tx: number;
  ty: number;
  width: number;
  height: number;
  /** Rectángulo de selección en curso (coordenadas de mundo). */
  marquee?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Resalta las plazas accesibles. */
  showAccessible?: boolean;
  className?: string;
};

/** Colores base, alineados con la paleta del editor. */
const COLOR = {
  background: '#0a0a0a',
  selected: '#ffffff',
  selectedStroke: '#e11d48',
  overlap: '#f97316',
  blocked: '#3f3f46',
  premiumView: '#d4a017',
  premiumTier: '#f59e0b',
  economyTier: '#64748b',
  fallback: '#38bdf8',
  accessible: '#22d3ee',
  companion: '#0ea5e9',
  marquee: 'rgba(225,29,72,0.18)',
  marqueeStroke: '#e11d48',
  clusterText: 'rgba(250,250,250,0.85)',
};

function sightlineColor(score: number): string {
  const t = Math.min(1, Math.max(0, score));
  const stops: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 63, 63, 70],
    [0.28, 190, 70, 70],
    [0.5, 180, 140, 50],
    [0.72, 56, 160, 120],
    [1, 34, 197, 94],
  ];
  let a = stops[0];
  let b = stops[1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const u = (t - a[0]) / Math.max(b[0] - a[0], 0.0001);
  return `rgb(${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)},${Math.round(a[3] + (b[3] - a[3]) * u)})`;
}

export function SeatCanvasLayer({
  index,
  selected,
  overlaps,
  sightlines,
  levelFilter,
  scale,
  tx,
  ty,
  width,
  height,
  marquee,
  showAccessible = true,
  className,
}: SeatCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const scratch = useRef<number[]>([]);

  /** Índice del nivel activo, resuelto una vez. */
  const levelIdxFilter = useMemo(() => {
    if (!levelFilter) return -1;
    const i = index.levels.indexOf(levelFilter);
    return i < 0 ? -2 : i; // -2 = nivel inexistente, no se pinta nada
  }, [levelFilter, index.levels]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.floor(width * dpr));
    const pxH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Rectángulo visible en coordenadas de mundo.
    const viewMinX = (-tx) / scale;
    const viewMinY = (-ty) / scale;
    const viewMaxX = (width - tx) / scale;
    const viewMaxY = (height - ty) / scale;

    const mode: LodMode = lodModeFor(scale);

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    if (mode === 'sections') {
      drawSections(ctx, index, scale, levelIdxFilter);
    } else if (mode === 'clusters') {
      drawClusters(ctx, index, viewMinX, viewMinY, viewMaxX, viewMaxY, scale, levelIdxFilter);
    } else {
      drawSeats(
        ctx,
        index,
        viewMinX,
        viewMinY,
        viewMaxX,
        viewMaxY,
        scale,
        selected,
        overlaps,
        sightlines,
        levelIdxFilter,
        showAccessible,
        scratch.current,
      );
    }

    // Rectángulo de selección.
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      const w = Math.abs(marquee.x1 - marquee.x0);
      const h = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = COLOR.marquee;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = COLOR.marqueeStroke;
      ctx.lineWidth = 1 / scale;
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }, [
    index,
    selected,
    overlaps,
    sightlines,
    levelIdxFilter,
    scale,
    tx,
    ty,
    width,
    height,
    marquee,
    showAccessible,
  ]);

  /** Se repinta en el siguiente cuadro: varios cambios seguidos dibujan una vez. */
  useEffect(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );
}

/* ── Dibujo por nivel de detalle ───────────────────────────────────────────── */

/** Mapa alejado: un polígono/caja por sección con su aforo. */
function drawSections(
  ctx: CanvasRenderingContext2D,
  index: SeatIndex,
  scale: number,
  levelIdxFilter: number,
) {
  for (const sec of index.sections) {
    if (!sec.seatCount) continue;
    if (levelIdxFilter >= 0 && sec.levelId && index.levels[levelIdxFilter] !== sec.levelId) continue;

    ctx.fillStyle = sec.color;
    ctx.globalAlpha = 0.55;
    if (sec.shape?.length) {
      ctx.beginPath();
      ctx.moveTo(sec.shape[0][0], sec.shape[0][1]);
      for (let i = 1; i < sec.shape.length; i++) ctx.lineTo(sec.shape[i][0], sec.shape[i][1]);
      ctx.closePath();
      ctx.fill();
    } else {
      const pad = 8;
      ctx.fillRect(
        sec.minX - pad,
        sec.minY - pad,
        sec.maxX - sec.minX + pad * 2,
        sec.maxY - sec.minY + pad * 2,
      );
    }
    ctx.globalAlpha = 1;

    // Etiqueta legible: se dibuja en unidades de mundo compensando el zoom.
    const fontPx = 13 / scale;
    ctx.fillStyle = COLOR.clusterText;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sec.name, sec.cx, sec.cy - fontPx * 0.6);
    ctx.font = `${fontPx * 0.85}px system-ui, sans-serif`;
    ctx.fillText(`${sec.seatCount}`, sec.cx, sec.cy + fontPx * 0.7);
  }
}

/** Zoom intermedio: manchas de densidad que conservan la forma del recinto. */
function drawClusters(
  ctx: CanvasRenderingContext2D,
  index: SeatIndex,
  viewMinX: number,
  viewMinY: number,
  viewMaxX: number,
  viewMaxY: number,
  scale: number,
  levelIdxFilter: number,
) {
  // Celda de ~18 px en pantalla: suficiente para leer la forma sin saturar.
  const cellWorld = 18 / scale;
  const clusters = buildClusters(index, viewMinX, viewMinY, viewMaxX, viewMaxY, cellWorld);

  // Agrupadas por color de sección: un `fill()` por color.
  const bySection = new Map<number, typeof clusters>();
  for (const c of clusters) {
    const sec = index.sections[c.sectionIdx];
    if (levelIdxFilter >= 0 && sec?.levelId && index.levels[levelIdxFilter] !== sec.levelId) continue;
    const arr = bySection.get(c.sectionIdx) ?? [];
    arr.push(c);
    bySection.set(c.sectionIdx, arr);
  }

  const half = cellWorld * 0.45;
  for (const [sectionIdx, list] of bySection) {
    ctx.fillStyle = index.sections[sectionIdx]?.color ?? COLOR.fallback;
    ctx.beginPath();
    for (const c of list) {
      // La opacidad la da la densidad: celdas llenas se ven sólidas.
      ctx.rect(c.cx - half, c.cy - half, half * 2, half * 2);
    }
    ctx.fill();
  }
}

/** Zoom de trabajo: butacas individuales, solo las visibles. */
function drawSeats(
  ctx: CanvasRenderingContext2D,
  index: SeatIndex,
  viewMinX: number,
  viewMinY: number,
  viewMaxX: number,
  viewMaxY: number,
  scale: number,
  selected: ReadonlySet<number>,
  overlaps: ReadonlySet<number> | undefined,
  sightlines: Float32Array | null | undefined,
  levelIdxFilter: number,
  showAccessible: boolean,
  scratch: number[],
) {
  // Margen de una butaca para que no aparezcan cortadas al borde.
  const margin = index.pitch;
  querySeatsInRect(
    index,
    viewMinX - margin,
    viewMinY - margin,
    viewMaxX + margin,
    viewMaxY + margin,
    scratch,
  );

  const { x, y, flags, tierIdx, sectionIdx, levelIdx, tiers } = index;
  const premiumTier = tiers.indexOf('premium');
  const economyTier = tiers.indexOf('economy');

  // Tamaño de butaca en unidades de mundo: ~62 % del paso, para que se lea el hueco.
  const w = index.pitch * 0.62;
  const h = index.pitch * 0.58;
  const hw = w / 2;
  const hh = h / 2;

  // Se agrupan por color: cada color es un único trazado.
  const byColor = new Map<string, number[]>();
  const selectedList: number[] = [];
  const overlapList: number[] = [];

  for (const i of scratch) {
    if (levelIdxFilter === -2) continue;
    if (levelIdxFilter >= 0) {
      const li = levelIdx[i];
      // 0xffff = butaca sin nivel: visible en todos.
      if (li !== 0xffff && li !== levelIdxFilter) continue;
    }

    if (selected.has(i)) {
      selectedList.push(i);
      continue;
    }
    if (overlaps?.has(i)) {
      overlapList.push(i);
      continue;
    }

    const f = flags[i];
    let color: string;
    if (sightlines) {
      color = sightlineColor(sightlines[i]);
    } else if (f & SEAT_FLAG.BLOCKED) {
      color = COLOR.blocked;
    } else if (showAccessible && f & SEAT_FLAG.ACCESSIBLE) {
      color = f & SEAT_FLAG.COMPANION ? COLOR.companion : COLOR.accessible;
    } else if (f & SEAT_FLAG.PREMIUM_VIEW) {
      color = COLOR.premiumView;
    } else if (tierIdx[i] === premiumTier && premiumTier >= 0) {
      color = COLOR.premiumTier;
    } else if (tierIdx[i] === economyTier && economyTier >= 0) {
      color = COLOR.economyTier;
    } else {
      color = index.sections[sectionIdx[i]]?.color ?? COLOR.fallback;
    }

    const arr = byColor.get(color);
    if (arr) arr.push(i);
    else byColor.set(color, [i]);
  }

  // Butacas normales: un trazado por color.
  for (const [color, list] of byColor) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const i of list) ctx.rect(x[i] - hw, y[i] - hh, w, h);
    ctx.fill();
  }

  // Solapamientos: borde naranja, es un aviso de la validación.
  if (overlapList.length) {
    ctx.fillStyle = COLOR.blocked;
    ctx.beginPath();
    for (const i of overlapList) ctx.rect(x[i] - hw, y[i] - hh, w, h);
    ctx.fill();
    ctx.strokeStyle = COLOR.overlap;
    ctx.lineWidth = Math.max(1 / scale, 0.8);
    ctx.stroke();
  }

  // Seleccionadas: se pintan al final para quedar por encima.
  if (selectedList.length) {
    ctx.fillStyle = COLOR.selected;
    ctx.beginPath();
    for (const i of selectedList) ctx.rect(x[i] - hw, y[i] - hh, w, h);
    ctx.fill();
    ctx.strokeStyle = COLOR.selectedStroke;
    ctx.lineWidth = Math.max(1.2 / scale, 0.9);
    ctx.stroke();
  }

  // Etiquetas solo con zoom suficiente: por debajo son ilegibles y cuestan caro.
  if (scale >= 1.6) {
    const fontPx = 5.5;
    ctx.fillStyle = 'rgba(250,250,250,0.75)';
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Tope de seguridad: dibujar texto es lo más caro del canvas.
    const MAX_LABELS = 1200;
    const list = scratch.length > MAX_LABELS ? scratch.slice(0, MAX_LABELS) : scratch;
    for (const i of list) ctx.fillText(index.labels[i], x[i], y[i] + hh + 1);
  }
}
