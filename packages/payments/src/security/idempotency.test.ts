import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  IdempotencyGuard,
  IdempotencyStoreUnavailableError,
  createMemoryIdempotencyStore,
  createRedisIdempotencyStore,
  resetPaymentIdempotencyStoreForTests,
  type IdempotencyStore,
  type RedisIdempotencyClient,
} from './idempotency.ts';

describe('IdempotencyGuard', () => {
  beforeEach(() => {
    resetPaymentIdempotencyStoreForTests();
  });

  it('returns the same value for the same key without re-running factory', async () => {
    const guard = new IdempotencyGuard<string>({
      store: createMemoryIdempotencyStore(),
      ttlMs: 60_000,
    });
    let builds = 0;
    const a = await guard.getOrCreate('k1', async () => {
      builds += 1;
      return 'intent-a';
    });
    const b = await guard.getOrCreate('k1', async () => {
      builds += 1;
      return 'intent-b';
    });
    assert.equal(a.value, 'intent-a');
    assert.equal(a.reused, false);
    assert.equal(b.value, 'intent-a');
    assert.equal(b.reused, true);
    assert.equal(builds, 1);
  });

  it('dedupes concurrent factories for the same key (singleflight)', async () => {
    const guard = new IdempotencyGuard<number>({
      store: createMemoryIdempotencyStore(),
      ttlMs: 60_000,
    });
    let builds = 0;
    const factory = async () => {
      builds += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    };
    const [x, y] = await Promise.all([
      guard.getOrCreate('concurrent', factory),
      guard.getOrCreate('concurrent', factory),
    ]);
    assert.equal(x.value, 42);
    assert.equal(y.value, 42);
    assert.equal(builds, 1);
  });

  it('concurrent same key across guards sharing a store does not double-create', async () => {
    const store = createMemoryIdempotencyStore();
    const a = new IdempotencyGuard<string>({ store, ttlMs: 60_000, waitMs: 5_000 });
    const b = new IdempotencyGuard<string>({ store, ttlMs: 60_000, waitMs: 5_000 });
    let builds = 0;
    const factory = async () => {
      builds += 1;
      await new Promise((r) => setTimeout(r, 40));
      return 'once';
    };
    const [x, y] = await Promise.all([
      a.getOrCreate('shared-key', factory),
      b.getOrCreate('shared-key', factory),
    ]);
    assert.equal(x.value, 'once');
    assert.equal(y.value, 'once');
    assert.equal(builds, 1);
    assert.equal(x.reused || y.reused, true);
  });

  it('expires entries after TTL', async () => {
    const guard = new IdempotencyGuard<string>({
      store: createMemoryIdempotencyStore(),
      ttlMs: 15,
    });
    await guard.getOrCreate('ttl', async () => 'v1');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await guard.get('ttl'), undefined);
    const again = await guard.getOrCreate('ttl', async () => 'v2');
    assert.equal(again.value, 'v2');
    assert.equal(again.reused, false);
  });

  it('throws when the store lock is unavailable (no silent double-create)', async () => {
    const store: IdempotencyStore = {
      async get() {
        return null;
      },
      async set() {},
      async tryLock() {
        return 'unavailable';
      },
      async unlock() {},
    };
    const guard = new IdempotencyGuard<string>({ store, ttlMs: 60_000, waitMs: 200 });
    await assert.rejects(
      () => guard.getOrCreate('x', async () => 'nope'),
      (err: unknown) => err instanceof IdempotencyStoreUnavailableError,
    );
  });

  it('createRedisIdempotencyStore uses fake Redis client for first/second call', async () => {
    const kv = new Map<string, string>();
    const locks = new Map<string, string>();
    const client: RedisIdempotencyClient = {
      async get(key) {
        return kv.get(key) ?? null;
      },
      async setEx(key, value) {
        kv.set(key, value);
        return true;
      },
      async setNxEx(key, value) {
        if (locks.has(key)) return 'taken';
        locks.set(key, value);
        return 'acquired';
      },
      async compareAndDel(key, token) {
        if (locks.get(key) === token) locks.delete(key);
      },
      async del(key) {
        kv.delete(key);
        locks.delete(key);
      },
    };
    const store = createRedisIdempotencyStore(client);
    const guard = new IdempotencyGuard<{ id: string }>({ store, ttlMs: 60_000 });
    let builds = 0;
    const first = await guard.getOrCreate('ord-9', async () => {
      builds += 1;
      return { id: 'intent-1' };
    });
    const second = await guard.getOrCreate('ord-9', async () => {
      builds += 1;
      return { id: 'intent-2' };
    });
    assert.deepEqual(first.value, { id: 'intent-1' });
    assert.deepEqual(second.value, { id: 'intent-1' });
    assert.equal(second.reused, true);
    assert.equal(builds, 1);
  });
});
