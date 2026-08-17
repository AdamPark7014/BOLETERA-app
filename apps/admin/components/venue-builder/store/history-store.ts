import { create } from 'zustand';
import type { EditorStoreApi } from './editor-store';
import type { EditorCommand } from './types';

export type HistoryState = {
  past: EditorCommand[];
  future: EditorCommand[];
};

export type HistoryActions = {
  /** Run a command and push it on the undo stack. */
  execute: (command: EditorCommand) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
};

export type HistoryStore = HistoryState & HistoryActions;

/**
 * Unlimited undo/redo built on the command pattern: each command carries the
 * exact data needed to invert itself, so the stack cost is proportional to what
 * changed instead of the size of the venue.
 */
export function createHistoryStore(editor: EditorStoreApi) {
  return create<HistoryStore>((set, get) => ({
    past: [],
    future: [],

    execute: (command) => {
      const { scene, commit } = editor.getState();
      commit(command.apply(scene));
      set((state) => ({ past: [...state.past, command], future: [] }));
    },

    undo: () => {
      const { past } = get();
      const command = past[past.length - 1];
      if (!command) return;
      const { scene, commit } = editor.getState();
      commit(command.revert(scene));
      set((state) => ({
        past: state.past.slice(0, -1),
        future: [command, ...state.future],
      }));
    },

    redo: () => {
      const [command] = get().future;
      if (!command) return;
      const { scene, commit } = editor.getState();
      commit(command.apply(scene));
      set((state) => ({
        past: [...state.past, command],
        future: state.future.slice(1),
      }));
    },

    reset: () => set({ past: [], future: [] }),
  }));
}

export type HistoryStoreApi = ReturnType<typeof createHistoryStore>;
