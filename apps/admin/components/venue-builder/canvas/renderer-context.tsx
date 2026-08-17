'use client';

import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { SeatMapRenderer } from '@boletera/venue-engine/render';

export type RendererHandle = {
  /** Stable across renders; `current` is null until the canvas is mounted. */
  ref: RefObject<SeatMapRenderer | null>;
  ready: boolean;
};

const RendererContext = createContext<RendererHandle | null>(null);

export function RendererProvider({
  handle,
  children,
}: {
  handle: RendererHandle;
  children: ReactNode;
}) {
  return <RendererContext.Provider value={handle}>{children}</RendererContext.Provider>;
}

export function useRendererHandle(): RendererHandle {
  const handle = useContext(RendererContext);
  if (!handle) throw new Error('useRendererHandle must be used inside RendererProvider');
  return handle;
}
