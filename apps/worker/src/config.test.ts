import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_SWEEP_BATCH,
  DEFAULT_SWEEP_MAX_ROUNDS,
  loadConfig,
} from './config.ts';

describe('loadConfig', () => {
  it('usa los valores por defecto con el entorno vacío', () => {
    const config = loadConfig({});

    assert.equal(config.intervalMs, DEFAULT_INTERVAL_MS);
    assert.equal(config.sweepBatch, DEFAULT_SWEEP_BATCH);
    assert.equal(config.sweepMaxRounds, DEFAULT_SWEEP_MAX_ROUNDS);
    assert.equal(config.autoPayout, false);
    assert.equal(config.apiInternalUrl, 'http://localhost:4000/api/v1');
  });

  it('lee los tamaños de lote del entorno', () => {
    const config = loadConfig({ WORKER_SWEEP_BATCH: '250', WORKER_SWEEP_MAX_ROUNDS: '5' });

    assert.equal(config.sweepBatch, 250);
    assert.equal(config.sweepMaxRounds, 5);
  });

  it('un número basura NO se convierte en NaN', () => {
    // `Number('abc')` daba NaN y el `LIMIT NaN` reventaba el barrido en cada tick.
    const config = loadConfig({ WORKER_SWEEP_BATCH: 'abc' });

    assert.equal(config.sweepBatch, DEFAULT_SWEEP_BATCH);
  });

  it('un lote de 0 o negativo cae al valor por defecto', () => {
    // Un LIMIT 0 barre para siempre sin liberar un solo hold.
    assert.equal(loadConfig({ WORKER_SWEEP_BATCH: '0' }).sweepBatch, DEFAULT_SWEEP_BATCH);
    assert.equal(loadConfig({ WORKER_SWEEP_BATCH: '-10' }).sweepBatch, DEFAULT_SWEEP_BATCH);
  });

  it('WORKER_AUTO_PAYOUT sólo se activa con la cadena exacta "true"', () => {
    assert.equal(loadConfig({ WORKER_AUTO_PAYOUT: 'true' }).autoPayout, true);
    assert.equal(loadConfig({ WORKER_AUTO_PAYOUT: '1' }).autoPayout, false);
    assert.equal(loadConfig({ WORKER_AUTO_PAYOUT: 'TRUE' }).autoPayout, false);
  });

  it('prefiere INTERNAL_API_SECRET sobre JWT_SECRET', () => {
    const config = loadConfig({ INTERNAL_API_SECRET: 'interno', JWT_SECRET: 'sesiones' });

    assert.equal(config.internalSecret, 'interno');
  });

  it('cae a JWT_SECRET cuando no hay secreto interno', () => {
    assert.equal(loadConfig({ JWT_SECRET: 'sesiones' }).internalSecret, 'sesiones');
  });
});
