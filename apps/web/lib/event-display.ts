// Formatos de la maqueta para fechas, precios y disponibilidad de un evento.
// Todo en America/Mexico_City para que SSR (UTC) y navegador coincidan.

import { formatTicketAmount } from '@boletera/ui';

const TZ = 'America/Mexico_City';

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

/** «VIE 20 MAR · 21:30» */
export function shortWhen(iso: string): string {
  const date = new Date(iso);
  const day = date
    .toLocaleDateString('es-MX', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '')
    .replace(',', '');
  const time = date.toLocaleTimeString('es-MX', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} · ${time}`.toUpperCase();
}

/** «sábado 14 de marzo, 21:00» */
export function longWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('es-MX', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = date.toLocaleTimeString('es-MX', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${time}`;
}

/** «14 MAR» */
export function dayMonth(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('es-MX', { timeZone: TZ, day: 'numeric', month: 'short' })
    .replace(/\./g, '')
    .toUpperCase();
}

/** Fecha local AAAA-MM-DD y día de la semana (0 = domingo) en la zona del evento. */
export function localDay(date: Date): { key: string; weekday: number } {
  const key = date.toLocaleDateString('en-CA', { timeZone: TZ });
  const weekdayName = date.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
  return { key, weekday };
}

/** Precio sin centavos cuando son cero: «$1,250». */
export function priceLabel(amount: number): string {
  const full = formatTicketAmount(amount);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}

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
