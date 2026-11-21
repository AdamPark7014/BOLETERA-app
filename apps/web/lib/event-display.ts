// Formatos de la maqueta para fechas, precios y disponibilidad de un evento.
// Todo en America/Mexico_City para que SSR (UTC) y navegador coincidan.

import {
  TIME_ZONE,
  dayKey,
  formatDayMonth,
  formatEventDateTime,
  formatEventLong,
  formatPrice,
} from '@boletera/ui';

export type OfferLite = {
  remainingQuantity?: number | null;
  isAvailable?: boolean | null;
  allInPrice?: number | null;
  basePrice?: number | string | null;
  name?: string | null;
  zone?: string | null;
};

export const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Concierto',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festival',
  CONFERENCE: 'Conferencia',
  WORKSHOP: 'Taller',
  FAMILY: 'Familiar',
  STANDUP: 'Stand-up',
  CINEMA: 'Cine',
  OTHER: 'Evento',
};

export function categoryLabel(key?: string | null): string {
  return CATEGORY_LABEL[key || ''] ?? 'Evento';
}

/** «Vie 20 mar · 21:30» (formato compartido de @boletera/ui). */
export const shortWhen = (iso: string): string => formatEventDateTime(iso);

/** «Sábado, 14 de marzo, 21:00» */
export const longWhen = (iso: string): string => formatEventLong(iso);

/** «14 mar» */
export const dayMonth = (iso: string): string => formatDayMonth(iso);

/** Fecha local AAAA-MM-DD y día de la semana (0 = domingo) en la zona del evento. */
export function localDay(date: Date): { key: string; weekday: number } {
  const key = dayKey(date);
  const weekdayName = date.toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'short' });
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
  return { key, weekday };
}

/** Precio sin centavos cuando son cero: «$1,250». */
export const priceLabel = (amount: number): string => formatPrice(amount);

export function advertisedPrice(event: {
  minPriceAllIn?: number | null;
  minPrice?: number | string | null;
}): number {
  const value = Number(event.minPriceAllIn ?? event.minPrice);
  return Number.isFinite(value) ? value : 0;
}

export type Availability = { remaining: number | null; soldOut: boolean; label: string };

/** Disponibilidad con lo que trae el API: suma de `remainingQuantity` de las ofertas vigentes. */
export function availability(offers?: OfferLite[] | null): Availability {
  if (!offers || offers.length === 0) return { remaining: null, soldOut: false, label: '' };
  const live = offers.filter((o) => o.isAvailable !== false);
  const known = live.every((o) => typeof o.remainingQuantity === 'number');
  const remaining = known ? live.reduce((sum, o) => sum + (o.remainingQuantity ?? 0), 0) : null;
  if (live.length === 0 || remaining === 0)
    return { remaining: 0, soldOut: true, label: 'Agotado' };
  if (remaining !== null && remaining <= 100) {
    return { remaining, soldOut: false, label: `Últimos ${remaining}` };
  }
  return { remaining, soldOut: false, label: 'Disponible' };
}

/** Imagen de Unsplash al ancho que se pinta (la API manda w=1400 para todo). */
export function sizedImage(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  if (!url.includes('images.unsplash.com')) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('w', String(width));
    u.searchParams.set('auto', 'format');
    return u.toString();
  } catch {
    return url;
  }
}

/** Bloque de fecha para tarjetas: día numérico y mes corto («14» / «mar»). */
export function dateBlock(iso: string): { day: string; month: string } {
  const formatter = new Intl.DateTimeFormat('es-MX', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
  });
  const parts = formatter.formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '')
    .replace(/\./g, '')
    .toLocaleLowerCase('es-MX')
    .trim();
  return { day, month };
}

export type EventStatusKind = 'last' | 'presale' | 'soldout' | 'waitlist' | null;

/** Etiqueta de estado de la tarjeta: últimos boletos, preventa o agotado. */
export function eventStatusLabel(
  offers?: OfferLite[] | null,
  opts?: { presale?: boolean }
): { kind: EventStatusKind; label: string } {
  if (opts?.presale) return { kind: 'presale', label: 'Preventa' };
  const stock = availability(offers);
  if (stock.soldOut) return { kind: 'soldout', label: 'Agotado: lista de espera' };
  if (stock.remaining != null && stock.remaining <= 100) {
    return stock.remaining <= 20
      ? { kind: 'last', label: 'Últimos boletos' }
      : { kind: 'last', label: `Últimos ${stock.remaining}` };
  }
  return { kind: null, label: '' };
}
