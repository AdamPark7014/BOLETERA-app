import { defaultSiteContent, type SiteContent } from '@boletera/shared';
import { api } from './api';

const API_HOST = process.env.WEB_HOST || 'localhost:3040';

export async function fetchSiteContent(): Promise<SiteContent> {
  try {
    return await api<SiteContent>('/discovery/site-content', {
      headers: { host: API_HOST },
    });
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
