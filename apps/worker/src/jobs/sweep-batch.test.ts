import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SWEEP_LOCKED, sweepBatch } from './expire-holds.ts';
import type { ExpiredHold, HoldsDb, SweepTx } from '../ports.ts';

/**
 * Doble en memoria de una transacción de Prisma.
 *
 * No ejecuta SQL: registra qué consultas se lanzaron y con qué parámetros. Es
 * suficiente para lo que aquí importa —que el advisory lock corte el barrido y
 * que cada grupo genere su UPDATE— y no exige Postgres, que es la razón por la
 * que este código nunca había tenido una prueba.
 */
type Recorded = { sql: string; values: unknown[] };

function fakeTx(options: { locked: boolean; expired: ExpiredHold[] }) {
  const queries: Recorded[] = [];
  const executed: Recorded[] = [];
  const updateManyCalls: unknown[] = [];
  let queryCall = 0;

  const tx: SweepTx = {
    $queryRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      queries.push({ sql, values });
      queryCall++;
      // La primera consulta es siempre el advisory lock.
      if (queryCall === 1) return [{ locked: options.locked }];
      return options.expired;
    }) as SweepTx['$queryRaw'],

    $executeRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executed.push({ sql: strings.join('?'), values });
      return 0;
    }) as SweepTx['$executeRaw'],

    ticket: {
      updateMany: async (args) => {
        updateManyCalls.push(args);
        return { count: args.where.seatId.in.length };
      },
    },
  };

  const db: HoldsDb = {
    $transaction: async (fn) => fn(tx),
  };

  return { db, queries, executed, updateManyCalls };
}

function hold(partial: Partial<ExpiredHold>): ExpiredHold {
  return { id: 'h', eventId: 'e1', seatId: null, offerId: null, quantity: 1, ...partial };
}

describe('sweepBatch', () => {
  it('sale sin tocar inventario si otra réplica tiene el advisory lock', async () => {
    const { db, queries, executed, updateManyCalls } = fakeTx({ locked: false, expired: [] });

    const result = await sweepBatch(db, 500);

    assert.equal(result, SWEEP_LOCKED);
    assert.equal(queries.length, 1, 'sólo se pide el lock; no se toca SeatHold');
    assert.equal(executed.length, 0);
    assert.equal(updateManyCalls.length, 0);
  });

  it('devuelve 0 y no lanza UPDATEs cuando no hay holds vencidos', async () => {
    const { db, executed, updateManyCalls } = fakeTx({ locked: true, expired: [] });

    assert.equal(await sweepBatch(db, 500), 0);
    assert.equal(executed.length, 0);
    assert.equal(updateManyCalls.length, 0);
  });

  it('pasa el tamaño de lote al LIMIT de la consulta de holds', async () => {
    const { db, queries } = fakeTx({ locked: true, expired: [] });

    await sweepBatch(db, 250);

    assert.ok(queries[1].sql.includes('"SeatHold"'));
    assert.ok(
      queries[1].values.includes(250),
      'el LIMIT debe venir parametrizado, no interpolado',
    );
  });

  it('marca los holds como EXPIRED sólo si siguen ACTIVE', async () => {
    const { db, queries } = fakeTx({ locked: true, expired: [] });

    await sweepBatch(db, 500);
    const sweepSql = queries[1].sql;

    assert.ok(sweepSql.includes(`status = 'EXPIRED'`), 'debe marcar EXPIRED');
    assert.ok(sweepSql.includes(`status = 'ACTIVE'`), 'CAS: sólo los que siguen ACTIVE');
    assert.ok(sweepSql.includes('SKIP LOCKED'), 'dos réplicas no pueden llevarse el mismo hold');
  });

  it('devuelve las butacas numeradas a AVAILABLE, una consulta por evento', async () => {
    const { db, updateManyCalls } = fakeTx({
      locked: true,
      expired: [
        hold({ id: 'a', eventId: 'e1', seatId: 's1' }),
        hold({ id: 'b', eventId: 'e1', seatId: 's2' }),
        hold({ id: 'c', eventId: 'e2', seatId: 's3' }),
      ],
    });

    const released = await sweepBatch(db, 500);

    assert.equal(released, 3);
    assert.equal(updateManyCalls.length, 2, 'una consulta por evento, no una por hold');
    assert.deepEqual(updateManyCalls[0], {
      where: { eventId: 'e1', seatId: { in: ['s1', 's2'] }, status: 'HELD' },
      data: { status: 'AVAILABLE' },
    });
  });

  it('libera admisión general por conteo y refresca updatedAt', async () => {
    const { db, executed } = fakeTx({
      locked: true,
      expired: [
        hold({ id: 'a', eventId: 'e1', offerId: 'o1', quantity: 2 }),
        hold({ id: 'b', eventId: 'e1', offerId: 'o1', quantity: 3 }),
      ],
    });

    await sweepBatch(db, 500);

    assert.equal(executed.length, 1, 'los dos holds de la misma oferta van en un UPDATE');
    assert.deepEqual(executed[0].values, ['e1', 'o1', 5], 'debe soltar 2+3 boletos');
    assert.ok(
      executed[0].sql.includes('"updatedAt" = now()'),
      'sin refrescar updatedAt el SSE de disponibilidad no ve la liberación',
    );
    assert.ok(executed[0].sql.includes('ORDER BY "updatedAt" ASC'), 'suelta primero los más viejos');
  });

  it('un hold de admisión general no deja boletos HELD colgados (F1-10)', async () => {
    // La regresión concreta: antes sólo se devolvían los holds con seatId.
    const { db, executed } = fakeTx({
      locked: true,
      expired: [hold({ id: 'a', eventId: 'e1', offerId: 'o1', quantity: 4 })],
    });

    const released = await sweepBatch(db, 500);

    assert.equal(released, 1);
    assert.equal(executed.length, 1, 'el hold sin asiento TAMBIÉN devuelve inventario');
    assert.equal(executed[0].values[2], 4);
  });
});
