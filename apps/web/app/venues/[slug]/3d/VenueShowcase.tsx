'use client';

import Link from 'next/link';
import { Venue3DMount } from '@/components/venue3d/Venue3DMount';
import { hasWebGL } from '@/components/venue3d/webgl';

type Props = {
  slug: string;
  venueName: string;
};

/** Showcase 3D del recinto (WIP visual). No interviene en compra ni reventa. */
export function VenueShowcase({ slug, venueName }: Props) {
  const ok = hasWebGL();
  return (
    <Venue3DMount>
      <div style={{ padding: 24, color: '#f5f0e8' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>{venueName}</h1>
        {!ok ? (
          <p>Este dispositivo no puede mostrar el mapa 3D.</p>
        ) : (
          <p>Vista 3D del recinto en preparación.</p>
        )}
        <p>
          <Link href={`/venues/${slug}`}>Volver al recinto</Link>
        </p>
      </div>
    </Venue3DMount>
  );
}
