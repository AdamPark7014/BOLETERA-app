'use client';

import { useEffect } from 'react';
import type { SeatMapSeat, SeatMapSection } from '@boletera/shared';
import type { ColorMode } from '@boletera/venue-engine/render';
import { useRendererHandle } from '../canvas/renderer-context';
import { addSeatsBatchCommand, addSectionsCommand, type SeatBatch } from '../store/commands';
import { useVenueBuilderStores } from '../store/store-context';
import { selectSeatIndex } from '../store/selectors';
import type { ToolId } from '../store/types';
import { useToolRuntime } from '../tools/tool-runtime';
import {
  deleteSelection,
  duplicateSelection,
  editableSelection,
  groupSelection,
  moveSelection,
  rotateSelection,
  scaleSelection,
  ungroupSection,
  type TransformContext,
} from '../transform/transform-ops';
import { sceneBoundsOrDefault } from '../utils/geometry';
import { slugify, uid } from '../utils/ids';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'pan',
  z: 'zoom',
  s: 'draw-section',
  r: 'draw-row',
  a: 'draw-seat',
  f: 'place-furniture',
  g: 'place-stage',
  m: 'measure',
  n: 'annotate',
};

const COLOR_KEYS: Record<string, ColorMode> = {
  '1': 'zone',
  '2': 'tier',
  '3': 'price',
  '4': 'status',
  '5': 'sightline',
};

const PASTE_OFFSET = 24;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function copySelection(ctx: TransformContext): void {
  const seats = editableSelection(ctx);
  if (seats.length === 0) return;
  const bySection = new Map<string, { section: SeatMapSection; seats: SeatMapSeat[] }>();
  let minX = Infinity;
  let minY = Infinity;
  for (const { seat, section } of seats) {
    minX = Math.min(minX, seat.x);
    minY = Math.min(minY, seat.y);
    const bucket = bySection.get(section.id);
    if (bucket) bucket.seats.push(seat);
    else bySection.set(section.id, { section, seats: [seat] });
  }
  ctx.editor.getState().setClipboard({
    origin: { x: minX, y: minY },
    sections: [...bySection.values()].map(({ section, seats: picked }) => ({
      ...section,
      seats: picked,
    })),
  });
}

function pasteClipboard(ctx: TransformContext): void {
  const state = ctx.editor.getState();
  const clipboard = state.clipboard;
  if (!clipboard) return;

  const stamp = uid('paste');
  const existing = new Set(state.scene.sections.map((section) => section.id));
  const batches: SeatBatch[] = [];
  const created: SeatMapSection[] = [];
  const pastedIds: string[] = [];

  for (const source of clipboard.sections) {
    const seats = source.seats.map((seat, i) => {
      const x = seat.x + PASTE_OFFSET;
      const y = seat.y + PASTE_OFFSET;
      const clone: SeatMapSeat = { ...seat, id: `${seat.id}-${stamp}-${i}`, x, y };
      if (seat.position) clone.position = { ...seat.position, x, z: y };
      if (seat.coord3d) clone.coord3d = { ...seat.coord3d, x, z: y };
      pastedIds.push(clone.id);
      return clone;
    });
    if (existing.has(source.id)) {
      batches.push({ sectionId: source.id, seats });
    } else {
      const name = `${source.name} (copia)`;
      created.push({ ...source, id: uid('section'), name, slug: slugify(name), seats });
    }
  }

  if (created.length > 0) ctx.history.execute(addSectionsCommand('Pegar zonas', created));
  if (batches.length > 0) {
    ctx.history.execute(addSeatsBatchCommand(`Pegar ${pastedIds.length} asientos`, batches));
  }
  if (pastedIds.length > 0) ctx.editor.getState().selectSeats(pastedIds, 'replace');
}

export function useKeyboardShortcuts(onSave: () => void): void {
  const stores = useVenueBuilderStores();
  const runtime = useToolRuntime();
  const handle = useRendererHandle();

  useEffect(() => {
    const ctx: TransformContext = { editor: stores.editor, history: stores.history.getState() };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const state = stores.editor.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;
      const lower = key.toLowerCase();

      if (key === ' ' && !event.repeat) {
        event.preventDefault();
        state.beginTransientTool('pan');
        return;
      }

      if (mod) {
        switch (lower) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) stores.history.getState().redo();
            else stores.history.getState().undo();
            return;
          case 'y':
            event.preventDefault();
            stores.history.getState().redo();
            return;
          case 'd':
            event.preventDefault();
            duplicateSelection(ctx, { x: PASTE_OFFSET, y: PASTE_OFFSET });
            return;
          case 'c':
            event.preventDefault();
            copySelection(ctx);
            return;
          case 'x':
            event.preventDefault();
            copySelection(ctx);
            deleteSelection(ctx);
            return;
          case 'v':
            event.preventDefault();
            pasteClipboard(ctx);
            return;
          case 'a': {
            event.preventDefault();
            const all: string[] = [];
            for (const section of state.scene.sections) {
              if (section.locked) continue;
              for (const seat of section.seats) all.push(seat.id);
            }
            state.selectSeats(all, 'replace');
            return;
          }
          case 'g':
            event.preventDefault();
            if (event.shiftKey) {
              const index = selectSeatIndex(state.scene);
              const first = state.selection.seatIds
                .map((id) => index.get(id)?.section.id)
                .find((id): id is string => Boolean(id));
              const target = first ?? state.activeSectionId;
              if (target) ungroupSection(ctx, target);
            } else {
              groupSelection(ctx);
            }
            return;
          case 's':
            event.preventDefault();
            onSave();
            return;
          case '.': {
            event.preventDefault();
            const hide = state.leftPanelOpen || state.rightPanelOpen;
            state.setLeftPanelOpen(!hide);
            state.setRightPanelOpen(!hide);
            return;
          }
          default:
            return;
        }
      }

      if (key === 'Escape') {
        const toolCtx = runtime.getContext();
        if (toolCtx) runtime.activeTool()?.cancel?.(toolCtx);
        state.clearSelection();
        state.setShortcutsOpen(false);
        return;
      }

      if (key === 'Enter') {
        const toolCtx = runtime.getContext();
        if (toolCtx) runtime.activeTool()?.commit?.(toolCtx);
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        deleteSelection(ctx);
        return;
      }

      if (key === '?') {
        state.setShortcutsOpen(!state.shortcutsOpen);
        return;
      }

      const step = (state.snapEnabled ? state.snapPitch : 1) * (event.shiftKey ? 10 : 1);
      if (key === 'ArrowLeft') {
        event.preventDefault();
        moveSelection(ctx, -step, 0);
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        moveSelection(ctx, step, 0);
        return;
      }
      if (key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(ctx, 0, -step);
        return;
      }
      if (key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(ctx, 0, step);
        return;
      }

      if (key === '[') {
        if (event.shiftKey) scaleSelection(ctx, 0.9, 0.9);
        else rotateSelection(ctx, -15);
        return;
      }
      if (key === ']') {
        if (event.shiftKey) scaleSelection(ctx, 1.1, 1.1);
        else rotateSelection(ctx, 15);
        return;
      }

      const renderer = handle.ref.current;
      if (renderer) {
        if (key === '+' || key === '=') {
          renderer.camera.zoomAtScreen(
            { x: renderer.camera.width / 2, y: renderer.camera.height / 2 },
            1.25,
            true,
          );
          return;
        }
        if (key === '-' || key === '_') {
          renderer.camera.zoomAtScreen(
            { x: renderer.camera.width / 2, y: renderer.camera.height / 2 },
            1 / 1.25,
            true,
          );
          return;
        }
        if (key === '0') {
          renderer.camera.fitToBounds(sceneBoundsOrDefault(state.scene), 64, true);
          return;
        }
      }

      const colorMode = COLOR_KEYS[key];
      if (colorMode) {
        state.setColorMode(colorMode);
        return;
      }

      const tool = TOOL_KEYS[lower];
      if (tool) state.setTool(tool);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') stores.editor.getState().endTransientTool();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [stores, runtime, handle, onSave]);
}
