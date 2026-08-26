'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { flatSeats, normalizeSeatMap } from '@boletera/venue-engine';
import type { LayoutPublishStatusValue } from '@boletera/shared';
import type { SeatMapData } from '@boletera/shared';
import { Badge, Button, PageHeader, type BadgeTone } from '@boletera/ui';
import { getVenueLayout } from '@/lib/platform-api';
import { ApiStateBoundary, useSession } from '../../../events/_shared/api-state';
import styles from '../../venues.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

const STATUS_LABEL: Record<LayoutPublishStatusValue, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Archivado',
};

function publishStatusTone(status: LayoutPublishStatusValue): BadgeTone {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'IN_REVIEW':
      return 'info';
    case 'ARCHIVED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export default function Venue3DPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
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
        setVenueName(data.venue?.name ?? 'Venue');
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
    <div className={styles.studioPage}>
      <PageHeader
        eyebrow={
          <span className={styles.statusRow}>
            <Badge tone={publishStatusTone(publishStatus)} variant="soft">
              {STATUS_LABEL[publishStatus]}
            </Badge>
            {layoutVersionParam !== '0' ? (
              <Badge tone="neutral" variant="soft">
                Layout v{layoutVersionParam}
              </Badge>
            ) : null}
            <Badge tone="info" variant="soft">
              {seats.length} asientos
            </Badge>
          </span>
        }
        title={`Preview 3D — ${venueName}`}
        breadcrumbs={[
          { label: 'Recintos', href: '/venues' },
          { label: venueName, href: `/venues/${venueId}/map` },
          { label: 'Vista 3D' },
        ]}
        description="Vista interactiva 3D del layout guardado"
        actions={
          <div className={styles.studioActions}>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/venues/${venueId}/map`)}
            >
              Editar mapa 2D
            </Button>
          </div>
        }
      />

      {seats.length === 0 ? (
        <p>
          Este venue todavía no tiene asientos en su layout. Ve al editor de mapa y aplica una
          plantilla.
        </p>
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
