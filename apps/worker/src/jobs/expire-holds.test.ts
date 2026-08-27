import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SWEEP_LOCKED,
  createExpireHoldsJob,
  gaKey,
  groupExpiredHolds,
  parseGaKey,
  sweepExpiredHolds,
} from './expire-holds.ts';
import type { ExpiredHold, HoldsDb, Logger } from '../ports.ts';

/** Log de mentira que guarda lo escrito, para afirmar sobre ello. */
function fakeLogger(): Logger & { infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (m) => infos.push(m),
    error: (m) => errors.push(m),
  };
}

/** No se usa: el bucle recibe `runBatch` y nunca llega a la base. */
const noDb = {} as HoldsDb;

function hold(partial: Partial<ExpiredHold>): ExpiredHold {
  return {
    id: 'h1',
    eventId: 'e1',
    seatId: null,
    offerId: null,
    quantity: 1,
    ...partial,
  };
}

describe('groupExpiredHolds', () => {
  it('agrupa los asientos numerados por evento', () => {
    const { seatsByEvent, gaQuantityByOffer } = groupExpiredHolds([
      hold({ id: 'a', eventId: 'e1', seatId: 's1' }),
      hold({ id: 'b', eventId: 'e1', seatId: 's2' }),
      hold({ id: 'c', eventId: 'e2', seatId: 's3' }),
    ]);

    assert.deepEqual(seatsByEvent.get('e1'), ['s1', 's2']);
    assert.deepEqual(seatsByEvent.get('e2'), ['s3']);
    assert.equal(gaQuantityByOffer.size, 0);
  });

  it('suma las cantidades de admisión general por evento+oferta', () => {
    const { gaQuantityByOffer } = groupExpiredHolds([
      hold({ id: 'a', eventId: 'e1', offerId: 'o1', quantity: 2 }),
      hold({ id: 'b', eventId: 'e1', offerId: 'o1', quantity: 3 }),
      hold({ id: 'c', eventId: 'e1', offerId: 'o2', quantity: 4 }),
    ]);

    assert.equal(gaQuantityByOffer.get(gaKey('e1', 'o1')), 5);
    assert.equal(gaQuantityByOffer.get(gaKey('e1', 'o2')), 4);
  });

  it('no mezcla la misma oferta en eventos distintos', () => {
    const { gaQuantityByOffer } = groupExpiredHolds([
      hold({ id: 'a', eventId: 'e1', offerId: 'o1', quantity: 2 }),
      hold({ id: 'b', eventId: 'e2', offerId: 'o1', quantity: 7 }),
    ]);

    assert.equal(gaQuantityByOffer.get(gaKey('e1', 'o1')), 2);
    assert.equal(gaQuantityByOffer.get(gaKey('e2', 'o1')), 7);
  });

  it('un hold de admisión general con cantidad 0 libera 1 boleto, no 0', () => {
    // Contar 0 dejaría el boleto HELD para siempre: fuga de aforo.
    const { gaQuantityByOffer } = groupExpiredHolds([
      hold({ id: 'a', eventId: 'e1', offerId: 'o1', quantity: 0 }),
    ]);

    assert.equal(gaQuantityByOffer.get(gaKey('e1', 'o1')), 1);
  });

  it('el asiento numerado manda sobre la oferta cuando vienen los dos', () => {
    // Si el hold tiene butaca concreta se libera ESA butaca; contarlo además
    // como admisión general liberaría un boleto de más — sobreventa.
    const { seatsByEvent, gaQuantityByOffer } = groupExpiredHolds([
      hold({ id: 'a', eventId: 'e1', seatId: 's1', offerId: 'o1', quantity: 1 }),
    ]);

    assert.deepEqual(seatsByEvent.get('e1'), ['s1']);
    assert.equal(gaQuantityByOffer.size, 0);
  });

  it('ignora un hold sin asiento y sin oferta', () => {
    const { seatsByEvent, gaQuantityByOffer } = groupExpiredHolds([hold({ id: 'a' })]);

    assert.equal(seatsByEvent.size, 0);
    assert.equal(gaQuantityByOffer.size, 0);
  });

  it('gaKey y parseGaKey son inversas', () => {
    assert.deepEqual(parseGaKey(gaKey('evt', 'off')), { eventId: 'evt', offerId: 'off' });
  });
});

describe('sweepExpiredHolds — bucle de lotes', () => {
  it('encadena lotes llenos hasta que llega uno incompleto', async () => {
    const sizes = [10, 10, 4];
    let call = 0;
    const logger = fakeLogger();

    const total = await sweepExpiredHolds({
      db: noDb,
      logger,
      batchSize: 10,
      maxRounds: 20,
      runBatch: async () => sizes[call++],
    });

    assert.equal(total, 24);
    assert.equal(call, 3, 'debe parar en el lote incompleto, no pedir uno más');
    assert.deepEqual(logger.infos, ['Released 24 expired holds']);
  });

  it('respeta el tope de rondas aunque siga habiendo backlog', async () => {
    let call = 0;
    const total = await sweepExpiredHolds({
      db: noDb,
      logger: fakeLogger(),
      batchSize: 10,
      maxRounds: 3,
      runBatch: async () => {
        call++;
        return 10; // backlog infinito
      },
    });

    assert.equal(call, 3, 'un backlog enorme no puede monopolizar el proceso');
    assert.equal(total, 30);
  });

  it('no hace nada si otra réplica tiene el lock', async () => {
    let call = 0;
    const logger = fakeLogger();

    const total = await sweepExpiredHolds({
      db: noDb,
      logger,
      batchSize: 10,
      maxRounds: 20,
      runBatch: async () => {
        call++;
        return SWEEP_LOCKED;
      },
    });

    assert.equal(total, 0);
    assert.equal(call, 1);
    assert.deepEqual(logger.infos, [], 'sin trabajo no se escribe en el log');
  });

  it('para en seco cuando no queda nada pendiente', async () => {
    let call = 0;
    const total = await sweepExpiredHolds({
      db: noDb,
      logger: fakeLogger(),
      batchSize: 10,
      maxRounds: 20,
      runBatch: async () => {
        call++;
        return 0;
      },
    });

    assert.equal(total, 0);
    assert.equal(call, 1);
  });

  it('un lote que revienta corta el barrido y lo deja en el log, sin propagar', async () => {
    const logger = fakeLogger();
    let call = 0;

    const total = await sweepExpiredHolds({
      db: noDb,
      logger,
      batchSize: 10,
      maxRounds: 20,
      runBatch: async () => {
        call++;
        if (call === 2) throw new Error('deadlock detected');
        return 10;
      },
    });

    assert.equal(total, 10, 'lo ya liberado en el primer lote se conserva');
    assert.equal(call, 2);
    assert.deepEqual(logger.errors, ['Hold sweep batch failed: deadlock detected']);
  });
});

describe('createExpireHoldsJob — cerrojo de re-entrada', () => {
  it('un segundo tick mientras el primero corre no duplica el trabajo', async () => {
    let running = 0;
    let maxConcurrent = 0;
    let release: (() => void) | undefined;

    const job = createExpireHoldsJob({
      db: noDb,
      logger: fakeLogger(),
      batchSize: 10,
      maxRounds: 20,
      runBatch: async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        running--;
        return 0;
      },
    });

    const first = job.run();
    await Promise.resolve(); // deja que el primero entre en el barrido
    const second = job.run(); // debe salir de inmediato

    await second;
    assert.equal(running, 1, 'el segundo tick no arrancó un barrido paralelo');

    release?.();
    await first;
    assert.equal(maxConcurrent, 1);
  });

  it('libera el cerrojo aunque el barrido falle', async () => {
    let calls = 0;
    const job = createExpireHoldsJob({
      db: noDb,
      logger: fakeLogger(),
      batchSize: 10,
      maxRounds: 20,
      runBatch: async () => {
        calls++;
        throw new Error('boom');
      },
    });

    await job.run();
    await job.run();

    assert.equal(calls, 2, 'un fallo no puede dejar el barrido bloqueado para siempre');
  });

  it('el job se llama como la tarea que ya existía', () => {
    const job = createExpireHoldsJob({
      db: noDb,
      logger: fakeLogger(),
      batchSize: 1,
      maxRounds: 1,
      runBatch: async () => 0,
    });

    assert.equal(job.name, 'releaseExpiredHolds');
  });
});
