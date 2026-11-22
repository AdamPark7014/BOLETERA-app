import { BuyerRiskService } from './buyer-risk.service';

describe('BuyerRiskService', () => {
  function make() {
    const store = new Map<string, unknown>();
    const redis = {
      incrementWithTtl: jest.fn(async (key: string) => {
        const n = Number(store.get(key) ?? 0) + 1;
        store.set(key, n);
        return n;
      }),
      getJson: jest.fn(async (key: string) => store.get(key) ?? null),
      setJson: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
        return true;
      }),
      isReady: true,
    };
    return new BuyerRiskService(redis as never);
  }

  it('marca alto con UA de automatización y ritmo', async () => {
    const svc = make();
    for (let i = 0; i < 35; i++) {
      await svc.assess({ ip: '1.1.1.1', userAgent: 'curl/8.0', sessionId: `s${i}` });
    }
    const last = await svc.assess({
      ip: '1.1.1.1',
      userAgent: 'python-requests/2.0',
      sessionId: 's99',
    });
    expect(last.level).toBe('high');
    expect(last.score).toBeGreaterThanOrEqual(60);
  });

  it('emite y verifica reto', () => {
    const svc = make();
    const token = svc.issueChallengeToken('abc');
    expect(svc.verifyChallengeToken(token, 'abc')).toBe(true);
    expect(svc.verifyChallengeToken(token, 'otro')).toBe(false);
  });
});
