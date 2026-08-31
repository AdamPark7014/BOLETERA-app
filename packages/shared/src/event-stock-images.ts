/**
 * Fotografías de stock (Unsplash) para seeds y demos.
 * Storefront posters prefer local `/hero/*` via EventPosterArt — do not use
 * these on first paint when CMS/event images exist.
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

/** Diapositivas del hero de la home (Unsplash, uso decorativo). */
export type HomeHeroSlide = {
  url: string;
  label: string;
  alt: string;
};

/** URL optimizada para fondos hero (WebP, ~1280px — balance peso/calidad). */
export function heroImageSrc(url: string, width = 1280): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('auto', 'format');
    parsed.searchParams.set('fit', 'crop');
    parsed.searchParams.set('w', String(width));
    parsed.searchParams.set('q', '75');
    parsed.searchParams.set('fm', 'webp');
    return parsed.toString();
  } catch {
    return url;
  }
}

export const HOME_HERO_SLIDES: readonly HomeHeroSlide[] = [
  {
    url: '/hero/01-festival.jpg',
    label: 'Festivales',
    alt: 'Multitud en un festival al aire libre con luces de escenario',
  },
  {
    url: '/hero/02-concert.jpg',
    label: 'Conciertos',
    alt: 'Público en un concierto con manos levantadas',
  },
  {
    url: '/hero/03-electro.jpg',
    label: 'Electrónica',
    alt: 'DJ en cabina con luces láser en un club',
  },
  {
    url: '/hero/04-experience.jpg',
    label: 'Experiencias',
    alt: 'Escenario iluminado en un festival nocturno',
  },
  {
    url: '/hero/05-indie.jpg',
    label: 'Indie & rock',
    alt: 'Artista en escenario con guitarra eléctrica',
  },
] as const;

/** Diapositivas con `src` listo para <Image> / preload. */
export const HOME_HERO_SLIDE_SRCS = HOME_HERO_SLIDES.map((slide) => ({
  ...slide,
  src: slide.url.startsWith('/') ? slide.url : heroImageSrc(slide.url),
  srcMobile: slide.url.startsWith('/') ? slide.url : heroImageSrc(slide.url, 900),
})) as readonly (HomeHeroSlide & { src: string; srcMobile: string })[];

/** Tarjetas de marketing cuando la cartelera está vacía (no son eventos reales). */
export type CuratedMarketingCard = {
  title: string;
  subtitle: string;
  href: string;
  image: string;
};

export const CURATED_MARKETING_CARDS: readonly CuratedMarketingCard[] = [
  {
    title: 'Conciertos en vivo',
    subtitle: 'Rock, pop, indie y más',
    href: '/categoria/MUSIC',
    image: EVENT_STOCK_IMAGES.MUSIC,
  },
  {
    title: 'Festivales',
    subtitle: 'Varios días, varios escenarios',
    href: '/categoria/FESTIVAL',
    image: EVENT_STOCK_IMAGES.FESTIVAL,
  },
  {
    title: 'Electrónica & DJs',
    subtitle: 'Clubes y festivales nocturnos',
    href: '/categoria/MUSIC',
    image: EVENT_STOCK_IMAGES.ELECTRO,
  },
  {
    title: 'Deportes',
    subtitle: 'Liga MX, NBA y eventos en vivo',
    href: '/categoria/SPORTS',
    image: EVENT_STOCK_IMAGES.SPORTS,
  },
] as const;

/** Fotos de ciudades para tarjetas de la home (fallback por gradiente si no hay match). */
export const CITY_STOCK_IMAGES: Record<string, string> = {
  'Ciudad de México':
    'https://images.unsplash.com/photo-1518654842511-9a1f7e4c8735?auto=format&fit=crop&w=800&q=80',
  CDMX:
    'https://images.unsplash.com/photo-1518654842511-9a1f7e4c8735?auto=format&fit=crop&w=800&q=80',
  Monterrey:
    'https://images.unsplash.com/photo-1583422409516-2895a77efded?auto=format&fit=crop&w=800&q=80',
  Guadalajara:
    'https://images.unsplash.com/photo-1595458258940-d09f334b9f58?auto=format&fit=crop&w=800&q=80',
  Puebla:
    'https://images.unsplash.com/photo-1585464231875-d8ef2f4d5041?auto=format&fit=crop&w=800&q=80',
  Cancún:
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
  'Playa del Carmen':
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
  Tijuana:
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80',
  Querétaro:
    'https://images.unsplash.com/photo-1469854523086-cc02afe5c880?auto=format&fit=crop&w=800&q=80',
  León:
    'https://images.unsplash.com/photo-1469854523086-cc02afe5c880?auto=format&fit=crop&w=800&q=80',
};

export function cityStockImage(city: string): string | undefined {
  return CITY_STOCK_IMAGES[city];
}

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
