'use client';

import { memo, useCallback, useEffect, useRef } from 'react';
import type { ScreenPoint } from '@boletera/venue-engine/render';
import { useVenueBuilderStores } from '../store/store-context';
import { useToolRuntime } from '../tools/tool-runtime';
import type { Tool, ToolPointerEvent } from '../tools/types';
import { useRendererHandle } from './renderer-context';
import { useRendererBridge } from './useRendererBridge';
import { VectorOverlay } from './VectorOverlay';
import { BackgroundUnderlayLayer } from './BackgroundUnderlayLayer';
import styles from '../VenueBuilder.module.scss';

const WHEEL_ZOOM_STEP = 1.12;

/**
 * Owns the canvas element, the renderer lifecycle and every pointer/wheel
 * gesture. Nothing inside re-renders while the user works: gestures go straight
 * to the active tool module, which talks to the engine.
 */
export const CanvasHost = memo(function CanvasHost() {
  const { editor } = useVenueBuilderStores();
  const handle = useRendererHandle();
  const runtime = useToolRuntime();
  const lastPointerRef = useRef<{ screen: ScreenPoint; time: number } | null>(null);
  const panOverrideRef = useRef(false);

  useRendererBridge({ handle, editor, overlayExtraRef: runtime.overlayExtraRef });

  const currentTool = useCallback((): Tool | null => {
    if (panOverrideRef.current) return runtime.tools.pan;
    return runtime.activeTool();
  }, [runtime]);

  const buildEvent = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): ToolPointerEvent | null => {
      const renderer = handle.ref.current;
      if (!renderer) return null;
      const screen = runtime.toHostPoint(event);
      const previous = lastPointerRef.current;
      const now = performance.now();
      lastPointerRef.current = { screen, time: now };
      return {
        screen,
        world: renderer.camera.screenToWorld(screen),
        pointerId: event.pointerId,
        button: event.button,
        buttons: event.buttons,
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        deltaScreen: previous
          ? { x: screen.x - previous.screen.x, y: screen.y - previous.screen.y }
          : { x: 0, y: 0 },
        deltaTimeMs: previous ? Math.max(1, now - previous.time) : 16,
      };
    },
    [handle, runtime],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const ctx = runtime.getContext();
      if (!ctx) return;
      if (event.button === 1) panOverrideRef.current = true;
      lastPointerRef.current = null;
      const toolEvent = buildEvent(event);
      if (!toolEvent) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      currentTool()?.onPointerDown?.(ctx, toolEvent);
    },
    [runtime, buildEvent, currentTool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const ctx = runtime.getContext();
      if (!ctx) return;
      const toolEvent = buildEvent(event);
      if (!toolEvent) return;
      currentTool()?.onPointerMove?.(ctx, toolEvent);
    },
    [runtime, buildEvent, currentTool],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const ctx = runtime.getContext();
      const toolEvent = buildEvent(event);
      if (ctx && toolEvent) currentTool()?.onPointerUp?.(ctx, toolEvent);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      panOverrideRef.current = false;
      lastPointerRef.current = null;
    },
    [runtime, buildEvent, currentTool],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const ctx = runtime.getContext();
      const renderer = handle.ref.current;
      if (!ctx || !renderer) return;
      const screen = runtime.toHostPoint(event);
      currentTool()?.onDoubleClick?.(ctx, {
        screen,
        world: renderer.camera.screenToWorld(screen),
        pointerId: 0,
        button: 0,
        buttons: 0,
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        deltaScreen: { x: 0, y: 0 },
        deltaTimeMs: 16,
      });
    },
    [runtime, handle, currentTool],
  );

  // Wheel must be non-passive so the page does not scroll while zooming.
  useEffect(() => {
    const host = runtime.hostRef.current;
    if (!host || !handle.ready) return undefined;
    const onWheel = (event: WheelEvent) => {
      const renderer = handle.ref.current;
      if (!renderer) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      if (event.shiftKey) {
        renderer.camera.panByScreen(-event.deltaY, 0);
        return;
      }
      renderer.camera.zoomAtScreen(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP,
      );
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [handle, runtime]);

  // Cursor follows the active tool without a React render.
  useEffect(() => {
    const apply = () => {
      const host = runtime.hostRef.current;
      if (!host) return;
      host.style.cursor = runtime.tools[editor.getState().tool]?.cursor ?? 'default';
    };
    apply();
    return editor.subscribe((state, prev) => {
      if (state.tool !== prev.tool) apply();
    });
  }, [editor, runtime]);

  return (
    <div
      ref={runtime.hostRef}
      className={styles.canvasHost}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="application"
      aria-label="Lienzo del editor de mapas"
    >
      <BackgroundUnderlayLayer rendererRef={handle.ref} ready={handle.ready} />
      <CanvasSurface />
      <VectorOverlay rendererRef={handle.ref} ready={handle.ready} />
    </div>
  );
});

/**
 * The canvas node identity stays stable for the whole session. Lifecycle of the
 * SeatMapRenderer itself (construct / destroy) is owned by VenueBuilder; this
 * surface only mounts the already-created instance onto the DOM node.
 */
const CanvasSurface = memo(function CanvasSurface() {
  const handle = useRendererHandle();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = handle.ref.current;
    if (!canvas || !renderer || !handle.ready) return undefined;
    renderer.mount(canvas);
    return undefined;
  }, [handle]);

  return <canvas ref={canvasRef} className={styles.canvas} />;
});
