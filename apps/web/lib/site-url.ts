import { headers } from 'next/headers';
import { fetchTenantCurrent } from './tenant';

const FALLBACK_ORIGIN = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000';

/**
 * Absolute origin for the visitor's storefront (tenant host), not a hardcoded
 * NEXT_PUBLIC_WEB_URL. Used by metadataBase, sitemap, robots, OG and JSON-LD.
 */
export async function getSiteOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host =
      h.get('x-forwarded-host')?.split(',')[0]?.trim() ||
      h.get('x-tenant-host')?.split(',')[0]?.trim() ||
      h.get('host')?.trim() ||
      undefined;

    if (host) {
      const proto =
        h.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
        (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
      return `${proto}://${host}`.replace(/\/$/, '');
    }
  } catch {
    // Outside a request (build/static): fall through.
  }

  const tenant = await fetchTenantCurrent();
  const custom = tenant.theme?.customDomain?.trim();
  if (custom) {
    const host = custom.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return `https://${host}`;
  }

  return FALLBACK_ORIGIN.replace(/\/$/, '');
}

/** Absolute URL for a path on the current tenant origin. */
export async function absoluteUrl(path = '/'): Promise<string> {
  const origin = await getSiteOrigin();
  if (!path || path === '/') return `${origin}/`;
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Sync absolutizer when the origin is already known (event page, JSON-LD). */
export function absUrlWithOrigin(origin: string, path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const base = origin.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
