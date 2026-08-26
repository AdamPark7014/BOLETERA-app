import {
  CURATED_MARKETING_CARDS,
  CITY_STOCK_IMAGES,
  HOME_HERO_SLIDE_SRCS,
  type CuratedMarketingCard,
  type HomeHeroSlide,
} from './event-stock-images';

export type SiteHeroSlide = HomeHeroSlide & { url: string };

export type SiteContent = {
  heroSlides: SiteHeroSlide[];
  curatedCards: CuratedMarketingCard[];
  cityImages: Record<string, string>;
};

/** Contenido por defecto (local / Unsplash) cuando la org no ha configurado nada. */
export function defaultSiteContent(): SiteContent {
  return {
    heroSlides: HOME_HERO_SLIDE_SRCS.map(({ label, alt, src }) => ({
      url: src,
      label,
      alt,
    })),
    curatedCards: [...CURATED_MARKETING_CARDS],
    cityImages: { ...CITY_STOCK_IMAGES },
  };
}

export function parseSiteContent(raw: unknown): SiteContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const heroSlides = Array.isArray(o.heroSlides)
    ? o.heroSlides
        .filter((s): s is SiteHeroSlide => {
          if (!s || typeof s !== 'object') return false;
          const slide = s as Record<string, unknown>;
          return (
            typeof slide.url === 'string' &&
            slide.url.trim().length > 0 &&
            typeof slide.label === 'string' &&
            typeof slide.alt === 'string'
          );
        })
        .map((s) => ({
          url: s.url.trim(),
          label: s.label,
          alt: s.alt,
        }))
    : [];

  const curatedCards = Array.isArray(o.curatedCards)
    ? (o.curatedCards as CuratedMarketingCard[])
    : defaultSiteContent().curatedCards;

  const cityImages =
    o.cityImages && typeof o.cityImages === 'object' && !Array.isArray(o.cityImages)
      ? (o.cityImages as Record<string, string>)
      : defaultSiteContent().cityImages;

  if (!heroSlides.length) return null;

  return { heroSlides, curatedCards, cityImages };
}

export function mergeSiteContent(raw: unknown): SiteContent {
  return parseSiteContent(raw) ?? defaultSiteContent();
}
