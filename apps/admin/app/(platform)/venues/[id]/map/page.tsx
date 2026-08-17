'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { SeatMapData } from '@boletera/shared';
import { SeatMapEditor } from '@/components/SeatMapEditor';
import {
  applyLayoutTemplate,
  suggestLayout,
  getVenueLayout,
  listEvents,
  publishEvent,
  saveVenueLayout,
} from '@/lib/platform-api';
import { ApiStateBoundary, useSession } from '../../../events/_shared/api-state';
import platform from '../../../_styles/platform.module.scss';

export default function VenueMapEditorPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const session = useSession();
  const [map, setMap] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');
  const [events, setEvents] = useState<{ id: string; title: string; venueId?: string }[]>([]);
  const [publishEventId, setPublishEventId] = useState('');
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;

  useEffect(() => {
    if (!token || !venueId) return;
    setError(null);
    getVenueLayout(token, venueId)
      .then((data) => {
        setMap(data.layout.mapData);
        setVenueName(data.venue?.name ?? 'Venue');
      })
      // Un 403 dejaba «Cargando editor de mapa…» en pantalla indefinidamente.
      .catch(setError);
    listEvents(token)
      .then((list) => {
        const filtered = list.filter((e) => (e as { venueId?: string }).venueId === venueId);
        setEvents(filtered);
        if (filtered[0]) setPublishEventId(filtered[0].id);
      })
      .catch(() => setEvents([]));
  }, [venueId, token, nonce]);

  if (session.status !== 'ready' || error || !map || !token) {
    return (
      <ApiStateBoundary
        session={session}
        error={error}
        loading={!map}
        context="abrir el mapa del recinto"
        onRetry={() => setNonce((n) => n + 1)}
        loadingLabel="Cargando editor de mapa…"
      >
        <span />
      </ApiStateBoundary>
    );
  }

  // Tras la guarda el token existe: el editor lo recibe ya resuelto.
  const authToken: string = token;

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Diseñador de mapa — {venueName}</h1>
          <p>Plantillas, zoom/pan, secciones y publicación de inventario</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {events.length > 0 && (
            <>
              <select
                value={publishEventId}
                onChange={(e) => setPublishEventId(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: 8, border: '1px solid #d4d4d4' }}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={platform.primaryBtn}
                onClick={async () => {
                  if (!token || !publishEventId) return;
                  setPublishMsg(null);
                  try {
                    const r = await publishEvent(token, publishEventId);
                    setPublishMsg(`✓ ${r.totalSeats} boletos en ${r.sections} zonas`);
                  } catch (e) {
                    setPublishMsg(e instanceof Error ? e.message : 'Error');
                  }
                }}
              >
                Publicar en evento
              </button>
            </>
          )}
          <Link href={`/venues/${venueId}/3d`} className={platform.ghostBtn}>
            Vista 3D
          </Link>
        </div>
      </header>
      {publishMsg && <p style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>{publishMsg}</p>}

      <SeatMapEditor
        initial={map}
        venueId={venueId}
        // El token sale de la sesión ya resuelta; el `!` sobre `localStorage`
        // reventaba con «cannot read property of null» al vencer el JWT.
        getAuthToken={() => authToken}
        onSave={async (mapData) => {
          await saveVenueLayout(authToken, venueId, mapData);
          const refreshed = await getVenueLayout(authToken, venueId);
          setMap(refreshed.layout.mapData);
        }}
        onApplyTemplate={async (template) => {
          const result = await applyLayoutTemplate(authToken, venueId, template);
          setMap(result.layout.mapData);
          return result.layout.mapData;
        }}
        onAiSuggest={async (description) => {
          const result = await suggestLayout(authToken, venueId, description);
          setMap(result.layout.mapData);
          return result.layout.mapData;
        }}
      />
    </div>
  );
}
