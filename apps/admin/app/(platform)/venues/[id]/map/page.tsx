'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { LayoutPublishStatusValue } from '@boletera/shared';
import type { SeatMapData } from '@boletera/shared';
import { NamedStatus, TicketButton } from '@boletera/ui';
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
import { AdminFrame } from '../../../events/_ticket/AdminFrame';
import { SheetSelect } from '../../../events/_ticket/controls';
import frame from '../../../events/_ticket/frame.module.scss';
import styles from '../../venues.module.scss';

const STATUS_LABEL: Record<LayoutPublishStatusValue, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Archivo',
};

function failMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return 'No se guardó. Revisa la conexión.';
}

export default function VenueMapEditorPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EditorBody />
      </AdminFrame>
    </Suspense>
  );
}

function EditorBody() {
  const { id: venueId } = useParams<{ id: string }>();
  const router = useRouter();
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const token = session.token;

  const onValidationChange = useCallback((state: MapValidationState) => {
    setValidation(state);
  }, []);

  const bindSave = useCallback((save: () => Promise<boolean>) => {
    saveRef.current = save;
  }, []);

  const onDirtyChange = useCallback((next: boolean) => {
    setDirty(next);
    if (next) setNotice(null);
  }, []);

  const onSavingChange = useCallback((next: boolean) => {
    setSaving(next);
  }, []);

  const reloadLayout = useCallback(async () => {
    if (!token || !venueId) return;
    const data = await getVenueLayout(token, venueId);
    setMap(data.layout.mapData);
    setVenueName(data.venue?.name ?? 'Recinto');
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

  async function save() {
    if (saving || readOnly || !dirty) return;
    setActionError(null);
    try {
      const saved = await saveRef.current();
      if (saved) setNotice('Geometría guardada.');
    } catch (cause) {
      setNotice(null);
      setActionError(failMessage(cause));
    }
  }

  async function publishInventory() {
    if (!token || !publishEventId || !validation.ok || publishing) return;
    setPublishMsg(null);
    setActionError(null);
    setPublishing(true);
    try {
      const result = await publishEvent(token, publishEventId);
      setPublishMsg(`${result.totalSeats} boletos en ${result.sections} zonas`);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setPublishing(false);
    }
  }

  if (session.status !== 'ready' || error || !map || !token) {
    return (
      <ApiStateBoundary
        session={session}
        error={error}
        loading={!map}
        context="abrir el mapa del recinto"
        onRetry={() => setNonce((n) => n + 1)}
        loadingLabel="Cargando el plano."
      >
        <span />
      </ApiStateBoundary>
    );
  }

  const authToken: string = token;
  const version = workflow?.version;

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Mapa</h1>
        <p className={frame.quiet}>
          {venueName} · {STATUS_LABEL[publishStatus]}
          {version != null ? ` · v${version}` : ''}
          {destructiveLocked ? ' · Ventas activas' : ''}
          {!validation.ok
            ? ` · ${validation.errorCount} errores`
            : validation.warningCount > 0
              ? ` · ${validation.warningCount} avisos`
              : ''}
        </p>
      </header>

      <div className={styles.legend} aria-label="Leyenda del plano">
        <NamedStatus status="libre" />
        <NamedStatus status="apartado" />
        <NamedStatus status="vendido" />
        <NamedStatus status="bloqueado" />
        <NamedStatus status="accesible" />
      </div>
      <p className={frame.quiet}>
        Seleccionado es el anillo de esta sesión. No hay degradado de ocupación.
      </p>

      <LayoutPublishPanel
        venueId={venueId}
        token={authToken}
        validationOk={validation.ok}
        validationErrorCount={validation.errorCount}
        onWorkflowChange={(next) => {
          setWorkflow(next);
          setPublishStatus(next.publishStatus);
        }}
        onMapReload={() => void reloadLayout()}
      />

      <div className={styles.editorActions}>
        {events.length > 1 ? (
          <SheetSelect
            label="Evento"
            value={publishEventId}
            placeholder="Elige la función"
            options={events.map((event) => ({ value: event.id, label: event.title }))}
            onChange={(next) => {
              setPublishEventId(next);
              setPublishMsg(null);
            }}
          />
        ) : null}
        {events.length > 0 ? (
          <TicketButton
            variant="secondary"
            disabled={!validation.ok || !publishEventId || publishing}
            onClick={() => void publishInventory()}
          >
            {publishing ? 'Publicando…' : 'Publicar inventario'}
          </TicketButton>
        ) : null}
        <TicketButton
          variant="secondary"
          onClick={() => router.push(`/venues/${venueId}/3d?v=${layoutVersion}`)}
        >
          Vista 3D
        </TicketButton>
      </div>

      {publishMsg ? <p className={frame.quiet}>{publishMsg}</p> : null}
      {actionError ? (
        <p className={frame.danger} role="alert">
          {actionError}
        </p>
      ) : null}

      <SeatMapEditor
        initial={map}
        venueId={venueId}
        publishStatus={publishStatus}
        destructiveLocked={destructiveLocked}
        readOnly={readOnly}
        hideSaveButton
        getAuthToken={() => authToken}
        onValidationChange={onValidationChange}
        onBindSave={bindSave}
        onDirtyChange={onDirtyChange}
        onSavingChange={onSavingChange}
        onSave={async (mapData) => {
          await saveVenueLayout(authToken, venueId, mapData);
          await reloadLayout();
          setLayoutVersion((current) => current + 1);
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

      <div className={frame.saveBar}>
        <p className={frame.quiet} aria-live="polite">
          {dirty ? 'Sin guardar' : (notice ?? '')}
        </p>
        <TicketButton disabled={!dirty || saving || readOnly} onClick={() => void save()}>
          Guardar sección
        </TicketButton>
      </div>
    </section>
  );
}
