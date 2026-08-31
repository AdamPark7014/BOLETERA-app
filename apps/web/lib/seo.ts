import type { Metadata } from 'next';
import { absoluteUrl, getSiteOrigin } from './site-url';
import { fetchTenantCurrent } from './tenant';

const DEFAULT_OG_IMAGE = '/hero/01-festival.jpg';

export type HubMetaInput = {
  /** Page title segment (tenant name is appended). */
  title: string;
  description: string;
  /** Canonical path, e.g. `/ciudades/CDMX`. */
  path: string;
  /** Relative or absolute image; defaults to local hero. */
  image?: string | null;
  index?: boolean;
};

/** Shared OG/Twitter/canonical metadata for hub and leaf pages. */
export async function buildHubMetadata(input: HubMetaInput): Promise<Metadata> {
  const [tenant, origin] = await Promise.all([fetchTenantCurrent(), getSiteOrigin()]);
  const title = input.title.includes(tenant.name)
    ? input.title
    : `${input.title} | ${tenant.name}`;
  const url = await absoluteUrl(input.path);
  const imagePath = input.image?.trim() || DEFAULT_OG_IMAGE;
  const image = /^https?:\/\//i.test(imagePath)
    ? imagePath
    : `${origin}${imagePath.startsWith('/') ? imagePath : `/${imagePath}`}`;

  return {
    title,
    description: input.description,
    metadataBase: new URL(origin),
    robots: input.index === false ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description: input.description,
      url,
      type: 'website',
      locale: 'es_MX',
      siteName: tenant.name,
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: input.description,
      images: [image],
    },
    alternates: { canonical: url },
  };
}

/** robots: noindex for cart / checkout / cuenta / orders. */
export function noIndexMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}
