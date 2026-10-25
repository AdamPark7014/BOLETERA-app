/**
 * Lealtad mínima: el número que la campaña ya trae (puntos o descuento).
 * No hay tasa de pesos por punto. Si no hay número, no hay efecto.
 */

export type LoyaltyDiscountType = 'percentage' | 'fixed';

export type LoyaltyRule = {
  /** Lo que se descuenta, por la misma cuenta que un código. */
  value: number;
  discountType: LoyaltyDiscountType;
};

export type LoyaltyCampaignLike = {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  points?: unknown;
  discountValue?: unknown;
  discountType?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

function positive(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/** Puntos, o si no vienen, el descuento. Cero no cuenta. */
export function loyaltyRuleFromCampaign(campaign: LoyaltyCampaignLike): LoyaltyRule | null {
  if (campaign.type !== 'loyalty') return null;
  const points = positive(campaign.points);
  const discount = positive(campaign.discountValue);
  if (points === null && discount === null) return null;
  if (discount !== null && campaign.discountType === 'percentage') {
    return { value: discount, discountType: 'percentage' };
  }
  if (discount !== null) {
    return { value: discount, discountType: 'fixed' };
  }
  return { value: points as number, discountType: 'fixed' };
}

/** Activa y dentro de su ventana. Sin número, no cobra. */
export function loyaltyCharges(campaign: LoyaltyCampaignLike, now = new Date()): boolean {
  if (!loyaltyRuleFromCampaign(campaign)) return false;
  if (campaign.status !== 'ACTIVE') return false;
  const start = new Date(String(campaign.startsAt ?? ''));
  const end = new Date(String(campaign.endsAt ?? ''));
  return start <= now && end >= now;
}

export function loyaltyPromotionCode(campaignId: string): string {
  return `LOY-${campaignId}`;
}

/**
 * La misma cuenta que un código de promoción.
 * El descuento no pasa del subtotal: el total no baja de 0.
 */
export function promotionDiscount(
  type: string,
  value: number,
  subtotal: number,
  maxDiscount?: number | null,
): number {
  const base = Number.isFinite(subtotal) ? Math.max(0, subtotal) : 0;
  const amount = Number(value);
  let discount = 0;
  if (type === 'PERCENTAGE' || type === 'percentage') {
    const raw = base * (amount / 100);
    const cap = maxDiscount ? Number(maxDiscount) : Infinity;
    discount = Math.min(raw, Number.isFinite(cap) ? cap : Infinity);
  } else if (type === 'FIXED_AMOUNT' || type === 'fixed') {
    discount = Math.min(amount, base);
  } else if (type === 'BOGO') {
    discount = base * 0.5;
  }
  if (!Number.isFinite(discount) || discount < 0) return 0;
  return Math.min(discount, base);
}

/** Suma que `awardLoyaltyPoints` armaba en memoria: saldo anterior + puntos. */
export function nextLoyaltyBalance(current: number, awarded: number): number {
  const base = Number.isFinite(current) ? current : 0;
  const add = Number.isFinite(awarded) ? awarded : 0;
  return base + add;
}

/** Entero que cabe en la columna. No baja de 0. */
export function persistedLoyaltyPoints(current: number, awarded: number): number {
  return Math.max(0, Math.round(nextLoyaltyBalance(current, awarded)));
}
