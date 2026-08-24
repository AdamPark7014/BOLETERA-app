/**
 * Fotografías de stock (Unsplash) para seeds y fallbacks de póster.
 * Licencia: uso permitido vía Unsplash; atribución recomendada en producción.
 */
export const EVENT_STOCK_IMAGES = {
  MUSIC:
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1400&q=80',
  MUSIC_INDIE:
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1400&q=80',
  ELECTRO:
    'https://images.unsplash.com/photo-1571266028243-e68f8570c9e0?auto=format&fit=crop&w=1400&q=80',
  JAZZ:
    'https://images.unsplash.com/photo-1415201364774-f6f0ba35c28b?auto=format&fit=crop&w=1400&q=80',
  COMEDY:
    'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=1400&q=80',
  THEATER:
    'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=1400&q=80',
  BALLET:
    'https://images.unsplash.com/photo-1518834107812-67b0b7c584ca?auto=format&fit=crop&w=1400&q=80',
  SPORTS:
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1400&q=80',
  FESTIVAL:
    'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1400&q=80',
  OPEN_AIR:
    'https://images.unsplash.com/photo-1459749411175-04bf52924ce5?auto=format&fit=crop&w=1400&q=80',
  EXPERIENCE:
    'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1400&q=80',
} as const;

export type EventCategoryKey =
  | 'MUSIC'
  | 'SPORTS'
  | 'THEATER'
  | 'COMEDY'
  | 'FESTIVAL'
  | 'EXPERIENCE';

/** Imagen por categoría cuando el evento no tiene `image` en BD. */
export function stockImageForCategory(category?: string | null, seed?: string): string {
  switch (category) {
    case 'SPORTS':
      return EVENT_STOCK_IMAGES.SPORTS;
    case 'THEATER':
      return EVENT_STOCK_IMAGES.THEATER;
    case 'COMEDY':
      return EVENT_STOCK_IMAGES.COMEDY;
    case 'FESTIVAL':
      return EVENT_STOCK_IMAGES.FESTIVAL;
    case 'EXPERIENCE':
      return EVENT_STOCK_IMAGES.EXPERIENCE;
    default:
      if (seed && /electro|edm|dj/i.test(seed)) return EVENT_STOCK_IMAGES.ELECTRO;
      if (seed && /jazz/i.test(seed)) return EVENT_STOCK_IMAGES.JAZZ;
      if (seed && /indie/i.test(seed)) return EVENT_STOCK_IMAGES.MUSIC_INDIE;
      if (seed && /ballet/i.test(seed)) return EVENT_STOCK_IMAGES.BALLET;
      return EVENT_STOCK_IMAGES.MUSIC;
  }
}
