import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SPEI_RECONCILE_PATH, createReconcileSpeiJob, reconcileSpei } from './reconcile-spei.ts';
import type { FetchLike } from './reconcile-spei.ts';
import type { Logger } from '../ports.ts';

function fakeLogger(): Logger & { infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return { infos, errors, info: (m) => infos.push(m), error: (m) => errors.push(m) };
}

type Call = { url: string; method?: string; headers?: Record<string, string> };

function recordingFetch(response: {
  ok: boolean;
  body?: unknown;
  throws?: Error;
  jsonThrows?: boolean;
}): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ url, method: init?.method, headers: init?.headers });
    if (response.throws) throw response.throws;
    return {
      ok: response.ok,
      json: async () => {
        if (response.jsonThrows) throw new Error('Unexpected token < in JSON');
        return response.body;
      },
    };
  }) as FetchLike & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

describe('reconcileSpei', () => {
  it('llama al endpoint interno de conciliación con POST', async () => {
    const fetchFn = recordingFetch({ ok: true, body: { checked: 3, completed: 0 } });

    await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      internalSecret: 's3cr3t',
      logger: fakeLogger(),
      fetchFn,
    });

    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].url, `http://api:4000/api/v1${SPEI_RECONCILE_PATH}`);
    assert.equal(fetchFn.calls[0].method, 'POST');
  });

  it('manda el secreto interno en la cabecera X-Internal-Secret', async () => {
    const fetchFn = recordingFetch({ ok: true, body: {} });

    await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      internalSecret: 's3cr3t',
      logger: fakeLogger(),
      fetchFn,
    });

    assert.deepEqual(fetchFn.calls[0].headers, { 'X-Internal-Secret': 's3cr3t' });
  });

  it('sin secreto no inventa una cabecera vacía', async () => {
    const fetchFn = recordingFetch({ ok: true, body: {} });

    await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger: fakeLogger(),
      fetchFn,
    });

    assert.deepEqual(fetchFn.calls[0].headers, {});
  });

  it('registra en el log lo conciliado cuando se completó algo', async () => {
    const logger = fakeLogger();

    await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger,
      fetchFn: recordingFetch({ ok: true, body: { checked: 10, completed: 4 } }),
    });

    assert.deepEqual(logger.infos, ['Banorte SPEI: completed 4/10']);
  });

  it('no ensucia el log cuando no se completó ningún pago', async () => {
    const logger = fakeLogger();

    await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger,
      fetchFn: recordingFetch({ ok: true, body: { checked: 10, completed: 0 } }),
    });

    assert.deepEqual(logger.infos, [], 'un tick cada 30 s no puede escribir siempre');
  });

  it('el API caído devuelve null y NO revienta el tick', async () => {
    const logger = fakeLogger();

    const result = await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger,
      fetchFn: recordingFetch({ ok: false, throws: new Error('ECONNREFUSED') }),
    });

    assert.equal(result, null);
    assert.deepEqual(logger.errors, [], 'el API aún arrancando no es un error operativo');
  });

  it('una respuesta no-2xx se trata como no conciliado', async () => {
    const result = await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger: fakeLogger(),
      fetchFn: recordingFetch({ ok: false, body: { completed: 99 } }),
    });

    assert.equal(result, null, 'un 500 con cuerpo no puede contarse como conciliación');
  });

  it('un 200 con cuerpo ilegible no propaga la excepción', async () => {
    const result = await reconcileSpei({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger: fakeLogger(),
      fetchFn: recordingFetch({ ok: true, jsonThrows: true }),
    });

    assert.equal(result, null);
  });
});

describe('createReconcileSpeiJob', () => {
  it('conserva el nombre de la tarea que ya existía', () => {
    const job = createReconcileSpeiJob({
      apiInternalUrl: 'http://api:4000/api/v1',
      logger: fakeLogger(),
      fetchFn: recordingFetch({ ok: true, body: {} }),
    });

    assert.equal(job.name, 'reconcileBanorteSpei');
  });
});
