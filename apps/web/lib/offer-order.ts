export type OrderableOffer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
  sortOrder?: number | null;
};

function offerName(o: OrderableOffer): string {
  return o.name || o.zone || '';
}

function offerPrice(o: OrderableOffer): number {
  const n = Number(o.basePrice);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Orden idéntico a taquilla: `sortOrder` ASC si alguno lo trae;
 * si no, precio ASC y luego nombre. No filtra disponibilidad.
 */
export function sortOffersForDisplay<T extends OrderableOffer>(list: T[]): T[] {
  const byOrder = list.some((o) => o.sortOrder != null);
  return [...list].sort((a, b) => {
    if (byOrder) {
      return (
        (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) ||
        offerName(a).localeCompare(offerName(b), 'es')
      );
    }
    return offerPrice(a) - offerPrice(b) || offerName(a).localeCompare(offerName(b), 'es');
  });
}
