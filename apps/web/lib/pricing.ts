/**
 * Precio total al comprador, desde la primera pantalla.
 *
 * En México el precio que se anuncia tiene que ser el que se cobra: mostrar
 * «$800» en el carrito y $1,044 en el último paso es publicidad engañosa, no
 * una sorpresa de UX. `POST /pricing/calculate-cart` es público y devuelve el
 * desglose completo (subtotal, cargo por servicio, IVA, descuento, total), así
 * que no hay excusa para enseñar solo el subtotal.
 *
 * El mismo total se arrastra hasta el cobro y se vuelve a pedir justo antes de
 * crear la orden: si cambió (precio dinámico, promoción caducada), se avisa
 * antes de cobrar en vez de cobrar otra cosa.
 */

export type CartPricing = {
  subtotal: string;
  fees: string;
  taxes: string;
  total: string;
  discount: string;
  lines?: { offerId: string; quantity: number; total?: string }[];
};

export type CartPricingRequest = {
  eventId: string;
  items: { offerId: string; quantity: number }[];
  promotionCode?: string;
};

export function formatMoney(value: number | string, currency = 'MXN'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/** Sin decimales, para titulares tipo «desde $450». */
export function formatMoneyShort(value: number | string, currency = 'MXN'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`;
}

export function pricingTotal(pricing: CartPricing | null | undefined): number {
  const n = Number(pricing?.total);
  return Number.isFinite(n) ? n : 0;
}

/** Cargos visibles = cargo por servicio + IVA. Es lo que sube sobre el precio. */
export function pricingExtras(pricing: CartPricing | null | undefined): number {
  return (Number(pricing?.fees) || 0) + (Number(pricing?.taxes) || 0);
}

/** Dos totales son «el mismo» si difieren menos de un centavo. */
export function sameTotal(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

export async function fetchCartPricing(
  apiBase: string,
  body: CartPricingRequest,
  signal?: AbortSignal,
): Promise<CartPricing | null> {
  if (!body.eventId || !body.items.length) return null;
  try {
    const res = await fetch(`${apiBase}/pricing/calculate-cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as CartPricing;
  } catch {
    return null;
  }
}
