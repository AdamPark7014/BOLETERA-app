import { ReadCacheService, CATALOG_TTL_SECONDS } from './read-cache.service';

describe('ReadCacheService', () => {
  it('exporta TTL de cartelera', () => {
    expect(CATALOG_TTL_SECONDS).toBe(20);
  });

  it('etag estable para el mismo payload', () => {
    const redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(true),
      del: jest.fn(),
      acquireLock: jest.fn().mockResolvedValue('ACQUIRED'),
      releaseLock: jest.fn().mockResolvedValue(true),
      isReady: true,
    };
    const cache = new ReadCacheService(redis as never);
    const a = cache.etagFor({ x: 1 });
    const b = cache.etagFor({ x: 1 });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it('singleflight: un solo loader', async () => {
    const redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(true),
      del: jest.fn(),
      acquireLock: jest.fn().mockResolvedValue('ACQUIRED'),
      releaseLock: jest.fn().mockResolvedValue(true),
      isReady: true,
    };
    const cache = new ReadCacheService(redis as never);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true };
    };
    const [a, b] = await Promise.all([
      cache.getOrSet('k1', 10, loader),
      cache.getOrSet('k1', 10, loader),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(calls).toBe(1);
  });
});
