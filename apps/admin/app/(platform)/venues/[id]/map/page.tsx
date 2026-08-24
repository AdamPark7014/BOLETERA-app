'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { LayoutPublishStatusValue } from '@boletera/shared';
import type { SeatMapData } from '@boletera/shared';
import { SeatMapEditor, type MapValidationState } from '@/components/SeatMapEditor';
import { LayoutPublishPanel } from '@/components/LayoutPublishPanel';
import {
  applyLayoutTemplate,
  suggestLayout,
  getVenueLayout,
  listEvents,
  publishEvent,
  saveVenueLayout,
  type VenueLayoutWorkflow,
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
  const [workflow, setWorkflow] = useState<VenueLayoutWorkflow | null>(null);
  const [publishStatus, setPublishStatus] = useState<LayoutPublishStatusValue>('DRAFT');
  const [validation, setValidation] = useState<MapValidationState>({
    ok: true,
    errorCount: 0,
    warningCount: 0,
  });
  const [layoutVersion, setLayoutVersion] = useState(0);
  const token = session.token;

  const onValidationChange = useCallback((state: MapValidationState) => {
    setValidation(state);
  }, []);

  const reloadLayout = useCallback(async () => {
    if (!token || !venueId) return;
    const data = await getVenueLayout(token, venueId);
    setMap(data.layout.mapData);
    setVenueName(data.venue?.name ?? 'Venue');
    if (data.layout.publishStatus) setPublishStatus(data.layout.publishStatus);
  }, [token, venueId]);

  useEffect(() => {
    if (!token || !venueId) return;
    setError(null);
    reloadLayout().catch(setError);
    listEvents(token)
      .then((list) => {
        const filtered = list.filter((e) => (e as { venueId?: string }).venueId === venueId);
        setEvents(filtered);
        if (filtered[0]) setPublishEventId(filtered[0].id);
      })
      .catch(() => setEvents([]));
  }, [venueId, token, nonce, reloadLayout]);

  const destructiveLocked = useMemo(
    () =>
      Boolean(
        workflow?.salesLocked &&
          (workflow.publishStatus === 'PUBLISHED' || publishStatus === 'PUBLISHED'),
      ),
    [workflow, publishStatus],
  );

  const readOnly = publishStatus === 'ARCHIVED';

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
                disabled={!validation.ok}
                title={
                  validation.ok
                    ? undefined
                    : `${validation.errorCount} error(es) en el mapa — corrígelos en el panel Validación`
                }
                onClick={async () => {
                  if (!token || !publishEventId) return;
                  if (!validation.ok) {
                    setPublishMsg(
                      `No se puede publicar: ${validation.errorCount} error(es) pendientes en el mapa.`,
                    );
                    return;
                  }
                  setPublishMsg(null);
                  try {
                    const r = await publishEvent(token, publishEventId);
                    setPublishMsg(`✓ ${r.totalSeats} boletos en ${r.sections} zonas`);
                  } catch (e) {
                    setPublishMsg(e instanceof Error ? e.message : 'Error');
                  }
                }}
              >
                Publicar inventario (evento)
              </button>
            </>
          )}
          <Link href={`/venues/${venueId}/3d?v=${layoutVersion}`} className={platform.ghostBtn}>
            Vista 3D
          </Link>
        </div>
      </header>

      <LayoutPublishPanel
        venueId={venueId}
        token={authToken}
        validationOk={validation.ok}
        validationErrorCount={validation.errorCount}
        onWorkflowChange={(w) => {
          setWorkflow(w);
          setPublishStatus(w.publishStatus);
        }}
        onMapReload={() => void reloadLayout()}
      />

      {publishMsg && <p style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>{publishMsg}</p>}

      <SeatMapEditor
        initial={map}
        venueId={venueId}
        publishStatus={publishStatus}
        destructiveLocked={destructiveLocked}
        readOnly={readOnly}
        getAuthToken={() => authToken}
        onValidationChange={onValidationChange}
        onSave={async (mapData) => {
          await saveVenueLayout(authToken, venueId, mapData);
          await reloadLayout();
          setLayoutVersion((v) => v + 1);
        }}
        onApplyTemplate={
          readOnly || destructiveLocked
            ? undefined
            : async (template) => {
                const result = await applyLayoutTemplate(authToken, venueId, template);
                setMap(result.layout.mapData);
                return result.layout.mapData;
              }
        }
        onAiSuggest={
          readOnly || destructiveLocked
            ? undefined
            : async (description) => {
                const result = await suggestLayout(authToken, venueId, description);
                setMap(result.layout.mapData);
                return result.layout.mapData;
              }
        }
      />
    </div>
  );
}
