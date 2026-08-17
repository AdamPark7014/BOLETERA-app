'use client';

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import type { InteractionOverlay, ScreenPoint } from '@boletera/venue-engine/render';
import { createOverlayPainter } from '../canvas/useRendererBridge';
import { useRendererHandle } from '../canvas/renderer-context';
import { computeSnap } from '../snap/snap-engine';
import { useVenueBuilderStores } from '../store/store-context';
import type { ToolId } from '../store/types';
import { createToolRegistry } from './registry';
import type { Tool, ToolContext } from './types';

/** Live seat previews rebuild the spatial index per frame; cap the scene size. */
const LIVE_DRAG_BUDGET = 20000;

export type ToolRuntime = {
  tools: Record<ToolId, Tool>;
  /** The element that owns pointer events; also where the cursor is set. */
  hostRef: RefObject<HTMLDivElement | null>;
  overlayExtraRef: { current: Partial<InteractionOverlay> | null };
  /** Null until the renderer is mounted. */
  getContext: () => ToolContext | null;
  activeTool: () => Tool | null;
  toHostPoint: (event: { clientX: number; clientY: number }) => ScreenPoint;
};

const ToolRuntimeContext = createContext<ToolRuntime | null>(null);

export function ToolRuntimeProvider({ children }: { children: ReactNode }) {
  const { editor, history } = useVenueBuilderStores();
  const handle = useRendererHandle();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayExtraRef = useRef<Partial<InteractionOverlay> | null>(null);
  const toolsRef = useRef<Record<ToolId, Tool> | null>(null);
  if (!toolsRef.current) toolsRef.current = createToolRegistry();
  const tools = toolsRef.current;

  const runtime = useMemo<ToolRuntime>(() => {
    const toHostPoint = (event: { clientX: number; clientY: number }): ScreenPoint => {
      const host = hostRef.current;
      if (!host) return { x: 0, y: 0 };
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const getContext = (): ToolContext | null => {
      const renderer = handle.ref.current;
      if (!renderer) return null;
      return {
        renderer,
        editor,
        history: history.getState(),
        toWorld: (screen) => renderer.camera.screenToWorld(screen),
        toScreen: (world) => renderer.camera.worldToScreen(world),
        snap: (point) => {
          const state = editor.getState();
          const outcome = computeSnap(renderer, point, {
            enabled: state.snapEnabled,
            pitch: state.snapPitch,
            tolerance: 9 / renderer.camera.zoom,
          });
          state.setGuides(outcome.guides);
          return outcome;
        },
        clearGuides: () => editor.getState().setGuides([]),
        paintOverlay: createOverlayPainter(handle, editor, overlayExtraRef),
        setCursor: (cursor) => {
          if (hostRef.current) hostRef.current.style.cursor = cursor;
        },
        liveDragBudget: LIVE_DRAG_BUDGET,
      };
    };

    return {
      tools,
      hostRef,
      overlayExtraRef,
      getContext,
      activeTool: () => tools[editor.getState().tool] ?? null,
      toHostPoint,
    };
  }, [handle, editor, history, tools]);

  return <ToolRuntimeContext.Provider value={runtime}>{children}</ToolRuntimeContext.Provider>;
}

export function useToolRuntime(): ToolRuntime {
  const runtime = useContext(ToolRuntimeContext);
  if (!runtime) throw new Error('useToolRuntime must be used inside ToolRuntimeProvider');
  return runtime;
}
