/**
 * Payment-intent idempotency (fingerprint/key → response, 24h TTL).
 *
 * Cluster-safe when a Redis-backed `IdempotencyStore` is installed via
 * `configurePaymentIdempotencyStore` (apps/api does this when `REDIS_URL` is set).
 *
 * Default is an in-memory store — ONLY for unit tests and local runs without
 * Redis. It is NOT safe across API replicas (two pods can double-create intents).
 * Do not use the memory fallback in multi-replica production.
 *
 * Concurrent same-key: process-local singleflight + store lock (SET NX) so
 * waiters share one factory result across replicas.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_LOCK_TTL_SECONDS = 30;
const DEFAULT_WAIT_MS = 15_000;
const POLL_MS = 40;

export type IdempotencyEntry<T> = {
  value: T;
  expiresAt: number;
};

/** Opaque string blob + distributed lock. Redis or memory. */
export type IdempotencyStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete?(key: string): Promise<void>;
  /**
   * Exclusive lock for the create path.
   * `unavailable` = backend down — callers must NOT create without coordination.
   */
  tryLock(
    key: string,
    token: string,
    ttlSeconds: number,
  ): Promise<'acquired' | 'taken' | 'unavailable'>;
  unlock(key: string, token: string): Promise<void>;
};

export type IdempotencyGuardOptions = {
  /** Entry time-to-live in milliseconds. Default: 24h. */
  ttlMs?: number;
  /** Max entries before opportunistic prune (memory store only). Default: 10_000. */
  maxEntries?: number;
  /** Override store for this guard (tests). Default: module active store. */
  store?: IdempotencyStore;
  /** How long to wait for another holder to publish. Default: 15s. */
  waitMs?: number;
  /** Lock TTL while factory runs. Default: 30s. */
  lockTtlSeconds?: number;
};

/** Minimal Redis surface — wrap node-redis / ioredis / RedisService. */
export type RedisIdempotencyClient = {
  get(key: string): Promise<string | null>;
  /** SET key value EX ttlSeconds. Return false if Redis is down. */
  setEx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** SET key value NX EX ttlSeconds. */
  setNxEx(key: string, value: string, ttlSeconds: number): Promise<'acquired' | 'taken' | 'unavailable'>;
  /**
   * Delete key only if value matches token (compare-and-del).
   * If omitted, unlock is best-effort DEL.
   */
  compareAndDel?(key: string, token: string): Promise<void>;
  del?(key: string): Promise<void>;
};

let activeStore: IdempotencyStore = createMemoryIdempotencyStore();

/**
 * Install the cluster store (Redis). Call once at API boot when `REDIS_URL` is set.
 * Guards without an explicit `store` option pick this up.
 */
export function configurePaymentIdempotencyStore(store: IdempotencyStore): void {
  activeStore = store;
}

/** Current module store (tests / diagnostics). */
export function getPaymentIdempotencyStore(): IdempotencyStore {
  return activeStore;
}

/** Reset to a fresh in-memory store (unit tests). */
export function resetPaymentIdempotencyStoreForTests(): void {
  activeStore = createMemoryIdempotencyStore();
}

export function createMemoryIdempotencyStore(
  options: { maxEntries?: number } = {},
): IdempotencyStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const data = new Map<string, { value: string; expiresAt: number }>();
  const locks = new Map<string, { token: string; expiresAt: number }>();

  const pruneData = () => {
    const now = Date.now();
    for (const [k, e] of data) {
      if (now > e.expiresAt) data.delete(k);
    }
    if (data.size < maxEntries) return;
    const drop = Math.ceil(data.size / 2);
    let i = 0;
    for (const key of data.keys()) {
      if (i++ >= drop) break;
      data.delete(key);
    }
  };

  return {
    async get(key) {
      const entry = data.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        data.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      pruneData();
      data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async tryLock(key, token, ttlSeconds) {
      const now = Date.now();
      const existing = locks.get(key);
      if (existing && now <= existing.expiresAt && existing.token !== token) {
        return 'taken';
      }
      locks.set(key, { token, expiresAt: now + ttlSeconds * 1000 });
      return 'acquired';
    },
    async unlock(key, token) {
      const existing = locks.get(key);
      if (existing && existing.token === token) locks.delete(key);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

/**
 * Redis-backed store. Keys: `{prefix}v:{key}` (value), `{prefix}lock:{key}` (NX lock).
 */
export function createRedisIdempotencyStore(
  client: RedisIdempotencyClient,
  keyPrefix = 'payments:idemp:',
): IdempotencyStore {
  const valueKey = (key: string) => `${keyPrefix}v:${key}`;
  const lockKey = (key: string) => `${keyPrefix}lock:${key}`;

  return {
    async get(key) {
      return client.get(valueKey(key));
    },
    async set(key, value, ttlSeconds) {
      const ok = await client.setEx(
        valueKey(key),
        value,
        Math.max(1, Math.ceil(ttlSeconds)),
      );
      if (!ok) {
        throw new IdempotencyStoreUnavailableError('Redis SET failed for idempotency value');
      }
    },
    async tryLock(key, token, ttlSeconds) {
      return client.setNxEx(
        lockKey(key),
        token,
        Math.max(1, Math.ceil(ttlSeconds)),
      );
    },
    async unlock(key, token) {
      if (client.compareAndDel) {
        await client.compareAndDel(lockKey(key), token);
        return;
      }
      await client.del?.(lockKey(key));
    },
    async delete(key) {
      await client.del?.(valueKey(key));
    },
  };
}

export class IdempotencyStoreUnavailableError extends Error {
  constructor(message = 'Idempotency store unavailable') {
    super(message);
    this.name = 'IdempotencyStoreUnavailableError';
  }
}

export class IdempotencyGuard<T> {
  private readonly ttlMs: number;
  private readonly waitMs: number;
  private readonly lockTtlSeconds: number;
  private overrideStore?: IdempotencyStore;
  /** In-flight factories keyed by idempotency key (same-process singleflight). */
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(options: IdempotencyGuardOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    this.lockTtlSeconds = options.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
    this.overrideStore = options.store;
  }

  private store(): IdempotencyStore {
    return this.overrideStore ?? activeStore;
  }

  /** Replace store for this guard instance (tests / late wiring). */
  setStore(store: IdempotencyStore): void {
    this.overrideStore = store;
  }

  async get(key: string): Promise<T | undefined> {
    const raw = await this.store().get(key);
    if (raw == null || raw === '') return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    // Allow sub-second TTLs for unit tests; Redis adapter ceils to ≥1s.
    const ttlSeconds = Math.max(this.ttlMs / 1000, 0.001);
    await this.store().set(key, JSON.stringify(value), ttlSeconds);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<void> {
    await this.store().delete?.(key);
  }

  clear(): void {
    this.inflight.clear();
  }

  /**
   * Return a cached value for `key`, or run `factory` once and cache the result.
   * Same-process callers share an in-flight promise; cross-replica callers share
   * a SET NX lock and wait for the published value.
   */
  async getOrCreate(
    key: string,
    factory: () => Promise<T>,
  ): Promise<{ value: T; reused: boolean }> {
    const cached = await this.get(key);
    if (cached !== undefined) {
      return { value: cached, reused: true };
    }

    const existing = this.inflight.get(key);
    if (existing) {
      const value = await existing;
      return { value, reused: true };
    }

    const pending = this.createWithLock(key, factory);
    const shared = pending.then((r) => r.value);
    // Prevent unhandledRejection when factory/lock fails: waiters await `pending`
    // directly; this catch only silences the derived inflight promise.
    void shared.catch(() => undefined);
    this.inflight.set(key, shared);
    try {
      return await pending;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async createWithLock(
    key: string,
    factory: () => Promise<T>,
  ): Promise<{ value: T; reused: boolean }> {
    const store = this.store();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + this.waitMs;

    while (Date.now() <= deadline) {
      const again = await this.get(key);
      if (again !== undefined) {
        return { value: again, reused: true };
      }

      const lock = await store.tryLock(key, token, this.lockTtlSeconds);
      if (lock === 'unavailable') {
        throw new IdempotencyStoreUnavailableError(
          'Idempotency lock unavailable — refusing to create payment intent without cluster coordination',
        );
      }

      if (lock === 'acquired') {
        try {
          const raced = await this.get(key);
          if (raced !== undefined) {
            return { value: raced, reused: true };
          }
          const value = await factory();
          await this.set(key, value);
          return { value, reused: false };
        } finally {
          await store.unlock(key, token);
        }
      }

      // Lock taken: wait for the holder to publish.
      await sleep(POLL_MS);
    }

    throw new IdempotencyStoreUnavailableError(
      `Timed out waiting for idempotent result for key ${key}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared process-local default for payment intents; replace via configurePaymentIdempotencyStore. */
export const paymentIntentIdempotency = new IdempotencyGuard<unknown>();
