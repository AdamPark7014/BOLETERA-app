'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { flatSeats, normalizeSeatMap } from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import { getVenueLayout } from '@/lib/platform-api';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../../../events/_shared/api-state';
import platform from '../../../_styles/platform.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

export default function Venue3DPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const layoutVersion = searchParams.get('v') ?? '0';
  const [mapData, setMapData] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const session = useSession();
  const token = session.token;

  useEffect(() => {
    if (!token || !venueId) return;
    setError(null);
    getVenueLayout(token, venueId)
      .then((data) => {
        setMapData(data.layout.mapData);
        setVenueName(data.venue?.name ?? 'Venue');
      })
      .catch(setError);
  }, [venueId, token, nonce, layoutVersion]);

  const normalized = useMemo(() => (mapData ? normalizeSeatMap(mapData) : null), [mapData]);
  const seats = useMemo(() => {
    if (!normalized) return [];
    return flatSeats(normalized).map((seat) => ({
      id: seat.id,
      label: seat.label,
      x: seat.x,
      y: seat.y,
      z: seat.position?.y ?? seat.elevation ?? 0,
      section: seat.sectionName,
      row: seat.row,
      color: seat.sectionColor,
      rotation: seat.rotation,
      elevation: seat.elevation,
      position: seat.position,
      rotation3d: seat.rotation3d,
      coord3d: seat.coord3d,
      visibility: seat.visibility,
      status: seat.visibility?.blocked ? ('blocked' as const) : ('available' as const),
      levelId: seat.levelId,
    }));
  }, [normalized]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="cargar el mapa del recinto"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Preview 3D — {venueName || 'Venue'}</h1>
          <p>{seats.length} asientos reales del layout guardado</p>
        </div>
        <Link href={`/venues/${venueId}/map`} className={platform.ghostBtn}>
          Editar mapa 2D
        </Link>
        {layoutVersion !== '0' && (
          <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Layout v{layoutVersion}</span>
        )}
      </header>
      {!mapData ? (
        <LoadingView label="Cargando recinto…" />
      ) : seats.length === 0 ? (
        <p>Este venue todavía no tiene asientos en su layout. Ve al editor de mapa y aplica una plantilla.</p>
      ) : (
        <Venue3DViewer
          mode="orbit"
          seats={seats}
          height={620}
          stage={normalized?.venue?.stage}
          aisles={normalized?.venue?.aisles}
          obstacles={normalized?.venue?.obstacles}
          stairs={normalized?.venue?.stairs}
          exits={normalized?.venue?.exits}
          furniture={normalized?.venue?.furniture}
          focusPoints={normalized?.venue?.focusPoints}
          levels={normalized?.venue?.levels}
          mapData={normalized}
        />
      )}
    </div>
  );
}
