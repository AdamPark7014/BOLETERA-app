import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { VenueShowcase } from './VenueShowcase';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  try {
    const venue = await api<{ name?: string }>(`/discovery/venues/${slug}`);
    return { title: venue?.name ? `${venue.name} · 3D` : 'Recinto · 3D' };
  } catch {
    return { title: 'Recinto · 3D' };
  }
}

export default async function Venue3DPage({ params }: Params) {
  const { slug } = await params;
  let venue: { name?: string; slug?: string } | null = null;
  try {
    venue = await api(`/discovery/venues/${slug}`);
  } catch {
    notFound();
  }
  if (!venue) notFound();
  return <VenueShowcase slug={slug} venueName={venue.name || slug} />;
}
