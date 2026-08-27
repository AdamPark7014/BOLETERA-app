import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  QR_PAYLOAD_VERSION,
  QR_ROTATION_SECONDS,
  buildQrPayload,
  deriveTicketKeyHex,
  generateTicketCode,
  signEventManifest,
  signTicketPayload,
  ticketManifestDigest,
  verifyTicketSignature,
} from './index.ts';

const SECRET = 'secreto-maestro-de-prueba-no-usar-en-produccion';
const OTRO_SECRETO = 'otro-secreto-maestro-completamente-distinto';
const TICKET = 'tkt_aaaaaaaaaaaaaaaaaaaaaaaa';
const OTRO_TICKET = 'tkt_bbbbbbbbbbbbbbbbbbbbbbbb';
const EVENTO = 'evt_111111111111111111111111';
const OTRO_EVENTO = 'evt_222222222222222222222222';

/**
 * Congela el reloj en el inicio exacto de una ventana de rotación, para poder
 * afirmar sobre el borde entre ventanas sin depender de cuándo corra el test.
 */
function conRelojEn<T>(ms: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

const VENTANA_MS = QR_ROTATION_SECONDS * 1000;
/** Inicio limpio de una ventana: evita casos frontera accidentales. */
const T0 = 1_000_000 * VENTANA_MS;

describe('signTicketPayload / verifyTicketSignature', () => {
  it('emite una firma v2 de 32 hex', () => {
    const sig = signTicketPayload(TICKET, EVENTO, SECRET);

    assert.ok(sig.startsWith('v2.'), `firma inesperada: ${sig}`);
    assert.match(sig.slice(3), /^[0-9a-f]{32}$/);
  });

  it('la firma recién emitida verifica', () => {
    const sig = signTicketPayload(TICKET, EVENTO, SECRET);

    assert.equal(verifyTicketSignature(TICKET, EVENTO, sig, SECRET), true);
  });

  it('una firma vacía nunca verifica', () => {
    assert.equal(verifyTicketSignature(TICKET, EVENTO, '', SECRET), false);
  });

  it('una firma de longitud distinta no verifica (y no revienta)', () => {
    // `timingSafeEqual` exige búferes de la misma longitud: si el caso no se
    // tratara aparte, esto lanzaría una excepción en la puerta del recinto.
    assert.equal(verifyTicketSignature(TICKET, EVENTO, 'v2.corta', SECRET), false);
    assert.equal(
      verifyTicketSignature(TICKET, EVENTO, `v2.${'f'.repeat(64)}`, SECRET),
      false,
    );
  });

  it('con otro secreto maestro no verifica', () => {
    const sig = signTicketPayload(TICKET, EVENTO, SECRET);

    assert.equal(verifyTicketSignature(TICKET, EVENTO, sig, OTRO_SECRETO), false);
  });
});

describe('rotación del QR', () => {
  it('el código cambia al pasar de ventana', () => {
    const a = conRelojEn(T0, () => signTicketPayload(TICKET, EVENTO, SECRET));
    const b = conRelojEn(T0 + VENTANA_MS, () => signTicketPayload(TICKET, EVENTO, SECRET));

    assert.notEqual(a, b, 'un QR que no rota no protege de la reventa por captura de pantalla');
  });

  it('el código es estable dentro de la misma ventana', () => {
    const a = conRelojEn(T0, () => signTicketPayload(TICKET, EVENTO, SECRET));
    const b = conRelojEn(T0 + VENTANA_MS - 1, () => signTicketPayload(TICKET, EVENTO, SECRET));

    assert.equal(a, b);
  });

  it('acepta la ventana anterior: 15 s de gracia en la puerta', () => {
    // El comprador enseña el teléfono y el escáner tarda: sin gracia, el QR
    // caduca entre que se renderiza y se lee.
    const sig = conRelojEn(T0, () => signTicketPayload(TICKET, EVENTO, SECRET));

    const ok = conRelojEn(T0 + VENTANA_MS, () =>
      verifyTicketSignature(TICKET, EVENTO, sig, SECRET),
    );

    assert.equal(ok, true);
  });

  it('rechaza una firma de dos ventanas atrás', () => {
    // Es lo que hace que la captura de pantalla reenviada por WhatsApp no sirva.
    const sig = conRelojEn(T0, () => signTicketPayload(TICKET, EVENTO, SECRET));

    const ok = conRelojEn(T0 + 2 * VENTANA_MS, () =>
      verifyTicketSignature(TICKET, EVENTO, sig, SECRET),
    );

    assert.equal(ok, false);
  });

  it('la ventana de gracia total no pasa de 30 s', () => {
    assert.equal(QR_ROTATION_SECONDS, 15);
  });
});

describe('clave derivada por boleto (F2-16)', () => {
  it('la firma de un boleto no vale para otro boleto', () => {
    const sig = signTicketPayload(TICKET, EVENTO, SECRET);

    assert.equal(verifyTicketSignature(OTRO_TICKET, EVENTO, sig, SECRET), false);
  });

  it('la firma de un evento no vale para otro evento', () => {
    const sig = signTicketPayload(TICKET, EVENTO, SECRET);

    assert.equal(verifyTicketSignature(TICKET, OTRO_EVENTO, sig, SECRET), false);
  });

  it('la clave que se entrega al teléfono NO es el secreto maestro', () => {
    const key = deriveTicketKeyHex(TICKET, EVENTO, SECRET);

    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, SECRET);
    assert.ok(!key.includes(Buffer.from(SECRET, 'utf8').toString('hex')));
  });

  it('cada boleto recibe una clave distinta', () => {
    // Comprometer un teléfono expone ESE boleto, no el sistema entero.
    const a = deriveTicketKeyHex(TICKET, EVENTO, SECRET);
    const b = deriveTicketKeyHex(OTRO_TICKET, EVENTO, SECRET);

    assert.notEqual(a, b);
  });
});

describe('keyEpoch — la transferencia mata el QR anterior', () => {
  it('la firma con la época vieja NO verifica contra la nueva', () => {
    // Es exactamente el teléfono de quien ya regaló el boleto.
    const sigVieja = signTicketPayload(TICKET, EVENTO, SECRET, 0);

    assert.equal(verifyTicketSignature(TICKET, EVENTO, sigVieja, SECRET, 1), false);
  });

  it('la firma con la época nueva verifica', () => {
    const sig = signTicketPayload(TICKET, EVENTO, SECRET, 1);

    assert.equal(verifyTicketSignature(TICKET, EVENTO, sig, SECRET, 1), true);
  });

  it('cada transferencia vuelve a invalidar la anterior', () => {
    const sigEpoca1 = signTicketPayload(TICKET, EVENTO, SECRET, 1);

    assert.equal(verifyTicketSignature(TICKET, EVENTO, sigEpoca1, SECRET, 2), false);
  });

  it('la época 0 es idéntica a no pasar época', () => {
    // Las carteras ya descargadas deben seguir abriendo la puerta tras desplegar.
    const conCero = conRelojEn(T0, () => signTicketPayload(TICKET, EVENTO, SECRET, 0));
    const sinNada = conRelojEn(T0, () => signTicketPayload(TICKET, EVENTO, SECRET));

    assert.equal(conCero, sinNada);
  });

  it('la clave offline también cambia al transferir', () => {
    const antes = deriveTicketKeyHex(TICKET, EVENTO, SECRET, 0);
    const despues = deriveTicketKeyHex(TICKET, EVENTO, SECRET, 1);

    assert.notEqual(antes, despues, 'si no cambia, la cartera vieja sigue generando QR válidos');
  });
});

describe('buildQrPayload', () => {
  it('lleva versión, boleto, evento y firma en claves cortas', () => {
    const payload = JSON.parse(buildQrPayload(TICKET, EVENTO, SECRET));

    assert.equal(payload.v, QR_PAYLOAD_VERSION);
    assert.equal(payload.t, TICKET);
    assert.equal(payload.e, EVENTO);
    assert.ok(String(payload.s).startsWith('v2.'));
  });

  it('la firma del payload verifica', () => {
    const payload = JSON.parse(buildQrPayload(TICKET, EVENTO, SECRET));

    assert.equal(verifyTicketSignature(payload.t, payload.e, payload.s, SECRET), true);
  });

  it('no filtra el secreto maestro dentro del QR', () => {
    assert.ok(!buildQrPayload(TICKET, EVENTO, SECRET).includes(SECRET));
  });
});

describe('ticketManifestDigest — manifiesto offline (F2-15)', () => {
  it('es una huella corta y estable', () => {
    const a = ticketManifestDigest(TICKET, EVENTO, 'SOLD', SECRET);
    const b = ticketManifestDigest(TICKET, EVENTO, 'SOLD', SECRET);

    assert.match(a, /^[0-9a-f]{12}$/);
    assert.equal(a, b, 'no debe rotar con el tiempo: el escáner trabaja sin conexión');
  });

  it('cambia con el estado del boleto', () => {
    // Sin esto se podría "ascender" un boleto reembolsado editando el fichero
    // local del escáner.
    const vendido = ticketManifestDigest(TICKET, EVENTO, 'SOLD', SECRET);
    const usado = ticketManifestDigest(TICKET, EVENTO, 'USED', SECRET);
    const reembolsado = ticketManifestDigest(TICKET, EVENTO, 'REFUNDED', SECRET);

    assert.notEqual(vendido, usado);
    assert.notEqual(vendido, reembolsado);
  });

  it('cambia con el boleto', () => {
    assert.notEqual(
      ticketManifestDigest(TICKET, EVENTO, 'SOLD', SECRET),
      ticketManifestDigest(OTRO_TICKET, EVENTO, 'SOLD', SECRET),
    );
  });
});

describe('signEventManifest', () => {
  const entradas = [
    { id: 't1', st: 'SOLD', h: 'aaaaaaaaaaaa' },
    { id: 't2', st: 'SOLD', h: 'bbbbbbbbbbbb' },
    { id: 't3', st: 'USED', h: 'cccccccccccc' },
  ];
  const issuedAt = '2026-08-27T10:00:00.000Z';

  it('es determinista para la misma página', () => {
    assert.equal(
      signEventManifest(EVENTO, issuedAt, entradas, SECRET),
      signEventManifest(EVENTO, issuedAt, entradas, SECRET),
    );
  });

  it('reordenar las entradas invalida la firma', () => {
    const reordenadas = [entradas[1], entradas[0], entradas[2]];

    assert.notEqual(
      signEventManifest(EVENTO, issuedAt, entradas, SECRET),
      signEventManifest(EVENTO, issuedAt, reordenadas, SECRET),
    );
  });

  it('recortar la lista invalida la firma', () => {
    assert.notEqual(
      signEventManifest(EVENTO, issuedAt, entradas, SECRET),
      signEventManifest(EVENTO, issuedAt, entradas.slice(0, 2), SECRET),
    );
  });

  it('reetiquetar el estado de una entrada invalida la firma', () => {
    // Marcar USED como SOLD dejaría reentrar con un boleto ya usado.
    const manipuladas = entradas.map((e, i) => (i === 2 ? { ...e, st: 'SOLD' } : e));

    assert.notEqual(
      signEventManifest(EVENTO, issuedAt, entradas, SECRET),
      signEventManifest(EVENTO, issuedAt, manipuladas, SECRET),
    );
  });

  it('otro evento o otro instante producen otra firma', () => {
    const base = signEventManifest(EVENTO, issuedAt, entradas, SECRET);

    assert.notEqual(base, signEventManifest(OTRO_EVENTO, issuedAt, entradas, SECRET));
    assert.notEqual(
      base,
      signEventManifest(EVENTO, '2026-08-27T11:00:00.000Z', entradas, SECRET),
    );
  });
});

describe('generateTicketCode', () => {
  it('tiene el prefijo y la longitud del formato BLT', () => {
    assert.match(generateTicketCode(), /^BLT-[0-9A-F]{16}$/);
  });

  it('no repite códigos', () => {
    const codigos = new Set(Array.from({ length: 500 }, () => generateTicketCode()));

    assert.equal(codigos.size, 500);
  });
});
