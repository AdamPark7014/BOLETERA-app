import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PAYOUT_SCAN_LIMIT,
  createPendingPayoutsJob,
  reportPendingPayouts,
} from './pending-payouts.ts';
import type { Logger, PayoutsDb } from '../ports.ts';

function fakeLogger(): Logger & { infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return { infos, errors, info: (m) => infos.push(m), error: (m) => errors.push(m) };
}

function fakeDb(rows: Array<{ id: string }>) {
  const calls: Array<{ where: { status: string }; take: number }> = [];
  const db: PayoutsDb = {
    promoterPayout: {
      findMany: async (args) => {
        calls.push(args);
        return rows;
      },
    },
  };
  return { db, calls };
}

describe('reportPendingPayouts', () => {
  it('sólo mira las liquidaciones PENDING y acota el barrido', async () => {
    const { db, calls } = fakeDb([]);

    await reportPendingPayouts({ db, logger: fakeLogger(), autoPayout: false });

    assert.deepEqual(calls[0], { where: { status: 'PENDING' }, take: PAYOUT_SCAN_LIMIT });
  });

  it('no dice nada cuando no hay liquidaciones pendientes', async () => {
    const logger = fakeLogger();
    const { db } = fakeDb([]);

    assert.equal(await reportPendingPayouts({ db, logger, autoPayout: false }), 0);
    assert.deepEqual(logger.infos, []);
  });

  it('avisa de cuántas liquidaciones esperan liquidación manual', async () => {
    const logger = fakeLogger();
    const { db } = fakeDb([{ id: 'p1' }, { id: 'p2' }]);

    assert.equal(await reportPendingPayouts({ db, logger, autoPayout: false }), 2);
    assert.deepEqual(logger.infos, ['Payouts pending (manual settlement required): 2']);
  });

  it('con WORKER_AUTO_PAYOUT activo dice en voz alta que lo está ignorando', async () => {
    // Callarlo haría creer a quien puso la variable que el pago automático corre.
    const logger = fakeLogger();
    const { db } = fakeDb([{ id: 'p1' }]);

    await reportPendingPayouts({ db, logger, autoPayout: true });

    assert.equal(
      logger.infos[0],
      'Payouts pending (manual settlement required): 1 — WORKER_AUTO_PAYOUT ignored until bank rail exists',
    );
  });

  it('JAMÁS marca una liquidación como pagada', async () => {
    // El doble no expone ningún método de escritura: si el job intentara
    // actualizar algo, el test reventaría con "is not a function".
    const logger = fakeLogger();
    const { db } = fakeDb([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const count = await reportPendingPayouts({ db, logger, autoPayout: true });

    assert.equal(count, 3);
    assert.deepEqual(Object.keys(db.promoterPayout), ['findMany'], 'sólo lectura');
  });
});

describe('createPendingPayoutsJob', () => {
  it('conserva el nombre de la tarea que ya existía', () => {
    const { db } = fakeDb([]);
    const job = createPendingPayoutsJob({ db, logger: fakeLogger(), autoPayout: false });

    assert.equal(job.name, 'processPendingPayouts');
  });
});
