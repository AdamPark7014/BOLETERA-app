'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { SeatMapData } from '@boletera/shared';
import { createEditorStore, type EditorStore, type EditorStoreApi } from './editor-store';
import { createHistoryStore, type HistoryStore, type HistoryStoreApi } from './history-store';

export type VenueBuilderStores = {
  editor: EditorStoreApi;
  history: HistoryStoreApi;
};

export function createVenueBuilderStores(initial: SeatMapData): VenueBuilderStores {
  const editor = createEditorStore(initial);
  return { editor, history: createHistoryStore(editor) };
}

const StoresContext = createContext<VenueBuilderStores | null>(null);

export function VenueBuilderStoreProvider({
  stores,
  children,
}: {
  stores: VenueBuilderStores;
  children: ReactNode;
}) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
}

export function useVenueBuilderStores(): VenueBuilderStores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error('useVenueBuilderStores must be used inside VenueBuilderStoreProvider');
  return stores;
}

/** Subscribe to a slice of editor state. */
export function useEditor<U>(selector: (state: EditorStore) => U): U {
  const { editor } = useVenueBuilderStores();
  return useStore(editor, selector);
}

/** Subscribe to an object slice without re-rendering on identity churn. */
export function useEditorShallow<U>(selector: (state: EditorStore) => U): U {
  const { editor } = useVenueBuilderStores();
  return useStore(editor, useShallow(selector));
}

export function useHistory<U>(selector: (state: HistoryStore) => U): U {
  const { history } = useVenueBuilderStores();
  return useStore(history, selector);
}

/** Imperative access for event handlers and tools (no subscription). */
export function useEditorActions() {
  const { editor } = useVenueBuilderStores();
  return editor.getState;
}

/**
 * Stable bundle handed to transform / bulk operations. History actions never
 * change identity, so this never invalidates memoized panels.
 */
export function useOpsContext(): { editor: EditorStoreApi; history: HistoryStore } {
  const { editor, history } = useVenueBuilderStores();
  return useMemo(() => ({ editor, history: history.getState() }), [editor, history]);
}
