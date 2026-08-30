import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisService } from './common/redis.service';

@Injectable()
export class AppService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getHealth() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const redis: 'up' | 'down' | 'optional' = this.redis.isReady ? 'up' : 'down';

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'boletera-api',
      version: '1.0.0',
      database,
      redis,
      payments: 'BANORTE',
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: DB required; Redis preferred but not fatal for holds-fallback mode. */
  async getReady() {
    const health = await this.getHealth();
    if (health.database !== 'up') {
      throw new ServiceUnavailableException({
        ready: false,
        ...health,
        reason: 'database_unavailable',
      });
    }
    return {
      ready: true,
      ...health,
      redisRequired: false,
      note:
        health.redis === 'down'
          ? 'Redis down — seat holds fall back to DB only'
          : 'All critical dependencies up',
    };
  }

  /**
   * Prometheus text exposition (v1, hand-rolled).
   * Reuses the same probes as /health — no OpenTelemetry stack required.
   */
  async getPrometheusMetrics(): Promise<string> {
    const health = await this.getHealth();
    const dbReady = health.database === 'up' ? 1 : 0;
    const redisReady = health.redis === 'up' ? 1 : 0;
    const lines = [
      '# HELP boletera_up 1 if the API process is serving this scrape',
      '# TYPE boletera_up gauge',
      'boletera_up 1',
      '# HELP boletera_db_ready 1 if Postgres answers SELECT 1',
      '# TYPE boletera_db_ready gauge',
      `boletera_db_ready ${dbReady}`,
      '# HELP boletera_redis_ready 1 if Redis client reports ready',
      '# TYPE boletera_redis_ready gauge',
      `boletera_redis_ready ${redisReady}`,
      '',
    ];
    return lines.join('\n');
  }
}
