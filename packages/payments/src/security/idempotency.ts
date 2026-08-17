/**
 * In-memory idempotency store (Map + TTL).
 *
 * Used by BanorteProvider.createIntent when `ctx.idempotencyKey` is set so the
 * same key returns the same intent without creating a new charge attempt.
 *
 * Export this helper so apps can wrap it with Redis (or another shared store)
 * in multi-instance deployments — replace `get`/`set`/`getOrCreate` accordingly.
 */

export type IdempotencyEntry<T> = {
  value: T;
  expiresAt: number;
};

export type IdempotencyGuardOptions = {
  /** Entry time-to-live in milliseconds. Default: 24h. */
  ttlMs?: number;
  /** Max entries before opportunistic prune. Default: 10_000. */
  maxEntries?: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

export class IdempotencyGuard<T> {
  private readonly store = new Map<string, IdempotencyEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  /** In-flight factories keyed by idempotency key (dedupe concurrent callers). */
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(options: IdempotencyGuardOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.pruneIfNeeded();
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  size(): number {
    this.pruneExpired();
    return this.store.size;
  }

  /**
   * Return a cached value for `key`, or run `factory` once and cache the result.
   * Concurrent callers for the same key share the same in-flight promise.
   */
  async getOrCreate(
    key: string,
    factory: () => Promise<T>,
  ): Promise<{ value: T; reused: boolean }> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return { value: cached, reused: true };
    }

    const existing = this.inflight.get(key);
    if (existing) {
      const value = await existing;
      return { value, reused: true };
    }

    const pending = (async () => {
      const value = await factory();
      this.set(key, value);
      return value;
    })();

    this.inflight.set(key, pending);
    try {
      const value = await pending;
      return { value, reused: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  private pruneIfNeeded(): void {
    if (this.store.size < this.maxEntries) return;
    this.pruneExpired();
    if (this.store.size < this.maxEntries) return;
    // Drop oldest half when still over capacity (Map iteration is insertion order).
    const drop = Math.ceil(this.store.size / 2);
    let i = 0;
    for (const key of this.store.keys()) {
      if (i++ >= drop) break;
      this.store.delete(key);
    }
  }
}

/** Shared process-local guard for payment intents. Apps may replace with Redis. */
export const paymentIntentIdempotency = new IdempotencyGuard<unknown>();
