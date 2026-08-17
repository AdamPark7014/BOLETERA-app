import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaymentError, withSafeRetry } from '../errors.ts';

describe('withSafeRetry', () => {
  it('retries idempotent get_status with backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await withSafeRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new PaymentError('PROVIDER_ERROR', 'timeout', { retryable: true });
        }
        return 'ok';
      },
      {
        operation: 'get_status',
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1, 2]);
  });

  it('refuses create_intent without idempotencyKey', async () => {
    await assert.rejects(
      () =>
        withSafeRetry(async () => 'nope', {
          operation: 'create_intent',
          maxAttempts: 2,
        }),
      (err: unknown) =>
        PaymentError.isPaymentError(err) && err.code === 'MISSING_IDEMPOTENCY_KEY',
    );
  });

  it('allows create_intent when idempotencyKey is set', async () => {
    let attempts = 0;
    const result = await withSafeRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new PaymentError('PROVIDER_ERROR', 'network', { retryable: true });
        }
        return 'intent';
      },
      {
        operation: 'create_intent',
        idempotencyKey: 'ord-1',
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: async () => undefined,
      },
    );
    assert.equal(result, 'intent');
    assert.equal(attempts, 2);
  });
});
