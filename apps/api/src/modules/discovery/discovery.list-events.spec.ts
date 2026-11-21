import { DiscoveryService } from './discovery.service';

describe('DiscoveryService.listEvents · eventos pasados', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { event: { findMany } } as any;
  const service = new DiscoveryService(prisma);

  beforeEach(() => {
    findMany.mockClear().mockResolvedValue([]);
  });

  it('sin includePast fuerza startsAt >= ahora', async () => {
    const before = Date.now();
    await service.listEvents({ orgId: 'org-1' });
    const after = Date.now();
    expect(findMany).toHaveBeenCalled();
    const arg = findMany.mock.calls[0][0];
    const gte = arg.where.startsAt?.gte as Date | undefined;
    expect(gte).toBeInstanceOf(Date);
    expect(gte!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(gte!.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('con includePast=true no fuerza startsAt.gte por omisión', async () => {
    await service.listEvents({ orgId: 'org-1', includePast: true });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.startsAt?.gte).toBeUndefined();
  });
});
