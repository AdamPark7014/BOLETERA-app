/** Formas que devuelve el API de membresías del comprador. */

export type PublicBenefit = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  redemptionLimit: number | null;
};

export type PublicPlan = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  description: string | null;
  price: string;
  currency: string;
  billingPeriod: 'MONTHLY' | 'ANNUAL' | 'SEASON' | string;
  soldOut: boolean;
  benefits: PublicBenefit[];
};

export type CheckoutPayment = {
  redirectUrl?: string | null;
  reference: string | null;
  clabe: string | null;
  concept: string | null;
  demo: boolean;
};

export type CheckoutStatus = {
  id: string;
  publicId: string;
  status: string;
  kind: 'NEW' | 'RENEWAL' | string;
  planName: string;
  billingPeriod?: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  expiresAt: string;
  completedAt?: string | null;
  payment: CheckoutPayment;
};

/** «Mensual», «Anual», «Temporada»: el periodo en palabras. */
export function periodLabel(period: string): string {
  if (period === 'MONTHLY') return 'Mensual';
  if (period === 'SEASON') return 'Temporada';
  return 'Anual';
}

/** Sufijo del precio: «al mes», «al año», «por temporada». */
export function periodSuffix(period: string): string {
  if (period === 'MONTHLY') return 'al mes';
  if (period === 'SEASON') return 'por temporada';
  return 'al año';
}
