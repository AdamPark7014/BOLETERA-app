import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactForLog } from './redact.ts';

describe('redactForLog', () => {
  it('strips password, FIRMA, USUARIO, CLABE and card-like data from objects', () => {
    const redacted = redactForLog({
      password: 'hunter2',
      FIRMA: 'abc123',
      USUARIO: 'banorte-user',
      clabe: '012180001234567890',
      pan: '4111111111111111',
      orderId: 'ord_1',
      amount: 100,
    }) as Record<string, unknown>;

    assert.equal(redacted.password, '[REDACTED]');
    assert.equal(redacted.FIRMA, '[REDACTED]');
    assert.equal(redacted.USUARIO, '[REDACTED]');
    assert.equal(redacted.clabe, '[REDACTED]');
    assert.equal(redacted.pan, '[REDACTED]');
    assert.equal(redacted.orderId, 'ord_1');
    assert.equal(redacted.amount, 100);
  });

  it('redacts sensitive query params in redirect URLs', () => {
    const url =
      'https://eps.banorte.com/secure3d/Solucion3DSecure.htm?USUARIO=secret&FIRMA=deadbeef&IMPORTE=10.00&CORREO=buyer@example.com';
    const out = redactForLog(url) as string;
    assert.match(out, /USUARIO=%5BREDACTED%5D/);
    assert.match(out, /FIRMA=%5BREDACTED%5D/);
    assert.match(out, /IMPORTE=10\.00/);
    assert.match(out, /CORREO=%5BEMAIL%5D/);
    assert.doesNotMatch(out, /(?:USUARIO|FIRMA)=(?:secret|deadbeef)/);
    assert.doesNotMatch(out, /buyer(?:@|%40)example\.com/);
  });

  it('can keep emails when emails:false', () => {
    const out = redactForLog('contact buyer@example.com', { emails: false }) as string;
    assert.match(out, /buyer@example\.com/);
  });
});
