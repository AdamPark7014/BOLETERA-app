import 'dotenv/config';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from project root for development (from apps/worker/src, go up 3 levels to root)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma } from '@boletera/database';

import { loadConfig } from './config';
import { consoleLogger } from './ports';
import type { HoldsDb, PayoutsDb } from './ports';
import { createExpireHoldsJob } from './jobs/expire-holds';
import { createPendingPayoutsJob } from './jobs/pending-payouts';
import { createReconcileSpeiJob } from './jobs/reconcile-spei';
import { startScheduler } from './runner';

/**
 * Arranque del worker: aquí y sólo aquí se conoce el `prisma` real, el reloj
 * del sistema y `process.env`. Los jobs reciben todo eso por parámetro, que es
 * lo que permite probarlos sin base de datos ni esperas reales.
 *
 * Los tres jobs son los que ya corrían antes en un único `index.ts`; lo que
 * cambia es que cada uno vive en su archivo con su test.
 */
const config = loadConfig(process.env);
const logger = consoleLogger;

// `prisma` encaja de forma estructural en los puertos: se acota a lo que cada
// job usa en vez de pasar el cliente entero.
const db = prisma as unknown as HoldsDb & PayoutsDb;

const expireHolds = createExpireHoldsJob({
  db,
  logger,
  batchSize: config.sweepBatch,
  maxRounds: config.sweepMaxRounds,
});

const pendingPayouts = createPendingPayoutsJob({
  db,
  logger,
  autoPayout: config.autoPayout,
});

const reconcileSpei = createReconcileSpeiJob({
  apiInternalUrl: config.apiInternalUrl,
  internalSecret: config.internalSecret,
  logger,
});

logger.info(`Boletera worker started (auto-payout=${config.autoPayout})`);

const scheduler = startScheduler({
  jobs: [expireHolds, pendingPayouts, reconcileSpei],
  // Al arrancar sólo urge soltar holds vencidos; lo demás espera al primer tick.
  immediate: [expireHolds],
  logger,
  intervalMs: config.intervalMs,
});

/**
 * Apagado ordenado: sin esto, `docker compose down` mata el proceso en mitad de
 * una transacción de barrido y deja la conexión colgando hasta que Postgres la
 * expira.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`Boletera worker stopping (${signal})`);
    scheduler.stop();
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
