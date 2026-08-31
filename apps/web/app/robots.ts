import type { MetadataRoute } from 'next';
import { getSiteOrigin } from '@/lib/site-url';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getSiteOrigin();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/cart', '/checkout', '/cuenta', '/orders', '/login'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
