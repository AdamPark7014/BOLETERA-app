import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

/**
 * Libera un candado SOLO si el token coincide con el del dueño registrado.
 *
 * F1-15: el `del()` ciego anterior permitía que cualquiera borrara el candado
 * de otro comprador. Escenario real: A toma el asiento, el worker/B hace DEL,
 * C entra y ambos creen tener el mismo asiento. GET+DEL desde Node no sirve
 * (no es atómico); Lua se ejecuta como una única operación en el servidor.
 */
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** INCRBY + EXPIRE atómicos: separados, una caída entre ambos deja la clave eterna. */
const INCR_WITH_TTL_LUA = `
local value = redis.call("incrby", KEYS[1], ARGV[1])
redis.call("expire", KEYS[1], ARGV[2])
return value`;

/** DECRBY con suelo en cero: un contador negativo regalaría cupo infinito. */
const DECR_FLOOR_LUA = `
local value = redis.call("decrby", KEYS[1], ARGV[1])
if value <= 0 then
  redis.call("del", KEYS[1])
  return 0
end
return value`;

/**
 * `ACQUIRED` = el candado es nuestro.
 * `TAKEN`    = otro lo tiene (conflicto real de negocio).
 * `UNAVAILABLE` = Redis no responde; el llamador decide si degrada o falla.
 *
 * Distinguir `TAKEN` de `UNAVAILABLE` es el punto: el booleano anterior los
 * mezclaba y por eso el candado era "best-effort" sin que nadie lo notara.
 */
export type LockOutcome = 'ACQUIRED' | 'TAKEN' | 'UNAVAILABLE';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private lastErrorLoggedAt = 0;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    // node-redis emite 'error' en cada reconexión fallida; sin listener el
    // proceso muere por unhandled 'error' event.
    this.client.on('error', (error: Error) => this.logError(error));
    void this.client.connect().catch((error: Error) => {
      this.logError(error);
      this.logger.warn('Redis no disponible — los holds dependen sólo del CAS en BD');
    });
  }

  private logError(error: Error) {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < 30_000) return; // no inundar el log
    this.lastErrorLoggedAt = now;
    this.logger.error(`Redis: ${error.message}`);
  }

  get isReady(): boolean {
    return this.client.isReady;
  }

  /**
   * Toma un candado exclusivo con token de propiedad (SET NX EX).
   * El token debe conservarse para poder liberarlo con `releaseLock`.
   */
  async acquireLock(key: string, token: string, ttlSeconds: number): Promise<LockOutcome> {
    if (!this.client.isReady) return 'UNAVAILABLE';
    try {
      const result = await this.client.set(key, token, { NX: true, EX: ttlSeconds });
      return result === 'OK' ? 'ACQUIRED' : 'TAKEN';
    } catch (error) {
      this.logError(error as Error);
      return 'UNAVAILABLE';
    }
  }

  /** Borra el candado sólo si seguimos siendo su dueño. Devuelve true si lo borró. */
  async releaseLock(key: string, token: string): Promise<boolean> {
    if (!this.client.isReady) return false;
    try {
      const result = await this.client.eval(RELEASE_LOCK_LUA, {
        keys: [key],
        arguments: [token],
      });
      return Number(result) === 1;
    } catch (error) {
      this.logError(error as Error);
      return false;
    }
  }

  /** Contador con TTL (cupos por sesión). Devuelve el valor tras incrementar, o null si Redis no está. */
  async incrementWithTtl(key: string, amount: number, ttlSeconds: number): Promise<number | null> {
    if (!this.client.isReady) return null;
    try {
      const result = await this.client.eval(INCR_WITH_TTL_LUA, {
        keys: [key],
        arguments: [String(amount), String(ttlSeconds)],
      });
      return Number(result);
    } catch (error) {
      this.logError(error as Error);
      return null;
    }
  }

  /** Decrementa un contador sin bajar de cero. */
  async decrement(key: string, amount: number): Promise<void> {
    if (!this.client.isReady) return;
    try {
      await this.client.eval(DECR_FLOOR_LUA, { keys: [key], arguments: [String(amount)] });
    } catch (error) {
      this.logError(error as Error);
    }
  }

  /** Guarda metadatos serializables con TTL (p. ej. la ficha lateral de un hold). */
  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!this.client.isReady) return false;
    try {
      const result = await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return result === 'OK';
    } catch (error) {
      this.logError(error as Error);
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client.isReady) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logError(error as Error);
      return null;
    }
  }

  /**
   * Borrado sin comprobación de propiedad. NO usar para candados de asiento
   * (usa `releaseLock`); sólo para claves auxiliares que nos pertenecen.
   */
  async del(key: string): Promise<void> {
    if (!this.client.isReady) return;
    try {
      await this.client.del(key);
    } catch (error) {
      this.logError(error as Error);
    }
  }

  /**
   * @deprecated Usa `acquireLock`, que distingue "ocupado" de "Redis caído".
   * Se mantiene para no romper llamadores fuera de este módulo.
   */
  async setHold(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.acquireLock(key, value, ttlSeconds)) === 'ACQUIRED';
  }

  onModuleDestroy() {
    void this.client.quit().catch(() => undefined);
  }
}
