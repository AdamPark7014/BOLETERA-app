import {
  AI_REASONS,
  aggregateSales,
  anomalySufficiency,
  buildExecutiveNarrative,
  buildRecommendations,
  dailySeries,
  dayKey,
  dayKeysBetween,
  deltaPercent,
  detectAnomalies,
  flagScore,
  forecastEvent,
  fraudBand,
  fraudSummary,
  linearFit,
  rfmSegment,
  scoreFraudSubjects,
  segmentCustomers,
  type DailyPoint,
  type FlagRow,
  type SaleRow,
} from './ai-insights';

const DAY = 24 * 60 * 60 * 1000;

function sale(partial: Partial<SaleRow>): SaleRow {
  return {
    orderId: 'o1',
    eventId: 'e1',
    eventTitle: 'Concierto A',
    userId: 'u1',
    email: 'cliente@example.test',
    channel: 'WEB',
    amount: 100,
    tickets: 1,
    soldAt: new Date('2026-11-01T18:00:00Z'),
    ...partial,
  };
}

function series(values: number[]): DailyPoint[] {
  return values.map((value, i) => ({ day: `d${String(i).padStart(2, '0')}`, value }));
}

describe('utilidades', () => {
  it('agrupa por día en America/Mexico_City', () => {
    // 03:00 UTC del 2 nov = 21:00 del 1 nov en CDMX (UTC-6).
    expect(dayKey(new Date('2026-11-02T03:00:00Z'))).toBe('2026-11-01');
  });

  it('enumera días consecutivos del rango', () => {
    const days = dayKeysBetween(new Date('2026-11-01T12:00:00Z'), new Date('2026-11-04T12:00:00Z'));
    expect(days).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('delta sin base es null', () => {
    expect(deltaPercent(10, 0)).toBeNull();
    expect(deltaPercent(150, 100)).toBe(50);
  });
});

describe('aggregateSales', () => {
  it('periodo sin datos da ceros', () => {
    const t = aggregateSales([], []);
    expect(t).toMatchObject({
      orders: 0,
      tickets: 0,
      grossRevenue: 0,
      averageOrderValue: 0,
      refundAmount: 0,
    });
    expect(t.byChannel).toEqual([]);
  });

  it('suma órdenes, boletos, canales y eventos', () => {
    const t = aggregateSales(
      [
        sale({ orderId: 'a', amount: 300, tickets: 3, channel: 'WEB' }),
        sale({
          orderId: 'b',
          amount: 100,
          tickets: 1,
          channel: 'TAQUILLA',
          eventId: 'e2',
          eventTitle: 'B',
        }),
      ],
      [{ amount: 50, processedAt: new Date() }]
    );
    expect(t.orders).toBe(2);
    expect(t.tickets).toBe(4);
    expect(t.grossRevenue).toBe(400);
    expect(t.averageOrderValue).toBe(200);
    expect(t.refundAmount).toBe(50);
    expect(t.byChannel[0]).toEqual({ channel: 'WEB', orders: 1, revenue: 300 });
    expect(t.byEvent[0].eventId).toBe('e1');
  });
});

describe('buildExecutiveNarrative', () => {
  it('sin ventas en ambos periodos: vacío con motivo', () => {
    const out = buildExecutiveNarrative(aggregateSales([]), aggregateSales([]));
    expect(out.narrative).toBe('');
    expect(out.highlights).toEqual([]);
    expect(out.reason).toBe(AI_REASONS.noSales);
    expect(out.kpisCited.every((k) => k.value === 0)).toBe(true);
  });

  it('cita solo cifras observadas y marca caídas ≥ 20 %', () => {
    const current = aggregateSales([sale({ amount: 500, tickets: 5 })]);
    const previous = aggregateSales([
      sale({ amount: 1000, tickets: 10 }),
      sale({ orderId: 'x', amount: 1000 }),
    ]);
    const out = buildExecutiveNarrative(current, previous, { openFraudFlags: 2 });
    expect(out.reason).toBeUndefined();
    expect(out.narrative).toContain('1 orden ');
    expect(out.narrative).toContain('5 boletos');
    expect(out.kpisCited.find((k) => k.key === 'gross_revenue')?.deltaPercent).toBe(-75);
    expect(out.watchouts.some((w) => w.includes('cayó 75'))).toBe(true);
    expect(out.watchouts.some((w) => w.includes('2 señales'))).toBe(true);
    expect(out.highlights[0]).toContain('web');
  });

  it('órdenes sin partidas de boletos: no dice «0 boletos»', () => {
    const out = buildExecutiveNarrative(aggregateSales([sale({ tickets: 0 })]), aggregateSales([]));
    expect(out.narrative).toContain('sin partidas de boletos registradas');
    expect(out.narrative).not.toContain('0 boletos');
  });

  it('periodo actual vacío con anterior con ventas: lo dice sin inventar', () => {
    const out = buildExecutiveNarrative(
      aggregateSales([]),
      aggregateSales([sale({ amount: 200 })])
    );
    expect(out.narrative).toContain('No hubo órdenes completadas');
    expect(out.reason).toBeUndefined();
  });
});

describe('detectAnomalies', () => {
  it('serie vacía o plana: nada evaluado', () => {
    expect(detectAnomalies('tickets_sold', [])).toEqual({ anomalies: [], evaluated: 0 });
    const flat = detectAnomalies('tickets_sold', series([0, 0, 0, 0, 0, 0, 0, 0, 50]));
    expect(flat.evaluated).toBe(0);
    expect(flat.anomalies).toEqual([]);
    expect(anomalySufficiency(0)).toBe('insufficient');
  });

  it('detecta un pico contra la media de 7 días', () => {
    // base: media 10, desviación 2 → 30 es z = 10.
    const res = detectAnomalies('gross_revenue', series([8, 12, 8, 12, 8, 12, 10, 30]));
    expect(res.evaluated).toBe(1);
    expect(res.anomalies).toHaveLength(1);
    const a = res.anomalies[0];
    expect(a.direction).toBe('spike');
    expect(a.baselineMean).toBe(10);
    expect(a.zScore).toBeGreaterThan(4);
    expect(a.severity).toBe('critical');
  });

  it('no marca días dentro del umbral', () => {
    const res = detectAnomalies('tickets_sold', series([8, 12, 8, 12, 8, 12, 10, 12]));
    expect(res.evaluated).toBe(1);
    expect(res.anomalies).toEqual([]);
  });

  it('dailySeries rellena días sin ventas con 0', () => {
    const days = ['2026-11-01', '2026-11-02'];
    const s = dailySeries(
      [sale({ soldAt: new Date('2026-11-02T18:00:00Z'), amount: 70 })],
      days,
      (r) => ({
        at: r.soldAt,
        value: r.amount,
      })
    );
    expect(s).toEqual([
      { day: '2026-11-01', value: 0 },
      { day: '2026-11-02', value: 70 },
    ]);
  });
});

describe('riesgo de fraude', () => {
  const flag = (p: Partial<FlagRow>): FlagRow => ({
    id: 'f1',
    type: 'HIGH_VELOCITY',
    severity: 'MEDIUM',
    score: 0,
    reason: '4 orders in last 5 minutes',
    orderId: 'o1',
    userId: 'u1',
    eventId: 'e1',
    ...p,
  });

  it('sin señales: lista vacía y resumen en cero', () => {
    expect(scoreFraudSubjects([])).toEqual([]);
    expect(fraudSummary([])).toEqual({ scored: 0, highOrCritical: 0, averageScore: 0 });
  });

  it('usa el score guardado o el mínimo de la severidad', () => {
    expect(flagScore({ score: 0, severity: 'HIGH' })).toBe(75);
    expect(flagScore({ score: 42, severity: 'HIGH' })).toBe(42);
    expect(fraudBand(49)).toBe('low');
    expect(fraudBand(50)).toBe('medium');
    expect(fraudBand(75)).toBe('high');
    expect(fraudBand(90)).toBe('critical');
  });

  it('agrupa por orden y toma la señal más alta', () => {
    const scores = scoreFraudSubjects([
      flag({ id: 'a', score: 40 }),
      flag({ id: 'b', score: 80, type: 'DUPLICATE_PURCHASE' }),
      flag({ id: 'c', orderId: null, userId: 'u9', score: 0, severity: 'CRITICAL' }),
      flag({ id: 'd', orderId: null, userId: null, eventId: 'e1' }),
    ]);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toMatchObject({
      subjectType: 'user',
      subjectId: 'u9',
      score: 90,
      band: 'critical',
    });
    expect(scores[1]).toMatchObject({
      subjectType: 'order',
      subjectId: 'o1',
      score: 80,
      band: 'high',
    });
    expect(scores[1].factors[0].label).toBe('Compra duplicada');
    expect(fraudSummary(scores)).toEqual({ scored: 2, highOrCritical: 2, averageScore: 85 });
  });
});

describe('segmentación RFM', () => {
  const asOf = new Date('2026-11-11T00:00:00Z');
  const ago = (d: number) => new Date(asOf.getTime() - d * DAY);

  it('reglas fijas', () => {
    expect(rfmSegment(10, 1)).toBe('new');
    expect(rfmSegment(20, 3)).toBe('champion');
    expect(rfmSegment(80, 2)).toBe('loyal');
    expect(rfmSegment(45, 1)).toBe('promising');
    expect(rfmSegment(120, 5)).toBe('at_risk');
    expect(rfmSegment(400, 1)).toBe('hibernating');
  });

  it('sin clientes: insuficiente y vacío', () => {
    const out = segmentCustomers([], asOf);
    expect(out).toEqual({ rows: [], segments: [], sufficiency: 'insufficient' });
  });

  it('calcula R, F, M y no inventa probabilidad de abandono', () => {
    const out = segmentCustomers(
      [
        {
          userId: 'u1',
          email: 'a@example.test',
          orders: [
            { amount: 100, soldAt: ago(5) },
            { amount: 50, soldAt: ago(40) },
            { amount: 50, soldAt: ago(50) },
          ],
        },
        { userId: 'u2', email: 'b@example.test', orders: [{ amount: 30, soldAt: ago(3) }] },
      ],
      asOf
    );
    expect(out.sufficiency).toBe('limited');
    expect(out.rows[0]).toMatchObject({
      userId: 'u1',
      segment: 'champion',
      recencyDays: 5,
      frequency: 3,
      monetaryMxn: 200,
      churnProbability: null,
      churnConfidence: 'none',
    });
    expect(out.segments).toEqual(
      expect.arrayContaining([
        { segment: 'champion', count: 1, percentOfTotal: 50, averageMonetaryMxn: 200 },
        { segment: 'new', count: 1, percentOfTotal: 50, averageMonetaryMxn: 30 },
      ])
    );
  });
});

describe('pronóstico lineal', () => {
  it('ajuste exacto de una recta', () => {
    const fit = linearFit([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]);
    expect(fit?.slope).toBeCloseTo(2);
    expect(fit?.intercept).toBeCloseTo(1);
    expect(fit?.residualStd).toBeCloseTo(0);
    expect(linearFit([{ x: 0, y: 1 }])).toBeNull();
  });

  it('sin ventas: ceros, sin ritmo y con motivo', () => {
    const out = forecastEvent({ capacity: 100, daily: [], revenue: 0, daysUntilEvent: 10 });
    expect(out.ticketsSold).toBe(0);
    expect(out.observedPace).toEqual([]);
    expect(out.projectedTickets).toMatchObject({
      point: 0,
      level: 'none',
      sufficiency: 'insufficient',
    });
    expect(out.reason).toBe(AI_REASONS.noEventSales);
  });

  it('extiende el ritmo y recorta al aforo', () => {
    const daily = series([10, 10, 10, 10, 10, 10, 10]); // 70 vendidos, 10/día
    const out = forecastEvent({ capacity: 100, daily, revenue: 7000, daysUntilEvent: 2 });
    expect(out.ticketsSold).toBe(70);
    expect(out.projectedTickets.point).toBe(90);
    expect(out.projectedOccupancy.point).toBe(90);
    expect(out.projectedRevenue.point).toBe(9000);
    expect(out.projectedTickets.level).toBe('medium');
    const far = forecastEvent({ capacity: 100, daily, revenue: 7000, daysUntilEvent: 30 });
    expect(far.projectedTickets.point).toBe(100);
    expect(far.projectedTickets.upper).toBeLessThanOrEqual(100);
    expect(out.observedPace.at(-1)).toEqual({ dayIndex: 6, cumulativeOccupancy: 0.7 });
  });

  it('con menos de 3 días no proyecta', () => {
    const out = forecastEvent({
      capacity: 100,
      daily: series([5, 5]),
      revenue: 1000,
      daysUntilEvent: 20,
    });
    expect(out.projectedTickets.point).toBe(10);
    expect(out.projectedTickets.sufficiency).toBe('insufficient');
    expect(out.reason).toBeDefined();
  });

  it('evento ya empezado: proyección = vendido', () => {
    const out = forecastEvent({
      capacity: 100,
      daily: series([5, 5, 5]),
      revenue: 1500,
      daysUntilEvent: 0,
    });
    expect(out.projectedTickets).toMatchObject({ point: 15, lower: 15, upper: 15 });
  });
});

describe('recomendaciones', () => {
  it('sin señales: ninguna', () => {
    expect(buildRecommendations({ events: [], anomalies: [], fraud: [] })).toEqual([]);
  });

  it('activa reglas y ordena por prioridad', () => {
    const recs = buildRecommendations({
      events: [
        {
          eventId: 'e1',
          title: 'Sin ventas',
          daysUntilEvent: 10,
          capacity: 100,
          ticketsSold: 0,
          projectedOccupancy: 0,
          sufficiency: 'insufficient',
          confidence: 'none',
          sampleSize: 0,
        },
        {
          eventId: 'e2',
          title: 'Lento',
          daysUntilEvent: 40,
          capacity: 100,
          ticketsSold: 10,
          projectedOccupancy: 30,
          sufficiency: 'limited',
          confidence: 'low',
          sampleSize: 5,
        },
        {
          eventId: 'e3',
          title: 'Bien',
          daysUntilEvent: 40,
          capacity: 100,
          ticketsSold: 50,
          projectedOccupancy: 95,
          sufficiency: 'sufficient',
          confidence: 'high',
          sampleSize: 20,
        },
      ],
      anomalies: [
        {
          metric: 'gross_revenue',
          bucket: '2026-11-05',
          observed: 30,
          baselineMean: 10,
          baselineStd: 2,
          zScore: 10,
          direction: 'spike',
          severity: 'critical',
          explanation: 'x',
        },
        {
          metric: 'tickets_sold',
          bucket: '2026-11-06',
          observed: 3,
          baselineMean: 2,
          baselineStd: 0.3,
          zScore: 2.6,
          direction: 'spike',
          severity: 'watch',
          explanation: 'y',
        },
      ],
      fraud: [{ subjectType: 'order', subjectId: 'o1', score: 80, band: 'high', factors: [] }],
    });
    expect(recs.map((r) => r.id)).toEqual([
      'anomaly-gross_revenue-2026-11-05',
      'boost-zero-e1',
      'fraud-review',
      'boost-pace-e2',
    ]);
    expect(recs.every((r) => r.estimatedImpact === null)).toBe(true);
  });
});
