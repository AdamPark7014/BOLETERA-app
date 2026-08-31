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
  /** Titular del hero; si falta, la web usa el copy por defecto. */
  heroHeadline?: string;
  /** Subcopy del hero; si falta, la web usa el copy por defecto. */
  heroSubcopy?: string;
};

function isCuratedCard(value: unknown): value is CuratedMarketingCard {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.title === 'string' &&
    c.title.trim().length > 0 &&
    typeof c.subtitle === 'string' &&
    typeof c.href === 'string' &&
    c.href.trim().length > 0 &&
    typeof c.image === 'string' &&
    c.image.trim().length > 0
  );
}

function parseCuratedCards(raw: unknown): CuratedMarketingCard[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(isCuratedCard).map((c) => ({
    title: c.title.trim(),
    subtitle: c.subtitle.trim(),
    href: c.href.trim(),
    image: c.image.trim(),
  }));
}

function parseCityImages(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const city = key.trim();
    if (!city || typeof value !== 'string' || !value.trim()) continue;
    out[city] = value.trim();
  }
  return out;
}

function parseOptionalCopy(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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

  const curatedParsed = parseCuratedCards(o.curatedCards);
  const curatedCards =
    curatedParsed !== null ? curatedParsed : defaultSiteContent().curatedCards;

  const cityParsed = parseCityImages(o.cityImages);
  const cityImages =
    cityParsed !== null ? cityParsed : defaultSiteContent().cityImages;

  if (!heroSlides.length) return null;

  const heroHeadline = parseOptionalCopy(o.heroHeadline);
  const heroSubcopy = parseOptionalCopy(o.heroSubcopy);

  return {
    heroSlides,
    curatedCards,
    cityImages,
    ...(heroHeadline ? { heroHeadline } : {}),
    ...(heroSubcopy ? { heroSubcopy } : {}),
  };
}

export function mergeSiteContent(raw: unknown): SiteContent {
  return parseSiteContent(raw) ?? defaultSiteContent();
}

/**
 * Tarjetas de marketing: CMS si hay al menos una; si no, stock compartido.
 */
export function resolveCuratedCards(
  content: Pick<SiteContent, 'curatedCards'> | null | undefined,
): CuratedMarketingCard[] {
  if (content?.curatedCards?.length) return content.curatedCards;
  return [...CURATED_MARKETING_CARDS];
}

/**
 * Foto de ciudad: CMS por nombre exacto, luego stock, luego fallback.
 */
export function resolveCityImage(
  city: string,
  content: Pick<SiteContent, 'cityImages'> | null | undefined,
  fallback: string,
): string {
  const fromCms = content?.cityImages?.[city]?.trim();
  if (fromCms) return fromCms;
  const fromStock = CITY_STOCK_IMAGES[city];
  if (fromStock) return fromStock;
  return fallback;
}
