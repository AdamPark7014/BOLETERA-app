import { resolveTicketGate, walletTicketFields } from './ticket-wallet-fields';

describe('ticket-wallet-fields', () => {
  const zones = [
    { name: 'Puerta Norte', slug: 'norte' },
    { name: 'Puerta Sur', slug: 'sur' },
  ];

  it('resuelve puerta por slug de oferta', () => {
    expect(resolveTicketGate(null, 'norte', zones)).toBe('Puerta Norte');
  });

  it('resuelve puerta por nombre de sección', () => {
    expect(resolveTicketGate('Puerta Sur', null, zones)).toBe('Puerta Sur');
  });

  it('devuelve null si no hay coincidencia', () => {
    expect(resolveTicketGate('Platea', 'ga', zones)).toBeNull();
    expect(resolveTicketGate('Platea', 'ga', [])).toBeNull();
  });

  it('walletTicketFields expone holderName y gate', () => {
    expect(
      walletTicketFields({ buyerName: ' Ana Pérez ', section: 'Puerta Norte' }, 'norte', zones)
    ).toEqual({ holderName: 'Ana Pérez', gate: 'Puerta Norte' });
    expect(walletTicketFields({ buyerName: '   ', section: null }, null, zones)).toEqual({
      holderName: null,
      gate: null,
    });
  });
});
