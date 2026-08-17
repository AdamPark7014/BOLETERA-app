'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartOfferLine = {
  offerId: string;
  offerName?: string;
  holdIds: string[];
  seatLabels?: string[];
  quantity: number;
  lineTotal?: number;
};

export type CartItem = {
  eventId: string;
  eventTitle: string;
  slug?: string;
  startsAt?: string;
  venueName?: string;
  venueCity?: string;
  expiresAt: string;
  seatCount: number;
  currency?: string;
  lines: CartOfferLine[];
  /** @deprecated use lines — kept for older persisted carts */
  holdIds?: string[];
  offerId?: string;
  seatLabels?: string[];
  lineTotal?: number;
};

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeAt: (index: number) => void;
  clear: () => void;
};

export function normalizeCartItem(item: CartItem): CartItem {
  if (item.lines?.length) {
    const seatCount = item.lines.reduce((s, l) => s + (l.quantity || l.holdIds.length), 0);
    return { ...item, seatCount, holdIds: item.lines.flatMap((l) => l.holdIds) };
  }
  if (item.holdIds?.length && item.offerId) {
    return {
      ...item,
      lines: [
        {
          offerId: item.offerId,
          holdIds: item.holdIds,
          seatLabels: item.seatLabels,
          quantity: item.holdIds.length,
          lineTotal: item.lineTotal,
        },
      ],
      seatCount: item.holdIds.length,
    };
  }
  return { ...item, lines: item.lines ?? [], seatCount: item.seatCount ?? 0 };
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => ({
          items: [
            ...s.items.filter((i) => i.eventId !== item.eventId),
            normalizeCartItem(item),
          ],
        })),
      removeAt: (index) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'boletera-cart' },
  ),
);

// Una sola implementación del reloj: `lib/payment-window` la comparte con el
// contador de la reserva y con la ventana de pago diferido (OXXO/SPEI).
export { secondsUntil } from './payment-window';
