import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runSafely, runTick, startScheduler } from './runner.ts';
import type { Job, Logger } from './ports.ts';

function fakeLogger(): Logger & { infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return { infos, errors, info: (m) => infos.push(m), error: (m) => errors.push(m) };
}

function job(name: string, run: () => Promise<void>): Job {
  return { name, run };
}

describe('runSafely', () => {
  it('deja el fallo en el log con el nombre de la tarea', async () => {
    const logger = fakeLogger();

    await runSafely(
      job('reconcileBanorteSpei', async () => {
        throw new Error('socket hang up');
      }),
      logger,
    );

    assert.deepEqual(logger.errors, ['Worker task reconcileBanorteSpei failed: socket hang up']);
  });

  it('no propaga el error', async () => {
    await runSafely(
      job('boom', async () => {
        throw new Error('x');
      }),
      fakeLogger(),
    );
    // Llegar aquí ya es la aserción.
    assert.ok(true);
  });
});

describe('runTick', () => {
  it('ejecuta todas las tareas del tick', async () => {
    const order: string[] = [];
    await runTick(
      [
        job('a', async () => void order.push('a')),
        job('b', async () => void order.push('b')),
        job('c', async () => void order.push('c')),
      ],
      fakeLogger(),
    );

    assert.deepEqual(order, ['a', 'b', 'c']);
  });

  it('una tarea que revienta NO impide que corran las siguientes', async () => {
    // Es la regla del worker: un fallo de SPEI no puede dejar de liberar holds,
    // porque holds sin liberar es inventario que no se vende.
    const order: string[] = [];
    const logger = fakeLogger();

    await runTick(
      [
        job('spei', async () => {
          throw new Error('API caído');
        }),
        job('holds', async () => void order.push('holds')),
      ],
      logger,
    );

    assert.deepEqual(order, ['holds']);
    assert.equal(logger.errors.length, 1);
  });

  it('aísla cada tarea por separado cuando fallan varias', async () => {
    const logger = fakeLogger();
    const order: string[] = [];

    await runTick(
      [
        job('a', async () => {
          throw new Error('1');
        }),
        job('b', async () => {
          throw new Error('2');
        }),
        job('c', async () => void order.push('c')),
      ],
      logger,
    );

    assert.equal(logger.errors.length, 2);
    assert.deepEqual(order, ['c']);
  });
});

describe('startScheduler', () => {
  /** Reloj de mentira: guarda el callback y lo dispara a mano. */
  function fakeTimers() {
    let tick: (() => void) | undefined;
    let cleared = false;
    return {
      fire: () => tick?.(),
      get cleared() {
        return cleared;
      },
      timers: {
        setInterval: (fn: () => void) => {
          tick = fn;
          return 'handle' as unknown;
        },
        clearInterval: () => {
          cleared = true;
        },
      },
    };
  }

  it('corre los jobs inmediatos sin esperar al primer tick', async () => {
    // Tras un despliegue puede haber holds vencidos desde hace rato; esperar
    // 30 s a soltarlos es inventario retenido sin razón.
    const clock = fakeTimers();
    let ran = 0;

    startScheduler({
      jobs: [],
      immediate: [job('holds', async () => void ran++)],
      logger: fakeLogger(),
      intervalMs: 30_000,
      timers: clock.timers,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ran, 1);
  });

  it('cada tick vuelve a correr todos los jobs', async () => {
    const clock = fakeTimers();
    let ran = 0;

    startScheduler({
      jobs: [job('holds', async () => void ran++)],
      logger: fakeLogger(),
      intervalMs: 30_000,
      timers: clock.timers,
    });

    clock.fire();
    clock.fire();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(ran, 2);
  });

  it('stop() para el reloj', () => {
    const clock = fakeTimers();

    const scheduler = startScheduler({
      jobs: [],
      logger: fakeLogger(),
      intervalMs: 30_000,
      timers: clock.timers,
    });
    scheduler.stop();

    assert.equal(clock.cleared, true);
  });

  it('un job inmediato que falla no impide que arranque el reloj', async () => {
    const clock = fakeTimers();
    const logger = fakeLogger();
    let ticked = 0;

    startScheduler({
      jobs: [job('later', async () => void ticked++)],
      immediate: [
        job('boom', async () => {
          throw new Error('no hay base');
        }),
      ],
      logger,
      intervalMs: 30_000,
      timers: clock.timers,
    });

    await new Promise((resolve) => setImmediate(resolve));
    clock.fire();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(logger.errors.length, 1);
    assert.equal(ticked, 1, 'el worker sigue vivo tras un arranque fallido');
  });
});
