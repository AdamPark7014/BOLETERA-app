type IdleDeadline = { timeRemaining: () => number; didTimeout: boolean };
type IdleCallback = (deadline: IdleDeadline) => void;

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: IdleCallback, options?: { timeout: number }) => number;
};

function scheduleIdle(callback: IdleCallback): void {
  if (typeof window === 'undefined') {
    callback({ timeRemaining: () => 8, didTimeout: true });
    return;
  }
  const idleWindow = window as IdleCapableWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(callback, { timeout: 120 });
    return;
  }
  window.setTimeout(() => callback({ timeRemaining: () => 8, didTimeout: false }), 0);
}

/**
 * Run a generator over `items` in idle slices so massive seat generation never
 * blocks the main thread (and therefore never stalls the render loop).
 */
export function runChunked<TIn, TOut>(
  items: readonly TIn[],
  produce: (item: TIn, index: number) => TOut[],
  options?: { onProgress?: (ratio: number) => void; sliceBudgetMs?: number },
): Promise<TOut[]> {
  const budget = options?.sliceBudgetMs ?? 8;
  return new Promise((resolve) => {
    const out: TOut[] = [];
    let cursor = 0;
    const step = (deadline: IdleDeadline) => {
      const started = performance.now();
      while (cursor < items.length) {
        out.push(...produce(items[cursor], cursor));
        cursor += 1;
        const spent = performance.now() - started;
        if (spent > budget || deadline.timeRemaining() <= 1) break;
      }
      options?.onProgress?.(items.length === 0 ? 1 : cursor / items.length);
      if (cursor >= items.length) {
        resolve(out);
        return;
      }
      scheduleIdle(step);
    };
    scheduleIdle(step);
  });
}

/** Move a synchronous burst off the current input frame. */
export function runIdle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    scheduleIdle(() => resolve(work()));
  });
}

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Single deferred callback, coalesced across bursts. */
export function createIdleCoalescer(callback: () => void): {
  schedule: () => void;
  cancel: () => void;
} {
  let scheduled = false;
  let cancelled = false;
  return {
    schedule: () => {
      if (scheduled) return;
      scheduled = true;
      scheduleIdle(() => {
        scheduled = false;
        if (!cancelled) callback();
      });
    },
    cancel: () => {
      cancelled = true;
    },
  };
}
