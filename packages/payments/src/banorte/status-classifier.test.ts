import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBanorteStatusText, parseBanorteSettlement } from './webhook.ts';

/**
 * El caso que motiva este archivo: la implementación anterior clasificaba por
 * subcadena, así que `"transacción no aprobada".includes("aprobada")` era `true`
 * y un cobro RECHAZADO se conciliaba como completado. Como el reconciliador
 * llama a `completeOrder` cuando ve `completed`, eso emitía boletos sin haber
 * cobrado, de forma recurrente y silenciosa.
 */
describe('parseBanorteStatusText', () => {
  it('no confunde una negación con una aprobación', () => {
    assert.notEqual(parseBanorteStatusText('Transacción no aprobada'), 'completed');
    assert.notEqual(parseBanorteStatusText('TRANSACCION NO APROBADA'), 'completed');
    assert.notEqual(parseBanorteStatusText('operación sin éxito'), 'completed');
  });

  it('reconoce una aprobación real', () => {
    assert.equal(parseBanorteStatusText('Transacción aprobada'), 'completed');
    assert.equal(parseBanorteStatusText('Payment approved'), 'completed');
    assert.equal(parseBanorteStatusText('Cobro exitoso'), 'completed');
  });

  it('el rechazo gana aunque el texto mencione después algo positivo', () => {
    // Una página de error puede traer un pie con "pagos aprobados" o similar.
    assert.equal(parseBanorteStatusText('Rechazada. Consulte sus pagos aprobados.'), 'declined');
  });

  it('prioriza el código de respuesta explícito sobre el texto', () => {
    assert.equal(parseBanorteStatusText('CODIGO_RESPUESTA=00 aprobada'), 'completed');
    assert.equal(parseBanorteStatusText('CODIGO_RESPUESTA=51 aprobada'), 'declined');
  });

  it('ante cualquier duda devuelve pending, nunca completed', () => {
    assert.equal(parseBanorteStatusText('<html><body>502 Bad Gateway</body></html>'), 'pending');
    assert.equal(parseBanorteStatusText(''), 'pending');
    assert.equal(parseBanorteStatusText('mantenimiento programado'), 'pending');
    // "00" suelto dentro de otro campo ya no basta para dar por cobrado.
    assert.equal(parseBanorteStatusText('{"amount":"00","status":"unknown"}'), 'pending');
  });

  it('distingue expirada y cancelada', () => {
    assert.equal(parseBanorteStatusText('Referencia expirada'), 'expired');
    assert.equal(parseBanorteStatusText('Operación cancelada por el usuario'), 'cancelled');
  });
});

describe('parseBanorteSettlement', () => {
  it('extrae el importe realmente liquidado', () => {
    assert.equal(parseBanorteSettlement({ IMPORTE: '1234.50' }).amount, 1234.5);
    assert.equal(parseBanorteSettlement({ amount: 99 }).amount, 99);
  });

  it('traduce el código de moneda ISO numérico', () => {
    assert.equal(parseBanorteSettlement({ MONEDA: '484' }).currency, 'MXN');
    assert.equal(parseBanorteSettlement({ MONEDA: '840' }).currency, 'USD');
  });

  it('devuelve undefined si no hay importe, en vez de asumir cero', () => {
    // Un 0 implícito se compararía contra el total de la orden y marcaría
    // descuadre en toda venta: hay que distinguir "no vino el dato".
    assert.equal(parseBanorteSettlement({}).amount, undefined);
    assert.equal(parseBanorteSettlement({ IMPORTE: 'n/a' }).amount, undefined);
  });
});
