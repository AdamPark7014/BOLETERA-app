'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ViewTransform } from '@/components/seatmap/types';

/**
 * Gestos del mapa: pellizco, arrastre con inercia, doble toque y rueda.
 *
 * Regla que gobierna todo el hook: **la transformación NO vive en estado de
 * React**. Un arrastre genera ~120 eventos por segundo; si cada uno provocara
 * un render, el visor iría a tirones en cualquier móvil de gama media. La
 * transformación vive en un ref y un único `requestAnimationFrame` la aplica
 * (canvas + grupos SVG). React sólo se entera de la escala, y con retardo,
 * para los textos de ayuda y los umbrales de la UI.
 *
 * Los listeners se registran a mano (no como props de React) porque `wheel` y
 * `touchstart` necesitan `{ passive: false }` para poder cancelar el zoom y el
 * scroll del navegador.
 */

export type GestureOptions = {
  minScale: number;
  maxScale: number;
  /** Se llama dentro del rAF con la transformación vigente. */
  onFrame: (view: ViewTransform) => void;
  /** Toque/clic simple que no fue arrastre. Coordenadas de cliente. */
  onTap?: (clientX: number, clientY: number) => void;
  onDoubleTap?: (clientX: number, clientY: number) => void;
  /** Sólo puntero fino (ratón/stylus): hover para el tooltip. */
  onHover?: (clientX: number, clientY: number) => void;
  onHoverEnd?: () => void;
  /** Escala publicada a React, como mucho cada 120 ms. */
  onScaleChange?: (scale: number) => void;
  onPanningChange?: (panning: boolean) => void;
};

export type GestureController = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewRef: React.MutableRefObject<ViewTransform>;
  /** Pide un repintado en el próximo frame (idempotente). */
  requestFrame: () => void;
  /** Zoom relativo anclado a un punto de pantalla (por defecto, el centro). */
  zoomBy: (factor: number, clientX?: number, clientY?: number, animate?: boolean) => void;
  /** Encaja un rectángulo de mundo en el viewport. */
  fitRect: (
    rect: { minX: number; minY: number; width: number; height: number },
    padding?: number,
    animate?: boolean,
  ) => boolean;
  /** Centra un punto de mundo, opcionalmente con una escala destino. */
  centerOn: (worldX: number, worldY: number, scale?: number, animate?: boolean) => void;
  /** Convierte coordenadas de cliente a mundo. */
  toWorld: (clientX: number, clientY: number) => { x: number; y: number } | null;
};

const TAP_SLOP_PX = 9;
const TAP_MAX_MS = 320;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP_PX = 34;
const SCALE_PUBLISH_MS = 120;
/** Por debajo de esto el arrastre no tenía intención de lanzar nada. */
const INERTIA_MIN_SPEED = 0.06; // px/ms
const INERTIA_DECAY = 0.93;
const ANIM_MS = 240;

export function useMapGestures(options: GestureOptions): GestureController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });

  // Las opciones cambian de identidad en cada render; guardarlas en un ref
  // evita volver a registrar listeners (y perder capturas de puntero) siempre.
  const optsRef = useRef(options);
  optsRef.current = options;

  const frameRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const lastScalePublishRef = useRef(0);
  const publishedScaleRef = useRef(-1);

  const inertiaRef = useRef<{ vx: number; vy: number } | null>(null);
  const animRef = useRef<{
    from: ViewTransform;
    to: ViewTransform;
    start: number;
    duration: number;
  } | null>(null);

  const requestFrame = useCallback(() => {
    dirtyRef.current = true;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(function step(now: number) {
      frameRef.current = null;
      const view = viewRef.current;

      // 1. Animación programada (doble toque, encajar, ir a butaca).
      const anim = animRef.current;
      if (anim) {
        const t = Math.min(1, (now - anim.start) / anim.duration);
        // easeOutCubic: arranca rápido y frena, que es lo que espera el dedo.
        const k = 1 - Math.pow(1 - t, 3);
        view.scale = anim.from.scale + (anim.to.scale - anim.from.scale) * k;
        view.tx = anim.from.tx + (anim.to.tx - anim.from.tx) * k;
        view.ty = anim.from.ty + (anim.to.ty - anim.from.ty) * k;
        if (t >= 1) animRef.current = null;
        dirtyRef.current = true;
      }

      // 2. Inercia del arrastre.
      const inertia = inertiaRef.current;
      if (inertia && !anim) {
        view.tx += inertia.vx * 16;
        view.ty += inertia.vy * 16;
        inertia.vx *= INERTIA_DECAY;
        inertia.vy *= INERTIA_DECAY;
        if (Math.hypot(inertia.vx, inertia.vy) < 0.02) inertiaRef.current = null;
        dirtyRef.current = true;
      }

      optsRef.current.onFrame(view);

      // La escala llega a React con cuentagotas: sólo alimenta textos y
      // umbrales, no el dibujo.
      if (
        now - lastScalePublishRef.current > SCALE_PUBLISH_MS &&
        Math.abs(view.scale - publishedScaleRef.current) > 0.001
      ) {
        lastScalePublishRef.current = now;
        publishedScaleRef.current = view.scale;
        optsRef.current.onScaleChange?.(view.scale);
      }

      if (animRef.current || inertiaRef.current || dirtyRef.current) {
        dirtyRef.current = false;
        if (animRef.current || inertiaRef.current) requestFrame();
      }
    });
  }, []);

  const clampScale = useCallback((value: number) => {
    const { minScale, maxScale } = optsRef.current;
    return Math.min(maxScale, Math.max(minScale, value));
  }, []);

  const animateTo = useCallback(
    (target: ViewTransform, animate: boolean) => {
      const view = viewRef.current;
      if (!animate) {
        view.scale = target.scale;
        view.tx = target.tx;
        view.ty = target.ty;
        animRef.current = null;
        requestFrame();
        return;
      }
      animRef.current = {
        from: { ...view },
        to: target,
        start: performance.now(),
        duration: ANIM_MS,
      };
      inertiaRef.current = null;
      requestFrame();
    },
    [requestFrame],
  );

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number, animate = false) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const view = viewRef.current;
      const next = clampScale(view.scale * factor);
      // Ancla: el punto bajo el dedo se queda donde está.
      const worldX = (px - view.tx) / view.scale;
      const worldY = (py - view.ty) / view.scale;
      animateTo(
        { scale: next, tx: px - worldX * next, ty: py - worldY * next },
        animate,
      );
    },
    [animateTo, clampScale],
  );

  const fitRect = useCallback(
    (
      rect: { minX: number; minY: number; width: number; height: number },
      padding = 28,
      animate = false,
    ) => {
      const el = containerRef.current;
      if (!el) return false;
      const vw = el.clientWidth - padding * 2;
      const vh = el.clientHeight - padding * 2;
      if (vw <= 0 || vh <= 0 || rect.width <= 0 || rect.height <= 0) return false;
      const scale = clampScale(Math.min(vw / rect.width, vh / rect.height));
      const cx = rect.minX + rect.width / 2;
      const cy = rect.minY + rect.height / 2;
      animateTo(
        {
          scale,
          tx: el.clientWidth / 2 - cx * scale,
          ty: el.clientHeight / 2 - cy * scale,
        },
        animate,
      );
      return true;
    },
    [animateTo, clampScale],
  );

  const centerOn = useCallback(
    (worldX: number, worldY: number, scale?: number, animate = true) => {
      const el = containerRef.current;
      if (!el) return;
      const next = clampScale(scale ?? viewRef.current.scale);
      animateTo(
        {
          scale: next,
          tx: el.clientWidth / 2 - worldX * next,
          ty: el.clientHeight / 2 - worldY * next,
        },
        animate,
      );
    },
    [animateTo, clampScale],
  );

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    type Tracked = { x: number; y: number };
    const pointers = new Map<number, Tracked>();
    let panning = false;
    let moved = 0;
    let downAt = 0;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let pinchDist = 0;
    let samples: Array<{ x: number; y: number; t: number }> = [];

    const setPanning = (value: boolean) => {
      if (panning === value) return;
      panning = value;
      optsRef.current.onPanningChange?.(value);
    };

    function midpoint(): Tracked {
      let sx = 0;
      let sy = 0;
      for (const p of pointers.values()) {
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / pointers.size, y: sy / pointers.size };
    }

    function spread(): number {
      const list = [...pointers.values()];
      if (list.length < 2) return 0;
      return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Los controles superpuestos (etiquetas SVG, botones) llevan
      // data-map-control y no deben iniciar un arrastre.
      if ((e.target as Element | null)?.closest?.('[data-map-control]')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture?.(e.pointerId);
      inertiaRef.current = null;
      animRef.current = null;
      downAt = performance.now();
      moved = 0;
      samples = [{ x: e.clientX, y: e.clientY, t: downAt }];
      if (pointers.size === 2) pinchDist = spread();
      if (pointers.size === 1) setPanning(true);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType !== 'touch') optsRef.current.onHover?.(e.clientX, e.clientY);
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      moved += Math.hypot(dx, dy);

      const view = viewRef.current;
      if (pointers.size >= 2) {
        // Pellizco: la escala sale de la razón de distancias y el desplazamiento
        // del punto medio, así el contenido «se queda pegado» a los dos dedos.
        const dist = spread();
        const mid = midpoint();
        const rect = el.getBoundingClientRect();
        const px = mid.x - rect.left;
        const py = mid.y - rect.top;
        if (pinchDist > 0 && dist > 0) {
          const next = clampScale(view.scale * (dist / pinchDist));
          const worldX = (px - view.tx) / view.scale;
          const worldY = (py - view.ty) / view.scale;
          view.scale = next;
          view.tx = px - worldX * next;
          view.ty = py - worldY * next;
        }
        pinchDist = dist;
        // El pan de dos dedos sale del propio reencuadre del punto medio.
        view.tx += dx / 2;
        view.ty += dy / 2;
      } else {
        view.tx += dx;
        view.ty += dy;
        samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (samples.length > 6) samples.shift();
      }
      requestFrame();
    };

    const endPointer = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        pinchDist = 0;
        return;
      }
      if (pointers.size > 0) return;

      setPanning(false);
      const now = performance.now();
      const isTap = moved < TAP_SLOP_PX && now - downAt < TAP_MAX_MS;

      if (isTap) {
        const isDouble =
          now - lastTapAt < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DOUBLE_TAP_SLOP_PX;
        lastTapAt = isDouble ? 0 : now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
        if (isDouble) optsRef.current.onDoubleTap?.(e.clientX, e.clientY);
        else optsRef.current.onTap?.(e.clientX, e.clientY);
        return;
      }

      // Inercia: velocidad media de los últimos ~80 ms, no del último evento
      // suelto (que suele venir con delta 0 y mataría el lanzamiento).
      const recent = samples.filter((s) => now - s.t < 90);
      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = Math.max(last.t - first.t, 1);
        const vx = (last.x - first.x) / dt;
        const vy = (last.y - first.y) / dt;
        if (Math.hypot(vx, vy) > INERTIA_MIN_SPEED) {
          inertiaRef.current = { vx, vy };
          requestFrame();
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpads mandan deltas pequeños y continuos; la rueda, saltos grandes.
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
      zoomBy(factor, e.clientX, e.clientY);
    };

    const onPointerLeave = () => optsRef.current.onHoverEnd?.();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('wheel', onWheel);
    };
  }, [clampScale, requestFrame, zoomBy]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // Identidad estable: el visor mete este objeto en las dependencias de sus
  // handlers, y un literal nuevo por render los recrearía todos sin motivo.
  return useMemo(
    () => ({ containerRef, viewRef, requestFrame, zoomBy, fitRect, centerOn, toWorld }),
    [requestFrame, zoomBy, fitRect, centerOn, toWorld],
  );
}
