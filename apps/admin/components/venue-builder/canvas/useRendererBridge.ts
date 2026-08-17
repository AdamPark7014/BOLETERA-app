'use client';

import { useEffect } from 'react';
import type {
  ColorModeContext,
  InteractionOverlay,
  SeatMapRenderer,
} from '@boletera/venue-engine/render';
import type { EditorStore, EditorStoreApi } from '../store/editor-store';
import { selectRenderScene, selectSelectionBounds } from '../store/selectors';
import { handlesForRect, sceneBoundsOrDefault } from '../utils/geometry';
import { createIdleCoalescer } from '../utils/chunked';
import type { RendererHandle } from './renderer-context';

export type OverlayComposer = (extra: Partial<InteractionOverlay> | null) => void;

type BridgeOptions = {
  handle: RendererHandle;
  editor: EditorStoreApi;
  /** Filled by the bridge so tools and panels share one overlay composer. */
  overlayExtraRef: { current: Partial<InteractionOverlay> | null };
};

function composeOverlay(
  renderer: SeatMapRenderer,
  state: EditorStore,
  extra: Partial<InteractionOverlay> | null,
): void {
  const overlay: InteractionOverlay = {
    selectedIds: state.selection.seatIds,
    hoverSeatId: state.hoverSeatId,
  };
  if (extra) {
    Object.assign(overlay, extra);
  } else if (state.selection.seatIds.length > 1) {
    const bounds = selectSelectionBounds(state.scene, state.selection.seatIds);
    if (bounds) overlay.handles = handlesForRect(bounds);
  }
  renderer.setInteractionOverlay(overlay);
}

/**
 * Single place where editor state is pushed into the render engine.
 *
 * - `structuralEpoch` → `setScene` (camera preserved unless a fit was requested)
 * - `patchEpoch`      → `updateSeats` (no scene rebuild, no React render)
 * - selection / color → `setColorMode` so the GPU rebakes colors
 * - layers            → `setLayerVisibility` / `setLayerLocked`
 * - validation        → `setAnalysisOverlays`
 */
export function useRendererBridge({ handle, editor, overlayExtraRef }: BridgeOptions): void {
  useEffect(() => {
    if (!handle.ready) return undefined;
    const renderer = handle.ref.current;
    if (!renderer) return undefined;

    const colorContextOf = (state: EditorStore): ColorModeContext => ({
      selectedIds: state.selection.seatIds,
      sightlineBySeatId: state.validation?.sightlineBySeatId ?? undefined,
    });

    const applyScene = (state: EditorStore, fit: boolean) => {
      const camera = renderer.camera.getState();
      renderer.setScene(selectRenderScene(state), {
        colorMode: state.colorMode,
        colorContext: colorContextOf(state),
      });
      if (fit) renderer.camera.fitToBounds(sceneBoundsOrDefault(state.scene), 64, true);
      else renderer.camera.setState(camera, false);
    };

    // Patches keep the SoA buffers correct but leave section aggregates (used by
    // the far-zoom LOD) stale; a coalesced idle rebuild fixes that invisibly.
    const resync = createIdleCoalescer(() => applyScene(editor.getState(), false));

    const applyLayers = (state: EditorStore) => {
      for (const [id, flags] of Object.entries(state.layers)) {
        const layer = id as keyof EditorStore['layers'];
        renderer.setLayerVisibility(layer, flags.visible);
        renderer.setLayerLocked(layer, flags.locked);
      }
    };

    const sync = (state: EditorStore, prev: EditorStore | null) => {
      const structuralChanged = !prev || state.structuralEpoch !== prev.structuralEpoch;
      const fitChanged = !prev || state.fitRequestEpoch !== prev.fitRequestEpoch;

      if (structuralChanged) {
        applyScene(state, fitChanged);
      } else if (prev && state.patchEpoch !== prev.patchEpoch) {
        renderer.updateSeats(state.pendingPatch);
        resync.schedule();
      } else if (fitChanged) {
        renderer.camera.fitToBounds(sceneBoundsOrDefault(state.scene), 64, true);
      }

      if (
        !structuralChanged &&
        prev &&
        (state.colorMode !== prev.colorMode ||
          state.selection.seatIds !== prev.selection.seatIds ||
          state.validation !== prev.validation)
      ) {
        renderer.setColorMode(state.colorMode, colorContextOf(state));
      }

      if (!prev || state.layers !== prev.layers) applyLayers(state);

      if (!prev || state.validation !== prev.validation) {
        renderer.setAnalysisOverlays(state.validation?.overlays ?? []);
      }

      if (
        !prev ||
        state.selection.seatIds !== prev.selection.seatIds ||
        state.hoverSeatId !== prev.hoverSeatId
      ) {
        composeOverlay(renderer, state, overlayExtraRef.current);
      }
    };

    sync(editor.getState(), null);
    const unsubscribe = editor.subscribe(sync);
    return () => {
      resync.cancel();
      unsubscribe();
    };
  }, [handle, editor, overlayExtraRef]);
}

/** Overlay composer usable from tool handlers (no React re-render). */
export function createOverlayPainter(
  handle: RendererHandle,
  editor: EditorStoreApi,
  overlayExtraRef: { current: Partial<InteractionOverlay> | null },
): OverlayComposer {
  return (extra) => {
    overlayExtraRef.current = extra;
    const renderer = handle.ref.current;
    if (!renderer) return;
    composeOverlay(renderer, editor.getState(), extra);
  };
}
