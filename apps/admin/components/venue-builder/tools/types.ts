import type {
  InteractionOverlay,
  ScreenPoint,
  SeatMapRenderer,
  WorldPoint,
} from '@boletera/venue-engine/render';
import type { EditorStoreApi } from '../store/editor-store';
import type { HistoryStore } from '../store/history-store';
import type { SnapOutcome } from '../snap/snap-engine';
import type { ToolId } from '../store/types';

export type ToolPointerEvent = {
  screen: ScreenPoint;
  world: WorldPoint;
  pointerId: number;
  button: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  /** CSS-pixel movement since the previous pointer event. */
  deltaScreen: ScreenPoint;
  /** Milliseconds since the previous pointer event (for pan inertia). */
  deltaTimeMs: number;
};

export type ToolContext = {
  renderer: SeatMapRenderer;
  editor: EditorStoreApi;
  history: HistoryStore;
  toWorld: (screen: ScreenPoint) => WorldPoint;
  toScreen: (world: WorldPoint) => ScreenPoint;
  /** Magnetic snap that also publishes guides to the store. */
  snap: (point: WorldPoint) => SnapOutcome;
  clearGuides: () => void;
  /** Merges selection/hover state with tool-owned overlay bits. */
  paintOverlay: (extra: Partial<InteractionOverlay> | null) => void;
  setCursor: (cursor: string) => void;
  /** Live seat previews are only affordable below this scene size. */
  liveDragBudget: number;
};

export type Tool = {
  id: ToolId;
  label: string;
  shortcut: string;
  hint: string;
  cursor: string;
  onPointerDown?: (ctx: ToolContext, event: ToolPointerEvent) => void;
  onPointerMove?: (ctx: ToolContext, event: ToolPointerEvent) => void;
  onPointerUp?: (ctx: ToolContext, event: ToolPointerEvent) => void;
  onDoubleClick?: (ctx: ToolContext, event: ToolPointerEvent) => void;
  onWheel?: (ctx: ToolContext, event: { screen: ScreenPoint; deltaY: number }) => boolean;
  /** Escape or tool change: drop drafts without committing. */
  cancel?: (ctx: ToolContext) => void;
  /** Enter: commit a multi-click draft. */
  commit?: (ctx: ToolContext) => void;
};
