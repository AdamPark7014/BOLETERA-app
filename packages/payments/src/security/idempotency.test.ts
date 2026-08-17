import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IdempotencyGuard } from './idempotency.ts';

describe('IdempotencyGuard', () => {
  it('returns the same value for the same key without re-running factory', async () => {
    const guard = new IdempotencyGuard<string>({ ttlMs: 60_000 });
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

  it('dedupes concurrent factories for the same key', async () => {
    const guard = new IdempotencyGuard<number>({ ttlMs: 60_000 });
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

  it('expires entries after TTL', async () => {
    const guard = new IdempotencyGuard<string>({ ttlMs: 15 });
    await guard.getOrCreate('ttl', async () => 'v1');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(guard.get('ttl'), undefined);
    const again = await guard.getOrCreate('ttl', async () => 'v2');
    assert.equal(again.value, 'v2');
    assert.equal(again.reused, false);
  });
});
