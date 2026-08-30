import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  configurePaymentIdempotencyStore,
  createRedisIdempotencyStore,
  type RedisIdempotencyClient,
} from '@boletera/payments';
import { RedisService } from '../../common/redis.service';

/**
 * Wires Banorte/Cash intent idempotency to Redis when REDIS_URL is set.
 * Without REDIS_URL the payments package keeps its in-memory store (tests / local).
 */
@Injectable()
export class PaymentIdempotencyWiring implements OnModuleInit {
  private readonly logger = new Logger(PaymentIdempotencyWiring.name);

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    if (!process.env.REDIS_URL) {
      this.logger.warn(
        'REDIS_URL ausente — idempotencia de payment intents en memoria del proceso ' +
          '(no segura entre réplicas de API).',
      );
      return;
    }

    const redis = this.redis;
    const client: RedisIdempotencyClient = {
      get: (key) => redis.get(key),
      setEx: (key, value, ttlSeconds) => redis.setEx(key, value, ttlSeconds),
      setNxEx: async (key, value, ttlSeconds) => {
        const outcome = await redis.acquireLock(key, value, ttlSeconds);
        if (outcome === 'ACQUIRED') return 'acquired';
        if (outcome === 'TAKEN') return 'taken';
        return 'unavailable';
      },
      compareAndDel: async (key, token) => {
        await redis.releaseLock(key, token);
      },
      del: (key) => redis.del(key),
    };

    configurePaymentIdempotencyStore(createRedisIdempotencyStore(client));
    this.logger.log(
      'Idempotencia de payment intents sobre Redis (cluster-safe entre réplicas).',
    );
  }
}
