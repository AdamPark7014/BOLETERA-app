import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from './redis.service';

/** Cartelera / ficha / facetas: TTL corto con stale vía Cache-Control en el controller. */
export const CATALOG_TTL_SECONDS = 20;
/** Disponibilidad: se invalida al vender; TTL corto de respaldo. */
export const AVAILABILITY_TTL_SECONDS = 5;

/**
 * Caché de lectura en Redis con un solo recálculo por llave (anti-estampida).
 * Si Redis no está, el loader corre en cada petición (degrada sin tumbar).
 */
@Injectable()
export class ReadCacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.redis.getJson<T>(key);
    if (cached !== null && cached !== undefined) return cached;

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const run = this.loadWithLock(key, ttlSeconds, loader).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  private async loadWithLock<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const lockKey = `${key}:sf`;
    const token = randomBytes(8).toString('hex');
    const outcome = await this.redis.acquireLock(lockKey, token, 5);

    if (outcome === 'TAKEN') {
      const filled = await this.waitForCache<T>(key, 800);
      if (filled !== null && filled !== undefined) return filled;
      return loader();
    }

    try {
      const again = await this.redis.getJson<T>(key);
      if (again !== null && again !== undefined) return again;
      const value = await loader();
      await this.redis.setJson(key, value, ttlSeconds);
      return value;
    } finally {
      if (outcome === 'ACQUIRED') await this.redis.releaseLock(lockKey, token);
    }
  }

  private async waitForCache<T>(key: string, budgetMs: number): Promise<T | null> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const hit = await this.redis.getJson<T>(key);
      if (hit !== null && hit !== undefined) return hit;
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async invalidateMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.redis.del(k)));
  }

  etagFor(payload: unknown): string {
    return createHash('sha1').update(JSON.stringify(payload)).digest('base64url').slice(0, 20);
  }

  catalogListKey(orgId: string, fingerprint: string): string {
    return `cache:discovery:events:${orgId}:${fingerprint}`;
  }

  catalogSlugKey(orgId: string, slug: string): string {
    return `cache:discovery:slug:${orgId}:${slug}`;
  }

  facetsKey(orgId: string): string {
    return `cache:discovery:facets:${orgId}`;
  }

  availabilityKey(eventId: string): string {
    return `cache:availability:${eventId}`;
  }

  /** Tras vender o editar el evento: limpia ficha y disponibilidad. */
  async invalidateEvent(orgId: string, eventId: string, slug?: string): Promise<void> {
    const keys = [this.availabilityKey(eventId), this.facetsKey(orgId)];
    if (slug) keys.push(this.catalogSlugKey(orgId, slug));
    await this.invalidateMany(keys);
  }
}
