import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma con el pool dimensionado explícitamente (F1-07b).
 *
 * Por defecto Prisma abre `num_cpus * 2 + 1` conexiones — típicamente 9 — y
 * aborta las transacciones interactivas a los 5 s. Con el checkout haciendo
 * trabajo pesado dentro de la transacción, unas decenas de compras concurrentes
 * agotan el pool: a partir de ahí TODA la API (no solo el checkout) espera una
 * conexión libre y acaba devolviendo errores de pool.
 *
 * Regla de dimensionado para el onsale:
 *   PRISMA_CONNECTION_LIMIT * réplicas_api + worker < max_connections de Postgres
 */

const logger = new Logger('PrismaService');

/** Entero positivo desde el entorno, con default si falta o es basura. */
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Añade los parámetros de pool a DATABASE_URL sin pisar los que ya vengan
 * puestos (algunos proveedores gestionados imponen los suyos).
 */
function buildDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const defaults: Record<string, string> = {
      // Conexiones por proceso de API.
      connection_limit: String(envInt('PRISMA_CONNECTION_LIMIT', 20)),
      // Segundos que una consulta espera una conexión libre antes de fallar.
      pool_timeout: String(envInt('PRISMA_POOL_TIMEOUT', 20)),
      // Segundos para abrir la conexión TCP contra Postgres.
      connect_timeout: String(envInt('PRISMA_CONNECT_TIMEOUT', 10)),
    };

    for (const [key, value] of Object.entries(defaults)) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    // URL exótica (p. ej. socket unix): mejor usarla tal cual que romper el arranque.
    logger.warn('DATABASE_URL no es parseable como URL; se usa sin parámetros de pool.');
    return raw;
  }
}

function buildLogOptions() {
  if (process.env.PRISMA_LOG_SLOW_QUERIES !== 'true') {
    return [
      { emit: 'stdout' as const, level: 'warn' as const },
      { emit: 'stdout' as const, level: 'error' as const },
    ];
  }
  return [
    { emit: 'event' as const, level: 'query' as const },
    { emit: 'stdout' as const, level: 'warn' as const },
    { emit: 'stdout' as const, level: 'error' as const },
  ];
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly slowQueryMs = envInt('PRISMA_SLOW_QUERY_MS', 500);

  constructor() {
    super({
      datasourceUrl: buildDatasourceUrl(),
      log: buildLogOptions(),
      transactionOptions: {
        // Espera máxima por una conexión antes de empezar la transacción.
        maxWait: envInt('PRISMA_TRANSACTION_MAX_WAIT', 5_000),
        // Duración máxima de la transacción interactiva. El default de 5 s se
        // agota en cuanto el checkout hace algo de red dentro; se sube, pero no
        // demasiado: una transacción larga mantiene los bloqueos de fila.
        timeout: envInt('PRISMA_TRANSACTION_TIMEOUT', 10_000),
      },
    });
  }

  async onModuleInit() {
    if (process.env.PRISMA_LOG_SLOW_QUERIES === 'true') {
      // El tipado de $on('query') depende del genérico de log del cliente
      // generado; el cast evita acoplar el servicio a esa firma.
      (this as any).$on('query', (event: { duration: number; query: string; params: string }) => {
        if (event.duration < this.slowQueryMs) return;
        logger.warn(`Consulta lenta (${event.duration} ms): ${event.query}`);
      });
    }

    try {
      await this.$connect();
      // $connect es perezoso con algunos adaptadores: una consulta trivial
      // confirma que la base responde de verdad.
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(
        `No hay conexión con PostgreSQL: ${detail}. ` +
          'Revisa DATABASE_URL, que la base acepte conexiones y que max_connections ' +
          'cubra PRISMA_CONNECTION_LIMIT * réplicas.',
      );
      // Fallar aquí evita que el balanceador mande tráfico a una réplica muerta.
      throw error;
    }

    logger.log(
      `PostgreSQL conectado (connection_limit=${envInt('PRISMA_CONNECTION_LIMIT', 20)}, ` +
        `pool_timeout=${envInt('PRISMA_POOL_TIMEOUT', 20)}s, ` +
        `tx_timeout=${envInt('PRISMA_TRANSACTION_TIMEOUT', 10_000)}ms)`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
