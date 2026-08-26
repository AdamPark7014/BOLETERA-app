'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { LayoutPublishStatusValue } from '@boletera/shared';
import type { SeatMapData } from '@boletera/shared';
import { Badge, Button, PageHeader, type BadgeTone } from '@boletera/ui';
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
import styles from '../../venues.module.scss';

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

export default function VenueMapEditorPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const session = useSession();
  const [map, setMap] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');
  const [events, setEvents] = useState<{ id: string; title: string; venueId?: string }[]>([]);
  const [publishEventId, setPublishEventId] = useState('');
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
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

  const validationHint = useMemo(() => {
    if (validation.ok) return undefined;
    return `${validation.errorCount} error(es) en el mapa — corrígelos en el panel Validación`;
  }, [validation.errorCount, validation.ok]);

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
    <div className={styles.studioPage}>
      <PageHeader
        eyebrow={
          <span className={styles.statusRow}>
            <Badge tone={publishStatusTone(publishStatus)} variant="soft">
              {STATUS_LABEL[publishStatus]}
            </Badge>
            {!validation.ok ? (
              <Badge tone="danger" variant="soft">
                {validation.errorCount} error(es)
              </Badge>
            ) : validation.warningCount > 0 ? (
              <Badge tone="warning" variant="soft">
                {validation.warningCount} aviso(s)
              </Badge>
            ) : null}
            {destructiveLocked ? (
              <Badge tone="warning" variant="soft">
                Ventas activas
              </Badge>
            ) : null}
          </span>
        }
        title={`Diseñador de mapa — ${venueName}`}
        breadcrumbs={[
          { label: 'Recintos', href: '/venues' },
          { label: venueName },
        ]}
        description="Plantillas, zoom/pan, secciones y publicación de inventario"
        actions={
          <div className={styles.studioActions}>
            {events.length > 0 ? (
              <div className={styles.actionGroup}>
                <label className={styles.selectField}>
                  <span className={styles.srOnly}>Evento para publicar inventario</span>
                  <select
                    value={publishEventId}
                    onChange={(e) => setPublishEventId(e.target.value)}
                    aria-label="Evento para publicar inventario"
                  >
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={!validation.ok || !publishEventId}
                  title={validationHint}
                  loading={publishing}
                  loadingLabel="Publicando…"
                  onClick={async () => {
                    if (!token || !publishEventId) return;
                    if (!validation.ok) {
                      setPublishMsg(
                        `No se puede publicar: ${validation.errorCount} error(es) pendientes en el mapa.`,
                      );
                      return;
                    }
                    setPublishMsg(null);
                    setPublishing(true);
                    try {
                      const r = await publishEvent(token, publishEventId);
                      setPublishMsg(`✓ ${r.totalSeats} boletos en ${r.sections} zonas`);
                    } catch (e) {
                      setPublishMsg(e instanceof Error ? e.message : 'Error');
                    } finally {
                      setPublishing(false);
                    }
                  }}
                >
                  Publicar inventario (evento)
                </Button>
              </div>
            ) : null}
            <Link href={`/venues/${venueId}/3d?v=${layoutVersion}`} className={styles.secondaryLink}>
              Vista 3D
            </Link>
          </div>
        }
      />

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

      {publishMsg ? <p className={styles.publishNotice}>{publishMsg}</p> : null}

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
