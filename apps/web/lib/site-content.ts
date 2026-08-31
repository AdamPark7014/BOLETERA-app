import { defaultSiteContent, type SiteContent } from '@boletera/shared';
import { api } from './api';

export async function fetchSiteContent(): Promise<SiteContent> {
  try {
    return await api<SiteContent>('/discovery/site-content');
  } catch {
    return defaultSiteContent();
  }
}

export function heroSlidesToSrc(
  slides: SiteContent['heroSlides'],
): Array<{ url: string; src: string; srcMobile: string; label: string; alt: string }> {
  return slides.map((slide) => ({
    ...slide,
    src: slide.url,
    srcMobile: slide.url,
  }));
}
