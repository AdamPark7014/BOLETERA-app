import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  parseBanorteStatusText,
  verifyBanorteWebhookSignature,
} from './webhook.ts';

describe('verifyBanorteWebhookSignature', () => {
  it('accepts a valid HMAC with timing-safe compare', () => {
    const body = '{"status":"approved"}';
    const secret = 'whsec_test';
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    assert.equal(verifyBanorteWebhookSignature(body, sig, secret), true);
    assert.equal(verifyBanorteWebhookSignature(body, sig.toUpperCase(), secret), true);
  });

  it('rejects wrong signature and missing signature when secret is set', () => {
    const body = '{"status":"approved"}';
    const secret = 'whsec_test';
    assert.equal(verifyBanorteWebhookSignature(body, 'deadbeef', secret), false);
    assert.equal(verifyBanorteWebhookSignature(body, undefined, secret), false);
    assert.equal(verifyBanorteWebhookSignature(body, 'ab', secret), false);
  });

  it('soft-allows missing secret outside production only', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      assert.equal(verifyBanorteWebhookSignature('{}', undefined, ''), true);

      process.env.NODE_ENV = 'production';
      assert.equal(verifyBanorteWebhookSignature('{}', undefined, ''), false);
      assert.equal(verifyBanorteWebhookSignature('{}', 'anything', ''), false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('parseBanorteStatusText', () => {
  it('covers declined / cancelled / expired / completed', () => {
    assert.equal(parseBanorteStatusText('Aprobada'), 'completed');
    assert.equal(parseBanorteStatusText('Rechazada'), 'declined');
    assert.equal(parseBanorteStatusText('cancelled by user'), 'cancelled');
    assert.equal(parseBanorteStatusText('session expired'), 'expired');
    assert.equal(parseBanorteStatusText('waiting'), 'pending');
  });
});
