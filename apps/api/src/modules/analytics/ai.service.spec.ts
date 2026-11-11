import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AI_REASONS } from './ai-insights';
import { AiService } from './ai.service';

/** Prisma falso: base vacía. Registra los `where` para comprobar el inquilino. */
function emptyPrisma() {
  const calls: Record<string, unknown[]> = { order: [], refund: [], fraudFlag: [], event: [] };
  const track = (model: string) => async (args: unknown) => {
    calls[model].push(args);
    return [];
  };
  return {
    calls,
    prisma: {
      order: { findMany: track('order') },
      refund: { findMany: track('refund') },
      fraudFlag: { findMany: track('fraudFlag') },
      event: {
        findMany: track('event'),
        findFirst: async (args: { where: { id: string; organizationId: string } }) =>
          args.where.id === 'propio'
            ? {
                id: 'propio',
                title: 'Evento propio',
                startsAt: new Date(Date.now() + 5 * 864e5),
                totalCapacity: 100,
                createdAt: new Date(),
              }
            : null,
      },
    },
  };
}

describe('AiService con periodo sin datos', () => {
  const q = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' };
  let service: AiService;
  let calls: Record<string, unknown[]>;

  beforeEach(() => {
    const fake = emptyPrisma();
    calls = fake.calls;
    service = new AiService(fake.prisma as never);
  });

  it('exige organización', async () => {
    await expect(service.anomalies(null, q)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza fechas inválidas o invertidas', () => {
    expect(() => service.parseRange({ from: 'x' })).toThrow(BadRequestException);
    expect(() => service.parseRange({ from: q.to, to: q.from })).toThrow(BadRequestException);
  });

  it('evento de otra organización → 404', async () => {
    await expect(service.forecast('org1', 'ajeno')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resumen vacío con motivo y filtrado por organización', async () => {
    const res = await service.executiveSummary('org1', q);
    expect(res.narrative).toBe('');
    expect(res.reason).toBe(AI_REASONS.noSales);
    expect(res.comparisonRange.to < res.dateRange.from).toBe(true);
    for (const call of calls.order) {
      expect((call as { where: { organizationId: string } }).where.organizationId).toBe('org1');
    }
  });

  it('anomalías, fraude, segmentación y recomendaciones vacías con motivo', async () => {
    const anomalies = await service.anomalies('org1', q);
    expect(anomalies).toMatchObject({
      anomalies: [],
      sufficiency: 'insufficient',
      reason: AI_REASONS.noSales,
    });
    const fraud = await service.fraudRisk('org1', q);
    expect(fraud).toMatchObject({ scores: [], reason: AI_REASONS.noFlags, summary: { scored: 0 } });
    const seg = await service.segmentation('org1', q);
    expect(seg).toMatchObject({ customers: [], segments: [], reason: AI_REASONS.noCustomers });
    const recs = await service.recommendations('org1', q);
    expect(recs).toMatchObject({ recommendations: [], reason: AI_REASONS.noRecommendations });
  });

  it('pronóstico de evento propio sin ventas', async () => {
    const res = await service.forecast('org1', 'propio');
    expect(res).toMatchObject({ ticketsSold: 0, comparables: [], reason: AI_REASONS.noEventSales });
    expect(res.projectedOccupancyPercent.sufficiency).toBe('insufficient');
  });
});
