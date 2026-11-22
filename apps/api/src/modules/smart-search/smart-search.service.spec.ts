import { HttpException, HttpStatus } from '@nestjs/common';
import { SmartSearchService } from './smart-search.service';

describe('SmartSearchService', () => {
  function build(overrides?: {
    incrementWithTtl?: jest.Mock;
    isConfigured?: boolean;
  }) {
    const prisma = {};
    const redis = {
      incrementWithTtl: overrides?.incrementWithTtl ?? jest.fn().mockResolvedValue(1),
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(true),
    };
    const claude = {
      isConfigured: jest.fn().mockReturnValue(overrides?.isConfigured ?? false),
      interpretFilters: jest.fn(),
    };
    const svc = new SmartSearchService(prisma as never, redis as never, claude as never);
    return { svc, prisma, redis, claude };
  }

  it('search con consulta corta no consulta datos y regresa vacío', async () => {
    const { svc, redis } = build();
    const empty = await svc.search({ q: '', orgId: 'org-1' });
    expect(empty.results).toEqual([]);
    expect(empty.chips).toEqual([]);
    expect(empty.source).toBe('deterministic');
    expect(empty.filters).toEqual({});
    expect(redis.incrementWithTtl).not.toHaveBeenCalled();

    const short = await svc.search({ q: 'a', orgId: 'org-1' });
    expect(short.results).toEqual([]);
    expect(short.source).toBe('deterministic');
  });

  it('assistantAvailable refleja si Claude está configurado', () => {
    expect(build({ isConfigured: false }).svc.assistantAvailable()).toBe(false);
    expect(build({ isConfigured: true }).svc.assistantAvailable()).toBe(true);
  });

  it('search respeta el tope de búsquedas por IP', async () => {
    const { svc } = build({
      incrementWithTtl: jest.fn().mockResolvedValue(999),
    });
    await expect(svc.search({ q: 'rock cdmx', orgId: 'org-1', ip: '1.2.3.4' })).rejects.toBeInstanceOf(
      HttpException
    );
    try {
      await svc.search({ q: 'rock cdmx', orgId: 'org-1', ip: '1.2.3.4' });
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });
});
