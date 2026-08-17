import type { LayerId, LayerState } from './types';

/** Default painter order — background first, interaction last. */
export const DEFAULT_LAYER_ORDER: readonly LayerId[] = [
  'background',
  'sections',
  'rows',
  'seats',
  'furniture',
  'stage',
  'analysis',
  'guides',
  'grid',
  'interaction',
] as const;

const DEFAULT_Z: Record<LayerId, number> = {
  background: 0,
  sections: 10,
  rows: 20,
  seats: 30,
  furniture: 40,
  stage: 50,
  analysis: 60,
  guides: 70,
  grid: 80,
  interaction: 90,
};

/**
 * Independent visibility + lock per layer.
 * Lock is advisory for the React editor (renderer still draws locked layers).
 */
export class LayerStack {
  private readonly layers = new Map<LayerId, LayerState>();

  constructor() {
    for (const id of DEFAULT_LAYER_ORDER) {
      this.layers.set(id, {
        id,
        zIndex: DEFAULT_Z[id],
        visible: true,
        locked: false,
      });
    }
  }

  get(id: LayerId): LayerState {
    const layer = this.layers.get(id);
    if (!layer) {
      throw new Error(`Unknown layer: ${id}`);
    }
    return layer;
  }

  isVisible(id: LayerId): boolean {
    return this.get(id).visible;
  }

  isLocked(id: LayerId): boolean {
    return this.get(id).locked;
  }

  setVisibility(id: LayerId, visible: boolean): void {
    this.get(id).visible = visible;
  }

  setLocked(id: LayerId, locked: boolean): void {
    this.get(id).locked = locked;
  }

  setZIndex(id: LayerId, zIndex: number): void {
    this.get(id).zIndex = zIndex;
  }

  /** Layers sorted by zIndex ascending (paint order). */
  paintOrder(): LayerState[] {
    return Array.from(this.layers.values()).sort((a, b) => a.zIndex - b.zIndex);
  }

  snapshot(): LayerState[] {
    return this.paintOrder().map((l) => ({ ...l }));
  }
}
