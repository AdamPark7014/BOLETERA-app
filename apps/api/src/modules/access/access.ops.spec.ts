import {
  findCorrectGateLabel,
  readAccessConfig,
  summarizeGateTraffic,
  ticketMatchesGate,
} from './access.ops';

describe('access.ops', () => {
  it('lee config de metadata.access con defaults seguros', () => {
    expect(readAccessConfig(null)).toEqual({
      reentryAllowed: false,
      maxReentries: 0,
      gates: {},
    });
    const cfg = readAccessConfig({
      access: {
        reentryAllowed: true,
        maxReentries: 2,
        gates: { z1: { allowedZones: ['VIP'], label: 'Puerta VIP' } },
      },
    });
    expect(cfg.reentryAllowed).toBe(true);
    expect(cfg.maxReentries).toBe(2);
    expect(cfg.gates.z1?.label).toBe('Puerta VIP');
  });

  it('aplica reglas de puerta por zona de oferta', () => {
    const rule = { allowedZones: ['VIP', 'Platea'] };
    expect(ticketMatchesGate(rule, { offer: { zone: 'VIP' } })).toBe(true);
    expect(ticketMatchesGate(rule, { offer: { zone: 'General' } })).toBe(false);
    expect(ticketMatchesGate({}, { offer: { zone: 'General' } })).toBe(true);
  });

  it('calcula aforo dentro = entradas − salidas', () => {
    const traffic = summarizeGateTraffic([
      { zoneId: 'z1', reason: 'ENTRY' },
      { zoneId: 'z1', reason: 'ENTRY' },
      { zoneId: 'z1', reason: 'EXIT' },
      { zoneId: 'z2', reason: null },
      { zoneId: 'z2', reason: 'REENTRY' },
    ]);
    expect(traffic.entries).toBe(4);
    expect(traffic.exited).toBe(1);
    expect(traffic.insideNow).toBe(3);
    expect(traffic.byZone.get('z1')).toEqual({ entries: 2, exited: 1, inside: 1 });
  });

  it('sugiere la puerta correcta', () => {
    const label = findCorrectGateLabel(
      {
        z1: { allowedZones: ['VIP'], label: 'Norte' },
        z2: { allowedZones: ['General'], label: 'Sur' },
      },
      { offer: { zone: 'General' } }
    );
    expect(label).toBe('Sur');
  });
});
