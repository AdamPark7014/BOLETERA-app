import { DEFAULT_MSI_MIN_TOTAL, msiConfigFromSettings, resolveInstallments } from './msi';

describe('msi settings.msi', () => {
  it('defaults', () => {
    expect(msiConfigFromSettings(null)).toEqual({
      minTotal: DEFAULT_MSI_MIN_TOTAL,
      plans: [1, 3, 6, 9, 12],
    });
  });

  it('lee settings.msi', () => {
    const cfg = msiConfigFromSettings({ msi: { minTotal: 2000, plans: [1, 3, 6] } });
    expect(cfg.minTotal).toBe(2000);
    expect(cfg.plans).toEqual([1, 3, 6]);
    expect(resolveInstallments(2500, 6, { msi: { minTotal: 2000, plans: [1, 3, 6] } })).toBe(6);
    expect(resolveInstallments(2500, 12, { msi: { minTotal: 2000, plans: [1, 3, 6] } })).toBe(1);
  });

  it('legacy msiMinTotal', () => {
    expect(msiConfigFromSettings({ msiMinTotal: 1800 }).minTotal).toBe(1800);
  });
});
