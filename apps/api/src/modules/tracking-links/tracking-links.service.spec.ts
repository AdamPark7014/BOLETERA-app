import { normalizeTrackingCode } from './tracking-links.service';

describe('normalizeTrackingCode', () => {
  it('normaliza a mayúsculas y recorta', () => {
    expect(normalizeTrackingCode('  radio-fm ')).toBe('RADIO-FM');
  });

  it('quita caracteres raros y limita a 32', () => {
    expect(normalizeTrackingCode('ab@#$c')).toBe('ABC');
    expect(normalizeTrackingCode('A'.repeat(40))?.length).toBe(32);
  });

  it('vacío o basura → undefined', () => {
    expect(normalizeTrackingCode('')).toBeUndefined();
    expect(normalizeTrackingCode('@@@')).toBeUndefined();
    expect(normalizeTrackingCode(null)).toBeUndefined();
  });
});
