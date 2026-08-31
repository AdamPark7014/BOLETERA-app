import { cache, type CSSProperties } from 'react';
import { api } from './api';

export type TenantThemeSnapshot = {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  subdomain?: string | null;
  customDomain?: string | null;
};

export type TenantCurrent = {
  id: string;
  name: string;
  slug: string;
  theme: TenantThemeSnapshot | null;
};

export const FALLBACK_TENANT: TenantCurrent = {
  id: '',
  name: 'BOLETERA',
  slug: 'boletera',
  theme: null,
};

/** Dedupes layout + footer (and any other SSR callers) in the same request. */
export const fetchTenantCurrent = cache(async (): Promise<TenantCurrent> => {
  try {
    const data = await api<TenantCurrent & { error?: string }>('/tenant/current');
    if (data.error || !data.name) return FALLBACK_TENANT;
    return {
      id: data.id,
      name: data.name,
      slug: data.slug,
      theme: data.theme ?? null,
    };
  } catch {
    return FALLBACK_TENANT;
  }
});

/** CSS custom properties from TenantTheme (primary → accent, secondary → hover). */
export function tenantThemeStyle(
  theme: TenantThemeSnapshot | null | undefined,
): CSSProperties {
  const style: Record<string, string> = {};
  const primary = theme?.primaryColor?.trim();
  const secondary = theme?.secondaryColor?.trim();
  if (primary) {
    style['--bl-accent'] = primary;
    style['--color-accent'] = primary;
  }
  if (secondary) {
    style['--bl-accent-hover'] = secondary;
    style['--color-accent-hover'] = secondary;
  }
  return style as CSSProperties;
}
