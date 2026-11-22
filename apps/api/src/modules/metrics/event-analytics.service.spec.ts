import {
  aggregateBuckets,
  bucketKeyMinute,
  channelLabel,
  paymentLabel,
  readAnalyticsMeta,
} from './event-analytics.service';

describe('event-analytics helpers', () => {
  it('lee meta vacía sin romperse', () => {
    expect(readAnalyticsMeta(null)).toEqual({});
    expect(readAnalyticsMeta({ analytics: { salesGoal: { tickets: 100 } } }).salesGoal).toEqual({
      tickets: 100,
    });
  });

  it('agrupa por minuto/hora/día', () => {
    const at = new Date('2026-11-21T18:30:00.000Z');
    const entries = [
      { at, revenue: 100, tickets: 2 },
      { at, revenue: 50, tickets: 1 },
    ];
    const minute = aggregateBuckets(entries, 'minute');
    expect(minute).toHaveLength(1);
    expect(minute[0].revenue).toBe(150);
    expect(minute[0].tickets).toBe(3);
    expect(aggregateBuckets(entries, 'hour')[0].bucket).toMatch(/T\d{2}:00$/);
    expect(aggregateBuckets(entries, 'day')[0].bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('bucketKeyMinute usa formato fijo', () => {
    const key = bucketKeyMinute(new Date('2026-11-21T18:30:00.000Z'));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('etiquetas en español', () => {
    expect(channelLabel('WEB')).toBe('Web');
    expect(channelLabel('TAQUILLA')).toBe('Taquilla');
    expect(channelLabel('RESALE')).toBe('Reventa');
    expect(paymentLabel('CARD')).toBe('Tarjeta');
    expect(paymentLabel('BANK_TRANSFER')).toBe('SPEI');
  });
});
