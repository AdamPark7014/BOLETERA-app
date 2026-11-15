import { parseMetricsRange } from './metrics.helpers';

describe('parseMetricsRange', () => {
  it('los días transcurridos nunca pasan de los días del periodo', () => {
    // Periodo de 30 días que terminó hace un rato: antes daba 31 de 30 y la
    // proyección de cierre salía por debajo de lo ya vendido.
    const now = new Date('2026-11-15T12:00:00Z');
    const range = parseMetricsRange('2026-10-15T00:00:00Z', '2026-11-14T00:00:00Z', now);
    expect(range.daysInPeriod).toBe(30);
    expect(range.daysElapsed).toBe(30);
  });

  it('a mitad de periodo cuenta los días reales', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const range = parseMetricsRange('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', now);
    expect(range.daysElapsed).toBe(10);
  });
});
