'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { NamedStatus, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Segment } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString } from '../events/_ticket/read';

const STATUS: Record<string, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Archivo',
};

const STATUS_ORDER = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;

type VenueRow = { id: string; name: string; hasLayout: boolean };

type SectionRow = {
  id: string;
  name: string;
  slug: string;
  color: string;
  sortOrder: number;
  seats: number;
  accessible: number;
  shaped: boolean;
};

type SnapshotRow = {
  id: string;
  version: number | null;
  label: string | null;
  createdAt: string | null;
};

type LayoutView = {
  name: string;
  version: number | null;
  status: string;
  publishedBy: string | null;
  archivedBy: string | null;
  sections: SectionRow[];
  snapshots: SnapshotRow[];
};

function word(value: string): string {
  return STATUS[value] ?? value;
}

function transition(from: string, to: string): 'submit-review' | 'revert-draft' | 'publish-map' | 'archive' | null {
  if (to === 'IN_REVIEW' && from === 'DRAFT') return 'submit-review';
  if (to === 'DRAFT' && from === 'IN_REVIEW') return 'revert-draft';
  if (to === 'PUBLISHED' && (from === 'DRAFT' || from === 'IN_REVIEW')) return 'publish-map';
  if (to === 'ARCHIVED' && from === 'PUBLISHED') return 'archive';
  return null;
}

function readVenue(raw: unknown): VenueRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const layouts = Array.isArray(row.layouts) ? row.layouts : [];
  return { id, name, hasLayout: layouts.length > 0 };
}

function readSection(raw: unknown): SectionRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const seats = Array.isArray(row.seats) ? row.seats : [];
  const accessible = seats.filter((seat) => asRecord(seat).accessible === true).length;
  const meta = asRecord(row.metadata);
  return {
    id,
    name,
    slug: readString(row.slug) ?? '—',
    color: readString(row.color) ?? '#737373',
    sortOrder: readNumber(row.sortOrder) ?? 0,
    seats: seats.length,
    accessible,
    shaped: Object.keys(meta).length > 0,
  };
}

function readSnapshot(raw: unknown): SnapshotRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  if (!id) return null;
  return {
    id,
    version: readNumber(row.version),
    label: readString(row.label),
    createdAt: readString(row.createdAt),
  };
}

function readLayout(payload: unknown, workflow: unknown): LayoutView | null {
  const root = asRecord(payload);
  const layout = asRecord(root.layout);
  const id = readString(layout.id);
  if (!id) return null;
  const flow = asRecord(workflow);
  const snapshots = Array.isArray(flow.snapshots) ? flow.snapshots : [];
  const sections = Array.isArray(layout.sections) ? layout.sections : [];
  return {
    name: readString(layout.name) ?? '—',
    version: readNumber(layout.version),
    status: readString(layout.publishStatus) ?? 'DRAFT',
    publishedBy: readString(layout.publishedBy),
    archivedBy: readString(layout.archivedBy),
    sections: sections.flatMap((item) => {
      const section = readSection(item);
      return section ? [section] : [];
    }),
    snapshots: snapshots.flatMap((item) => {
      const snapshot = readSnapshot(item);
      return snapshot ? [snapshot] : [];
    }),
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function MapsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <MapaBody />
      </AdminFrame>
    </Suspense>
  );
}

function MapaBody() {
  const session = useSession();
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutView | null>(null);
  const [status, setStatus] = useState('DRAFT');
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'venues.view');
  const canEdit = hasCapability(session.role, 'venues.editMap');

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>('/admin/venues', token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const venue = readVenue(item);
          return venue ? [venue] : [];
        });
        setVenues(next);
        setVenueId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, session.status, nonce]);

  useEffect(() => {
    const venue = venues.find((item) => item.id === venueId);
    if (!token || !venueId || !canSee || !venue?.hasLayout) {
      setLayout(null);
      return;
    }
    let alive = true;
    setLayout(null);
    setLayoutError(null);
    adminApi<unknown>(`/venues/${venueId}/layout`, token)
      .then(async (payload) => {
        const workflow = await adminApi<unknown>(`/venues/${venueId}/layout/workflow`, token);
        if (!alive) return;
        const next = readLayout(payload, workflow);
        setLayout(next);
        if (next) setStatus(next.status);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setLayout(null);
        setLayoutError(failMessage(cause));
      });
    return () => {
      alive = false;
    };
  }, [token, venueId, venues, canSee, nonce]);

  const step = layout ? transition(layout.status, status) : null;
  const illegal = layout != null && status !== layout.status && step == null;

  async function save() {
    if (!token || !venueId || !step || saving || !canEdit) return;
    setSaving(true);
    setActionError(null);
    try {
      await adminApi(`/venues/${venueId}/layout/${step}`, token, { method: 'POST', body: '{}' });
      setNotice(`Estado del plano: ${word(layout?.status ?? '')} → ${word(status)}`);
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Mapa</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir mapas" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando mapas.</p>;

  const seats = layout?.sections.reduce((sum, section) => sum + section.seats, 0) ?? 0;
  const who = layout?.publishedBy ?? layout?.archivedBy;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Mapa</h1>
        <p className={styles.quiet}>
          El estado se guarda con el paso que el API ya tiene. La geometría se ajusta en el plano.
        </p>
      </header>
      {venues.length === 0 ? <p className={styles.quiet}>No hay recintos.</p> : null}
      <div className={styles.stack}>
        {venues.map((venue) => {
          const open = venue.id === venueId;
          return (
            <button
              key={venue.id}
              type="button"
              className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
              aria-expanded={open}
              onClick={() => {
                setVenueId(venue.id);
                setNotice(null);
              }}
            >
              <span>{venue.name}</span>
              <span className={styles.figure}>{open ? 'Abierto' : 'Abrir'}</span>
            </button>
          );
        })}
      </div>
      {layoutError ? (
        <p className={styles.danger} role="alert">
          {layoutError}
        </p>
      ) : null}
      {venueId && venues.find((item) => item.id === venueId)?.hasLayout && !layout && !layoutError ? (
        <p className={styles.quiet}>Cargando plano.</p>
      ) : null}
      {venueId && venues.find((item) => item.id === venueId)?.hasLayout === false ? (
        <div className={styles.stack}>
          <p className={styles.quiet}>Este recinto no tiene plano.</p>
          <Link href={`/venues/${venueId}/map`} className={styles.link}>
            Abrir el plano
          </Link>
        </div>
      ) : null}
      {layout ? (
        <div className={styles.stack}>
          <Param name="Nombre del plano">
            <ParameterCard
              name="Nombre del plano"
              value={layout.name}
              effect="Esta ruta no lo renombra."
            />
          </Param>
          <Param name="Versión">
            <ParameterCard
              name="Versión"
              value={formatCount(layout.version)}
              valueStyle="tabular"
              effect="Sube al publicar."
            />
          </Param>
          <Param name="Geometría">
            <ParameterCard
              name="Geometría"
              value={`${formatCount(layout.sections.length)} secciones · ${formatCount(seats)} butacas`}
              valueStyle="tabular"
              effect="Fila, butaca, posición y accesible se ajustan en el plano. La foto de la compra no viene en esta lectura."
            >
              {venueId ? (
                <Link href={`/venues/${venueId}/map`} className={styles.link}>
                  Abrir el plano
                </Link>
              ) : null}
            </ParameterCard>
          </Param>
          <Param name="Leyenda">
            <ParameterCard
              name="Leyenda"
              value="Libre · Apartado · Vendido · Bloqueado · Accesible · Seleccionado"
              effect="Seleccionado es el anillo de esta sesión. No hay degradado de ocupación."
            >
              <NamedStatus status="libre" />
              <NamedStatus status="apartado" />
              <NamedStatus status="vendido" />
              <NamedStatus status="bloqueado" />
              <NamedStatus status="accesible" />
            </ParameterCard>
          </Param>
          <Param name="Estado del plano">
            <ParameterCard name="Estado del plano" value={word(status)} effect="Borrador, en revisión, publicado o archivo.">
              {canEdit ? (
                <Segment
                  label="Estado del plano"
                  value={status}
                  options={STATUS_ORDER.map((value) => ({ value, label: word(value) }))}
                  onChange={(next) => {
                    setStatus(next);
                    setNotice(null);
                    setActionError(null);
                  }}
                />
              ) : null}
            </ParameterCard>
          </Param>
          <Param name="Quién publicó o archivó">
            <ParameterCard
              name="Quién publicó o archivó"
              value={who ?? '—'}
              valueStyle="mono"
              effect="Identificador que guardó el servicio."
            />
          </Param>
          {layout.sections.map((section) => {
            const open = openSection === section.id;
            return (
              <div key={section.id} className={styles.stack}>
                <button
                  type="button"
                  className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                  aria-expanded={open}
                  onClick={() => setOpenSection(open ? null : section.id)}
                >
                  <span>{section.name}</span>
                  <span className={styles.figure}>{formatCount(section.seats)}</span>
                </button>
                {open ? (
                  <div className={styles.stack}>
                    <Param name="Nombre de la sección">
                      <ParameterCard name="Nombre de la sección" value={section.name} effect="La zona del plano se nombra." />
                    </Param>
                    <Param name="Slug de la sección">
                      <ParameterCard name="Slug de la sección" value={section.slug} valueStyle="mono" effect="Único en el plano." />
                    </Param>
                    <Param name="Color de la sección">
                      <ParameterCard
                        name="Color de la sección"
                        value={section.color}
                        valueStyle="mono"
                        effect="La columna existe. El plano no rellena la zona con este color."
                      />
                    </Param>
                    <Param name="Orden de la sección">
                      <ParameterCard
                        name="Orden de la sección"
                        value={formatCount(section.sortOrder)}
                        valueStyle="tabular"
                        effect="Orden guardado."
                      />
                    </Param>
                    <Param name="Silueta">
                      <ParameterCard
                        name="Silueta"
                        value={section.shaped ? 'En el plano' : '—'}
                        effect="El contorno no se teclea aquí."
                      />
                    </Param>
                    <Param name="Accesible">
                      <ParameterCard
                        name="Accesible"
                        value={formatCount(section.accessible)}
                        valueStyle="tabular"
                        effect="Butacas con el glifo. El interruptor de cada una está en el plano."
                      />
                    </Param>
                  </div>
                ) : null}
              </div>
            );
          })}
          {layout.snapshots.length === 0 ? (
            <Param name="Etiqueta del snapshot">
              <ParameterCard name="Etiqueta del snapshot" value="Ninguna" effect="Aún no hay una instantánea." />
            </Param>
          ) : (
            layout.snapshots.map((snapshot) => (
              <Param key={snapshot.id} name="Etiqueta del snapshot">
                <ParameterCard
                  name="Etiqueta del snapshot"
                  value={snapshot.label ?? 'Sin etiqueta'}
                  effect={`Versión ${formatCount(snapshot.version)} · ${formatWhen(snapshot.createdAt)}`}
                />
              </Param>
            ))
          )}
          <Param name="Foto del evento">
            <ParameterCard
              name="Foto del evento"
              value="—"
              effect="La sala que ve la compra es otra fila. Esta lectura es el plano vivo."
            />
          </Param>
        </div>
      ) : null}
      {illegal ? (
        <p className={styles.danger} role="alert">
          Ese cambio de estado no lo hace el API.
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {canEdit && layout ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {step ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!step || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
