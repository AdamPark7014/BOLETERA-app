import {
  loyaltyCharges,
  loyaltyRuleFromCampaign,
  nextLoyaltyBalance,
  persistedLoyaltyPoints,
  promotionDiscount,
} from '../campaign-execution/loyalty';

describe('cálculo de lealtad', () => {
  const now = new Date('2026-10-25T12:00:00.000Z');
  const window = {
    status: 'ACTIVE',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z',
  };

  it('sin número no cobra y no inventa una tasa', () => {
    expect(loyaltyRuleFromCampaign({ type: 'loyalty', discountValue: 0, points: 0 })).toBeNull();
    expect(loyaltyRuleFromCampaign({ type: 'loyalty' })).toBeNull();
    expect(loyaltyRuleFromCampaign({ type: 'presale', discountValue: 20, discountType: 'fixed' })).toBeNull();
    expect(loyaltyCharges({ type: 'loyalty', discountValue: 0, ...window }, now)).toBe(false);
    expect(promotionDiscount('FIXED_AMOUNT', 0, 100)).toBe(0);
  });

  it('usa el número de la campaña y no baja el total de 0', () => {
    expect(
      loyaltyRuleFromCampaign({ type: 'loyalty', points: 40, discountValue: 0 }),
    ).toEqual({ value: 40, discountType: 'fixed' });
    expect(promotionDiscount('FIXED_AMOUNT', 40, 100)).toBe(40);
    expect(promotionDiscount('fixed', 40, 30)).toBe(30);

    expect(
      loyaltyRuleFromCampaign({ type: 'loyalty', discountType: 'percentage', discountValue: 10 }),
    ).toEqual({ value: 10, discountType: 'percentage' });
    expect(promotionDiscount('PERCENTAGE', 10, 200)).toBe(20);
    expect(promotionDiscount('PERCENTAGE', 250, 80)).toBe(80);

    expect(nextLoyaltyBalance(12, 10)).toBe(22);
    expect(persistedLoyaltyPoints(12, 10)).toBe(22);
    expect(persistedLoyaltyPoints(3, -10)).toBe(0);
    expect(
      loyaltyCharges({ type: 'loyalty', points: 40, ...window }, now),
    ).toBe(true);
    expect(
      loyaltyCharges({ type: 'loyalty', points: 40, ...window, status: 'DRAFT' }, now),
    ).toBe(false);
  });
});
