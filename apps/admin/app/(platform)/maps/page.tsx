'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment } from '../events/_ticket/controls';
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

function transition(
  from: string,
  to: string
): 'submit-review' | 'revert-draft' | 'publish-map' | 'archive' | null {
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
        setVenueId((current) =>
          current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)
        );
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
          <h1 className={styles.sectionTitle}>Planos de butacas</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir mapas"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) {
    return <div className={styles.skeleton} style={{ height: 420 }} aria-label="Cargando planos" />;
  }

  const seats = layout?.sections.reduce((sum, section) => sum + section.seats, 0) ?? 0;
  const accessible = layout?.sections.reduce((sum, section) => sum + section.accessible, 0) ?? 0;
  const who = layout?.publishedBy ?? layout?.archivedBy;
  const current = venues.find((item) => item.id === venueId);
  const statusChip = (value: string) =>
    value === 'PUBLISHED'
      ? styles.chipOk
      : value === 'IN_REVIEW'
        ? styles.chipGold
        : value === 'ARCHIVED'
          ? styles.chip
          : styles.chipWarn;

  return (
    <section className={styles.page}>
      <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
        <h1 className={styles.sectionTitle}>Planos de butacas</h1>
      </header>

      {venues.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Todavía no hay recintos</p>
          <p className={styles.quiet}>Cada recinto tiene su plano de butacas.</p>
          <Link href="/venues" className={styles.ghostLink}>
            Ver recintos
          </Link>
        </div>
      ) : (
        <nav className={styles.tabs} aria-label="Recinto">
          {venues.map((venue) => (
            <button
              key={venue.id}
              type="button"
              className={venue.id === venueId ? styles.tabOn : styles.tab}
              aria-pressed={venue.id === venueId}
              onClick={() => {
                setVenueId(venue.id);
                setNotice(null);
              }}
            >
              {venue.name}
            </button>
          ))}
        </nav>
      )}

      {layoutError ? (
        <p className={styles.danger} role="alert">
          {layoutError}
        </p>
      ) : null}
      {current?.hasLayout && !layout && !layoutError ? (
        <div className={styles.skeleton} style={{ height: 320 }} aria-label="Cargando plano" />
      ) : null}
      {current && current.hasLayout === false ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{current.name} aún no tiene plano</p>
          <p className={styles.quiet}>Dibújalo con secciones, filas y pasillos.</p>
          {canEdit ? (
            <Link href={`/venues/${current.id}/map`} className={styles.goldLink}>
              Crear plano
            </Link>
          ) : null}
        </div>
      ) : null}

      {layout && current ? (
        <>
          <div className={styles.panelHead} style={{ marginBottom: 0 }}>
            <div>
              <h2 className={styles.panelTitle}>{layout.name}</h2>
              <p className={styles.kpiNote} style={{ marginTop: 6 }}>
                <span className={statusChip(layout.status)}>{word(layout.status)}</span>
                <span>v{formatCount(layout.version)}</span>
                {who ? <span className={styles.mono}>{who}</span> : null}
              </p>
            </div>
            <div className={styles.toolbar} style={{ alignItems: 'center' }}>
              <Link href={`/venues/${current.id}/3d?studio=1`} className={styles.ghostLink}>
                Vista 3D
              </Link>
              <Link href={`/venues/${current.id}/map`} className={styles.goldLink}>
                {canEdit ? 'Abrir editor' : 'Ver plano'}
              </Link>
            </div>
          </div>

          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Butacas</p>
              <p className={styles.kpiValue}>{formatCount(seats)}</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Secciones</p>
              <p className={styles.kpiValue}>{formatCount(layout.sections.length)}</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Accesibles</p>
              <p
                className={styles.kpiValue}
                style={accessible === 0 ? { color: 'var(--warn)' } : undefined}
              >
                {formatCount(accessible)}
              </p>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Sección</th>
                  <th scope="col">Clave</th>
                  <th scope="col" className={styles.num}>
                    Butacas
                  </th>
                  <th scope="col" className={styles.num}>
                    Accesibles
                  </th>
                  <th scope="col">Contorno</th>
                </tr>
              </thead>
              <tbody>
                {layout.sections.map((section) => (
                  <tr key={section.id} data-param={section.name}>
                    <td>
                      <span className={styles.swatchCell}>
                        <span
                          className={styles.swatchDot}
                          style={{ background: section.color }}
                          aria-hidden="true"
                        />
                        <strong>{section.name}</strong>
                      </span>
                    </td>
                    <td>
                      <span className={styles.mono}>{section.slug}</span>
                    </td>
                    <td className={styles.num}>{formatCount(section.seats)}</td>
                    <td className={styles.num}>
                      {section.accessible > 0 ? formatCount(section.accessible) : '—'}
                    </td>
                    <td className={styles.quiet}>{section.shaped ? 'Dibujado' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.split}>
            <div className={`${styles.panel} ${styles.splitWide}`}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Versiones guardadas</h2>
              </div>
              {layout.snapshots.length === 0 ? (
                <p className={styles.quiet}>Aún no hay versiones guardadas.</p>
              ) : (
                <ul className={styles.plainList}>
                  {layout.snapshots.map((snapshot) => (
                    <li key={snapshot.id}>
                      <strong>v{formatCount(snapshot.version)}</strong>
                      <span>{snapshot.label ?? 'Sin etiqueta'}</span>
                      <span className={styles.quiet}>{formatWhen(snapshot.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={`${styles.panel} ${styles.splitNarrow}`}>
              <h2 className={styles.panelTitle}>Estado del plano</h2>
              {canEdit ? (
                <>
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
                  {illegal ? (
                    <p className={styles.danger} role="alert">
                      Ese paso no está permitido desde {word(layout.status).toLowerCase()}.
                    </p>
                  ) : null}
                  {actionError ? (
                    <p className={styles.danger} role="alert">
                      {actionError}
                    </p>
                  ) : null}
                  <div className={styles.toolbar} style={{ alignItems: 'center' }}>
                    <TicketButton
                      variant="secondary"
                      disabled={!step || saving}
                      onClick={() => void save()}
                    >
                      {saving ? 'Guardando' : 'Cambiar estado'}
                    </TicketButton>
                    {notice && !step ? <span className={styles.chipOk}>{notice}</span> : null}
                  </div>
                </>
              ) : (
                <p className={styles.quiet}>{word(layout.status)}</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
