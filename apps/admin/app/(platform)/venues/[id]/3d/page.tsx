'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { flatSeats, normalizeSeatMap } from '@boletera/venue-engine';
import type { LayoutPublishStatusValue } from '@boletera/shared';
import type { SeatMapData } from '@boletera/shared';
import { getVenueLayout } from '@/lib/platform-api';
import { ApiStateBoundary, useSession } from '../../../events/_shared/api-state';
import { AdminFrame } from '../../../events/_ticket/AdminFrame';
import frame from '../../../events/_ticket/frame.module.scss';
import { formatCount } from '../../../events/_ticket/read';
import styles from './venue-3d.module.scss';

const Venue3DViewer = dynamic(() => import('@boletera/venue-3d').then((m) => m.Venue3DViewer), {
  ssr: false,
});

const STATUS_LABEL: Record<LayoutPublishStatusValue, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Archivado',
};

export default function Venue3DPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <Venue3DBody />
      </AdminFrame>
    </Suspense>
  );
}

function Venue3DBody() {
  const { id: venueId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const layoutVersionParam = searchParams.get('v') ?? '0';
  const [mapData, setMapData] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');
  const [publishStatus, setPublishStatus] = useState<LayoutPublishStatusValue>('DRAFT');
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
        setVenueName(data.venue?.name ?? 'Recinto');
        if (data.layout.publishStatus) setPublishStatus(data.layout.publishStatus);
      })
      .catch(setError);
  }, [venueId, token, nonce, layoutVersionParam]);

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

  if (session.status !== 'ready' || error || !mapData || !token) {
    return (
      <ApiStateBoundary
        session={session}
        error={error}
        loading={!mapData}
        context="cargar el mapa del recinto"
        onRetry={() => setNonce((n) => n + 1)}
        loadingLabel="Cargando recinto…"
      >
        <span />
      </ApiStateBoundary>
    );
  }

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Vista 3D · {venueName}</h1>
        <p className={frame.quiet}>
          {STATUS_LABEL[publishStatus]}
          {layoutVersionParam !== '0' ? ` · layout v${layoutVersionParam}` : ''} ·{' '}
          {formatCount(seats.length)} asientos
        </p>
        <p className={frame.tertiary}>
          Vista interactiva del layout guardado. Se lee aquí; se edita en el mapa 2D.
        </p>
        <p className={styles.links}>
          <Link href={`/venues/${venueId}/map`} className={styles.inlineLink}>
            Editar mapa 2D
          </Link>
          <Link href="/venues" className={styles.inlineLink}>
            Recintos
          </Link>
        </p>
      </header>

      {seats.length === 0 ? (
        <p className={frame.quiet}>
          Este recinto todavía no tiene asientos en su layout. Ve al editor de mapa y aplica una
          plantilla.
        </p>
      ) : (
        <div className={styles.viewer}>
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
        </div>
      )}
    </section>
  );
}
