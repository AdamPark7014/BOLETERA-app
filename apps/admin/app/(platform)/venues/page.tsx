'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import Link from 'next/link';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { formatLocalDateTime, parseLocalDateTime, zonedTimeToUtc } from '@boletera/shared';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { SheetSelect, Stepper, Switch } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import {
  asRecord,
  formatCount,
  formatWhen,
  readNumber,
  readString,
  yesNo,
} from '../events/_ticket/read';

const ZONES = [
  'America/Mexico_City',
  'America/Cancun',
  'America/Merida',
  'America/Monterrey',
  'America/Mazatlan',
  'America/Chihuahua',
  'America/Hermosillo',
  'America/Tijuana',
  'America/Bahia_Banderas',
  'America/Matamoros',
  'America/Ojinaga',
  'UTC',
] as const;

const ZONE_LABEL: Record<string, string> = {
  'America/Mexico_City': 'Ciudad de México',
  'America/Cancun': 'Cancún',
  'America/Merida': 'Mérida',
  'America/Monterrey': 'Monterrey',
  'America/Mazatlan': 'Mazatlán',
  'America/Chihuahua': 'Chihuahua',
  'America/Hermosillo': 'Hermosillo',
  'America/Tijuana': 'Tijuana',
  'America/Bahia_Banderas': 'Bahía de Banderas',
  'America/Matamoros': 'Matamoros',
  'America/Ojinaga': 'Ojinaga',
  UTC: 'UTC',
};

type Blackout = {
  id: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  blocking: boolean;
};

type Venue = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  totalCapacity: number | null;
  accessibilitySeats: number | null;
  premiumSeats: number | null;
  generalSeats: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  image: string | null;
  blackouts: Blackout[];
};

type BlackoutDraft = {
  key: string;
  id: string | null;
  reason: string;
  startsAt: string;
  endsAt: string;
  blocking: boolean;
};

type VenueDraft = {
  name: string;
  description: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  timezone: string;
  totalCapacity: number;
  accessibilitySeats: number;
  premiumSeats: number;
  generalSeats: number;
  phone: string;
  email: string;
  website: string;
  image: string;
  blackouts: BlackoutDraft[];
};

function readBlackout(raw: unknown): Blackout | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const reason = readString(row.reason);
  const startsAt = readString(row.startsAt);
  const endsAt = readString(row.endsAt);
  if (!id || !reason || !startsAt || !endsAt) return null;
  return { id, reason, startsAt, endsAt, blocking: row.blocking !== false };
}

function readVenue(raw: unknown): Venue | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const blackouts = Array.isArray(row.blackouts)
    ? row.blackouts.flatMap((item) => {
        const blackout = readBlackout(item);
        return blackout ? [blackout] : [];
      })
    : [];
  return {
    id,
    name,
    slug: readString(row.slug),
    description: readString(row.description),
    address: readString(row.address),
    city: readString(row.city),
    state: readString(row.state),
    country: readString(row.country),
    postalCode: readString(row.postalCode),
    latitude: readNumber(row.latitude),
    longitude: readNumber(row.longitude),
    timezone: readString(row.timezone),
    totalCapacity: readNumber(row.totalCapacity),
    accessibilitySeats: readNumber(row.accessibilitySeats),
    premiumSeats: readNumber(row.premiumSeats),
    generalSeats: readNumber(row.generalSeats),
    phone: readString(row.phone),
    email: readString(row.email),
    website: readString(row.website),
    image: readString(row.image),
    blackouts,
  };
}

function text(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

function coordLabel(raw: string): string {
  const value = parseCoord(raw, -180, 180);
  if (value === 'invalid' || value == null) return '—';
  return value.toLocaleString('es-MX', { maximumFractionDigits: 6 });
}

function parseCoord(raw: string, min: number, max: number): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) return 'invalid';
  return value;
}

function zoneOf(draft: VenueDraft): string {
  return draft.timezone.trim() || 'America/Mexico_City';
}

function zoneOptions(current: string): { value: string; label: string }[] {
  const known = ZONES as readonly string[];
  const values = current && !known.includes(current) ? [current, ...ZONES] : [...ZONES];
  return values.map((value) => ({ value, label: ZONE_LABEL[value] ?? value }));
}

function toLocal(iso: string, zone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return formatLocalDateTime(date, zone);
  } catch {
    return '';
  }
}

function toIso(local: string, zone: string): string {
  return zonedTimeToUtc(parseLocalDateTime(local), zone).toISOString();
}

function shownWhen(local: string, zone: string): string {
  if (!local) return '—';
  try {
    return formatWhen(toIso(local, zone), zone);
  } catch {
    return '—';
  }
}

function emptyBlackout(key: string): BlackoutDraft {
  return { key, id: null, reason: '', startsAt: '', endsAt: '', blocking: true };
}

function venueDraft(venue: Venue): VenueDraft {
  const zone = venue.timezone || 'America/Mexico_City';
  const blackouts: BlackoutDraft[] = venue.blackouts.map((item) => ({
    key: item.id,
    id: item.id,
    reason: item.reason,
    startsAt: toLocal(item.startsAt, zone),
    endsAt: toLocal(item.endsAt, zone),
    blocking: item.blocking,
  }));
  if (blackouts.length === 0) blackouts.push(emptyBlackout('nuevo'));
  return {
    name: venue.name,
    description: venue.description ?? '',
    address: venue.address ?? '',
    city: venue.city ?? '',
    state: venue.state ?? '',
    country: venue.country ?? '',
    postalCode: venue.postalCode ?? '',
    latitude: venue.latitude == null ? '' : String(venue.latitude),
    longitude: venue.longitude == null ? '' : String(venue.longitude),
    timezone: venue.timezone ?? 'America/Mexico_City',
    totalCapacity: venue.totalCapacity ?? 0,
    accessibilitySeats: venue.accessibilitySeats ?? 0,
    premiumSeats: venue.premiumSeats ?? 0,
    generalSeats: venue.generalSeats ?? 0,
    phone: venue.phone ?? '',
    email: venue.email ?? '',
    website: venue.website ?? '',
    image: venue.image ?? '',
    blackouts,
  };
}

function keptBlackouts(draft: VenueDraft): BlackoutDraft[] {
  return draft.blackouts.filter(
    (item) => item.id || item.reason.trim() || item.startsAt || item.endsAt
  );
}

function comparable(draft: VenueDraft): string {
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    address: draft.address,
    city: draft.city,
    state: draft.state,
    country: draft.country,
    postalCode: draft.postalCode,
    latitude: draft.latitude,
    longitude: draft.longitude,
    timezone: draft.timezone,
    totalCapacity: draft.totalCapacity,
    accessibilitySeats: draft.accessibilitySeats,
    premiumSeats: draft.premiumSeats,
    generalSeats: draft.generalSeats,
    phone: draft.phone,
    email: draft.email,
    website: draft.website,
    image: draft.image,
    blackouts: keptBlackouts(draft).map((item) => ({
      id: item.id,
      reason: item.reason,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      blocking: item.blocking,
    })),
  });
}

function blankBlackout(item: BlackoutDraft): boolean {
  return !item.id && !item.reason.trim() && !item.startsAt && !item.endsAt;
}

function savedBlackout(item: BlackoutDraft): item is BlackoutDraft & { id: string } {
  return item.id != null;
}

function blackoutLabel(base: string, index: number, total: number): string {
  return total > 1 ? `${base} ${index + 1}` : base;
}

function describe(before: VenueDraft, after: VenueDraft): string {
  const lines: string[] = [];
  const pair = (label: string, from: string, to: string) => {
    if (from !== to) lines.push(`${label}: ${from || '—'} → ${to || '—'}`);
  };
  const count = (label: string, from: number, to: number) => {
    if (from !== to) lines.push(`${label}: ${formatCount(from)} → ${formatCount(to)}`);
  };
  pair('Nombre del recinto', before.name, after.name);
  pair('Descripción del recinto', before.description, after.description);
  pair('Dirección', before.address, after.address);
  pair('Ciudad del recinto', before.city, after.city);
  pair('Estado del recinto', before.state, after.state);
  pair('País del recinto', before.country, after.country);
  pair('Código postal del recinto', before.postalCode, after.postalCode);
  pair('Latitud', before.latitude, after.latitude);
  pair('Longitud', before.longitude, after.longitude);
  pair(
    'Zona horaria del recinto',
    ZONE_LABEL[before.timezone] ?? before.timezone,
    ZONE_LABEL[after.timezone] ?? after.timezone
  );
  count('Aforo total', before.totalCapacity, after.totalCapacity);
  count('Butacas accesibles', before.accessibilitySeats, after.accessibilitySeats);
  count('Butacas premium', before.premiumSeats, after.premiumSeats);
  count('Butacas generales', before.generalSeats, after.generalSeats);
  pair('Teléfono del recinto', before.phone, after.phone);
  pair('Correo del recinto', before.email, after.email);
  pair('Sitio del recinto', before.website, after.website);
  pair('Imagen del recinto', before.image, after.image);
  const afterById = new Map(after.blackouts.filter(savedBlackout).map((item) => [item.id, item]));
  for (const row of before.blackouts.filter(savedBlackout)) {
    const next = afterById.get(row.id);
    if (!next) continue;
    pair('Motivo del blackout', row.reason, next.reason);
    pair(
      'Blackout desde',
      shownWhen(row.startsAt, zoneOf(before)),
      shownWhen(next.startsAt, zoneOf(after))
    );
    pair(
      'Blackout hasta',
      shownWhen(row.endsAt, zoneOf(before)),
      shownWhen(next.endsAt, zoneOf(after))
    );
    if (row.blocking !== next.blocking) {
      lines.push(`Blackout bloquea: ${yesNo(row.blocking)} → ${yesNo(next.blocking)}`);
    }
  }
  const added = after.blackouts.filter((item) => !item.id && !blankBlackout(item));
  if (added.length === 1) lines.push('Blackout agregado');
  if (added.length > 1) lines.push(`${formatCount(added.length)} blackouts agregados`);
  return lines.join(' · ');
}

function validate(draft: VenueDraft): string | null {
  if (!draft.name.trim()) return 'El nombre del recinto no puede quedar vacío.';
  if (!draft.address.trim()) return 'La dirección no puede quedar vacía.';
  if (!draft.city.trim()) return 'La ciudad no puede quedar vacía.';
  if (!draft.state.trim()) return 'El estado no puede quedar vacío.';
  if (!draft.country.trim()) return 'El país no puede quedar vacío.';
  if (!draft.timezone.trim()) return 'La zona horaria no puede quedar vacía.';
  const latitude = parseCoord(draft.latitude, -90, 90);
  if (latitude === 'invalid') return 'La latitud está fuera de rango.';
  const longitude = parseCoord(draft.longitude, -180, 180);
  if (longitude === 'invalid') return 'La longitud está fuera de rango.';
  const email = draft.email.trim();
  if (email && (!email.includes('@') || /\s/.test(email)))
    return 'El correo del recinto no es válido.';
  for (const item of draft.blackouts) {
    if (blankBlackout(item)) continue;
    if (!item.reason.trim() || !item.startsAt || !item.endsAt) {
      return 'El blackout necesita motivo, inicio y fin.';
    }
    try {
      if (
        Date.parse(toIso(item.endsAt, zoneOf(draft))) <=
        Date.parse(toIso(item.startsAt, zoneOf(draft)))
      ) {
        return 'El blackout termina antes de empezar.';
      }
    } catch {
      return 'La fecha del blackout no se leyó.';
    }
  }
  return null;
}

function payloadBlackouts(
  draft: VenueDraft
): { id?: string; reason: string; startsAt: string; endsAt: string; blocking: boolean }[] {
  return keptBlackouts(draft).map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    reason: item.reason.trim(),
    startsAt: toIso(item.startsAt, zoneOf(draft)),
    endsAt: toIso(item.endsAt, zoneOf(draft)),
    blocking: item.blocking,
  }));
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function VenuesPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <RecintoBody />
      </AdminFrame>
    </Suspense>
  );
}

function RecintoBody() {
  const session = useSession();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VenueDraft>>({});
  const [baselines, setBaselines] = useState<Record<string, VenueDraft>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
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
        const base = Object.fromEntries(next.map((venue) => [venue.id, venueDraft(venue)]));
        setVenues(next);
        setDrafts(base);
        setBaselines(base);
        setOpenId((current) =>
          current && next.some((item) => item.id === current)
            ? current
            : next.length === 1
              ? (next[0]?.id ?? null)
              : null
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

  function touch(id: string, recipe: (draft: VenueDraft) => VenueDraft) {
    setDrafts((current) => {
      const draft = current[id];
      if (!draft) return current;
      return { ...current, [id]: recipe(draft) };
    });
    setNotice(null);
    setActionError(null);
  }

  async function save(id: string) {
    const draft = drafts[id];
    const baseline = baselines[id];
    if (!token || !draft || !baseline || savingId) return;
    const problem = validate(draft);
    if (problem) {
      setActionError(problem);
      return;
    }
    let blackouts: ReturnType<typeof payloadBlackouts>;
    try {
      blackouts = payloadBlackouts(draft);
    } catch {
      setActionError('La fecha del blackout no se leyó.');
      return;
    }
    const latitude = parseCoord(draft.latitude, -90, 90);
    const longitude = parseCoord(draft.longitude, -180, 180);
    setSavingId(id);
    setActionError(null);
    try {
      await adminApi(`/admin/venues/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          address: draft.address.trim(),
          city: draft.city.trim(),
          state: draft.state.trim(),
          country: draft.country.trim(),
          postalCode: draft.postalCode.trim() || null,
          latitude,
          longitude,
          timezone: draft.timezone.trim(),
          totalCapacity: draft.totalCapacity,
          accessibilitySeats: draft.accessibilitySeats,
          premiumSeats: draft.premiumSeats,
          generalSeats: draft.generalSeats,
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
          website: draft.website.trim() || null,
          image: draft.image.trim() || null,
          blackouts,
        }),
      });
      setNotice({ id, text: describe(baseline, draft) || 'Recinto guardado' });
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setSavingId(null);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Recintos</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir recintos"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando recintos">
        <div className={styles.skeleton} style={{ height: 48, maxWidth: 320 }} />
        <div className={styles.skeleton} style={{ height: 360 }} />
      </div>
    );
  }

  const openVenue = openId ? venues.find((venue) => venue.id === openId) : undefined;
  const draft = openVenue ? drafts[openVenue.id] : undefined;

  if (openVenue && draft) {
    const baseline = baselines[openVenue.id];
    const dirty = baseline ? comparable(draft) !== comparable(baseline) : false;
    const where = [draft.city, draft.state]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
    return (
      <section className={styles.page}>
        <header className={styles.pageHead}>
          <div className={styles.sectionHead}>
            {venues.length > 1 ? (
              <button
                type="button"
                className={styles.panelLinkButton}
                onClick={() => setOpenId(null)}
              >
                ‹ Todos los recintos
              </button>
            ) : null}
            <h1 className={styles.sectionTitle}>{draft.name.trim() || openVenue.name}</h1>
            <p className={styles.quiet}>
              {[where || null, ZONE_LABEL[draft.timezone] ?? null].filter(Boolean).join(' · ') ||
                'Sin ubicación capturada'}
            </p>
          </div>
          <div className={styles.toolbar}>
            <Link href={`/venues/${openVenue.id}/map`} className={styles.ghostLink}>
              Plano de butacas
            </Link>
            <Link href={`/venues/${openVenue.id}/3d?studio=1`} className={styles.ghostLink}>
              Vista 3D
            </Link>
          </div>
        </header>

        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Aforo total</p>
            <p className={styles.kpiValue}>{formatCount(draft.totalCapacity)}</p>
            <p className={styles.kpiNote}>personas</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Generales</p>
            <p className={styles.kpiValue}>{formatCount(draft.generalSeats)}</p>
            <p className={styles.kpiNote}>butacas declaradas</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Premium</p>
            <p className={styles.kpiValue}>{formatCount(draft.premiumSeats)}</p>
            <p className={styles.kpiNote}>butacas declaradas</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Accesibles</p>
            <p className={styles.kpiValue}>{formatCount(draft.accessibilitySeats)}</p>
            <p className={styles.kpiNote}>
              <span className={draft.accessibilitySeats > 0 ? styles.up : styles.down}>
                {draft.accessibilitySeats > 0 ? 'declaradas' : 'sin plazas accesibles'}
              </span>
            </p>
          </div>
        </div>

        <VenueCards
          venue={openVenue}
          draft={draft}
          canEdit={canEdit}
          onChange={(recipe) => touch(openVenue.id, recipe)}
          onAddBlackout={() =>
            touch(openVenue.id, (current) => ({
              ...current,
              blackouts: [...current.blackouts, emptyBlackout(`nuevo-${Date.now()}`)],
            }))
          }
        />

        {canEdit ? (
          <>
            {actionError ? (
              <p className={styles.danger} role="alert">
                {actionError}
              </p>
            ) : null}
            <div className={styles.saveBar}>
              <p className={styles.quiet} aria-live="polite">
                {dirty ? 'Cambios sin guardar' : notice?.id === openVenue.id ? notice.text : ''}
              </p>
              <TicketButton
                disabled={!dirty || savingId === openVenue.id}
                onClick={() => void save(openVenue.id)}
              >
                {savingId === openVenue.id ? 'Guardando' : 'Guardar cambios'}
              </TicketButton>
            </div>
          </>
        ) : (
          <p className={styles.tertiary}>
            Solo lectura: los datos del recinto los edita administración.
          </p>
        )}
      </section>
    );
  }

  const totalCapacity = venues.reduce((sum, venue) => sum + (venue.totalCapacity ?? 0), 0);

  return (
    <section className={styles.page}>
      <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
        <h1 className={styles.sectionTitle}>Recintos</h1>
        <p className={styles.quiet}>
          Salas donde se presentan tus eventos: datos, cupo declarado y fechas bloqueadas.
        </p>
      </header>

      {venues.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Todavía no hay recintos</p>
          <p className={styles.quiet}>
            Los recintos los da de alta Black Ticket junto con su plano. Escríbenos para agregar
            uno.
          </p>
          <Link href="/maps" className={styles.ghostLink}>
            Ver planos de butacas
          </Link>
        </div>
      ) : (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Recintos</p>
              <p className={styles.kpiValue}>{formatCount(venues.length)}</p>
              <p className={styles.kpiNote}>en tu organización</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Aforo combinado</p>
              <p className={styles.kpiValue}>{formatCount(totalCapacity)}</p>
              <p className={styles.kpiNote}>personas</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Fechas bloqueadas</p>
              <p className={styles.kpiValue}>
                {formatCount(venues.reduce((sum, venue) => sum + venue.blackouts.length, 0))}
              </p>
              <p className={styles.kpiNote}>en todos los recintos</p>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Recinto</th>
                  <th scope="col" className={styles.num}>
                    Aforo
                  </th>
                  <th scope="col" className={styles.num}>
                    Accesibles
                  </th>
                  <th scope="col">Bloqueos</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {venues.map((venue) => (
                  <tr key={venue.id}>
                    <td>
                      <button
                        type="button"
                        className={styles.rowToggle}
                        onClick={() => setOpenId(venue.id)}
                      >
                        {drafts[venue.id]?.name.trim() || venue.name}
                      </button>
                      <p className={styles.rowMeta}>
                        {[venue.city, venue.state].filter(Boolean).join(', ') || 'Sin ciudad'}
                      </p>
                    </td>
                    <td className={styles.num}>{formatCount(venue.totalCapacity)}</td>
                    <td className={styles.num}>
                      {venue.accessibilitySeats ? (
                        formatCount(venue.accessibilitySeats)
                      ) : (
                        <span className={styles.chipWarn}>Sin plazas</span>
                      )}
                    </td>
                    <td>
                      {venue.blackouts.length > 0 ? (
                        <span className={styles.chipGold}>
                          {venue.blackouts.length}{' '}
                          {venue.blackouts.length === 1 ? 'fecha' : 'fechas'}
                        </span>
                      ) : (
                        <span className={styles.quiet}>—</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      <div className={styles.cellActions}>
                        <Link href={`/venues/${venue.id}/map`} className={styles.panelLink}>
                          Plano
                        </Link>
                        <button
                          type="button"
                          className={styles.panelLinkButton}
                          onClick={() => setOpenId(venue.id)}
                        >
                          Abrir ficha
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function VenueCards({
  venue,
  draft,
  canEdit,
  onChange,
  onAddBlackout,
}: {
  venue: Venue;
  draft: VenueDraft;
  canEdit: boolean;
  onChange: (recipe: (draft: VenueDraft) => VenueDraft) => void;
  onAddBlackout: () => void;
}) {
  const zone = zoneOf(draft);
  const options = zoneOptions(draft.timezone);
  const set = <K extends keyof VenueDraft>(key: K, value: VenueDraft[K]) =>
    onChange((current) => ({ ...current, [key]: value }));
  const hasBlank = draft.blackouts.some((item) => blankBlackout(item));
  const input = (label: string, key: keyof VenueDraft, extra?: { inputMode?: 'decimal' }) => (
    <Item label={label} value={text(String(draft[key] ?? ''))} editing={canEdit}>
      <Field
        label={label}
        inputMode={extra?.inputMode}
        value={String(draft[key] ?? '')}
        onChange={(event) => set(key, event.target.value as VenueDraft[typeof key])}
      />
    </Item>
  );
  const stepper = (
    label: string,
    key: 'totalCapacity' | 'accessibilitySeats' | 'premiumSeats' | 'generalSeats'
  ) => (
    <Item label={label} value={formatCount(draft[key])} editing={canEdit}>
      <p className={styles.rowMeta}>{label}</p>
      <Stepper
        label={label}
        value={draft[key]}
        min={0}
        max={null}
        editable
        onChange={(next) => set(key, next)}
      />
    </Item>
  );

  return (
    <div className={styles.stack} style={{ gap: 16 }}>
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Datos generales</h2>
        <div className={styles.formGrid}>
          {input('Nombre del recinto', 'name')}
          {input('Descripción', 'description')}
          <Item label="Dirección web" value={venue.slug ? `/${venue.slug}` : '—'} />
        </div>
      </div>
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Ubicación</h2>
        <div className={styles.formGrid}>
          {input('Calle y número', 'address')}
          {input('Ciudad', 'city')}
          {input('Estado', 'state')}
          {input('País', 'country')}
          {input('Código postal', 'postalCode')}
          <Item
            label="Zona horaria"
            value={ZONE_LABEL[draft.timezone] ?? text(draft.timezone)}
            editing={canEdit}
          >
            <p className={styles.rowMeta}>Zona horaria</p>
            <SheetSelect
              label="Zona horaria del recinto"
              value={draft.timezone}
              placeholder="Zona horaria"
              options={options}
              onChange={(next) => set('timezone', next)}
            />
          </Item>
          <Item label="Latitud" value={coordLabel(draft.latitude)} editing={canEdit}>
            <Field
              label="Latitud"
              inputMode="decimal"
              value={draft.latitude}
              onChange={(event) => set('latitude', event.target.value)}
            />
          </Item>
          <Item label="Longitud" value={coordLabel(draft.longitude)} editing={canEdit}>
            <Field
              label="Longitud"
              inputMode="decimal"
              value={draft.longitude}
              onChange={(event) => set('longitude', event.target.value)}
            />
          </Item>
        </div>
      </div>
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Cupo declarado</h2>
        <div className={styles.formGrid}>
          {stepper('Aforo total', 'totalCapacity')}
          {stepper('Butacas generales', 'generalSeats')}
          {stepper('Butacas premium', 'premiumSeats')}
          {stepper('Butacas accesibles', 'accessibilitySeats')}
        </div>
      </div>
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Contacto e imagen</h2>
        <div className={styles.formGrid}>
          {input('Teléfono', 'phone')}
          {input('Correo', 'email')}
          {input('Sitio web', 'website')}
          <Item
            label="Imagen (dirección de la foto)"
            value={draft.image.trim() ? draft.image.trim() : 'Sin imagen'}
            editing={canEdit}
          >
            <Field
              label="Imagen (dirección de la foto)"
              value={draft.image}
              onChange={(event) => set('image', event.target.value)}
            />
          </Item>
        </div>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Fechas bloqueadas</h2>
            <p className={styles.rowMeta}>
              Días en que la sala no recibe funciones (mantenimiento, evento privado…).
            </p>
          </div>
          {canEdit && !hasBlank ? (
            <TicketButton variant="secondary" onClick={onAddBlackout}>
              Agregar fecha bloqueada
            </TicketButton>
          ) : null}
        </div>
        {draft.blackouts.length === 0 ? (
          <p className={styles.quiet}>No hay fechas bloqueadas.</p>
        ) : (
          <div className={styles.stack} style={{ gap: 12 }}>
            {draft.blackouts.map((item, index) => (
              <BlackoutCards
                key={item.key}
                item={item}
                index={index}
                total={draft.blackouts.length}
                zone={zone}
                canEdit={canEdit}
                onChange={(patch) =>
                  onChange((current) => ({
                    ...current,
                    blackouts: current.blackouts.map((row) =>
                      row.key === item.key ? { ...row, ...patch } : row
                    ),
                  }))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BlackoutCards({
  item,
  index,
  total,
  zone,
  canEdit,
  onChange,
}: {
  item: BlackoutDraft;
  index: number;
  total: number;
  zone: string;
  canEdit: boolean;
  onChange: (patch: Partial<BlackoutDraft>) => void;
}) {
  const reason = blackoutLabel('Motivo', index, total);
  const from = blackoutLabel('Desde', index, total);
  const until = blackoutLabel('Hasta', index, total);
  const blocking = blackoutLabel('Impide programar', index, total);
  return (
    <div className={styles.blackout}>
      <Item label={reason} value={text(item.reason)} editing={canEdit}>
        <Field
          label={reason}
          value={item.reason}
          onChange={(event) => onChange({ reason: event.target.value })}
        />
      </Item>
      <Item label={from} value={shownWhen(item.startsAt, zone)} editing={canEdit}>
        <Field
          label={from}
          type="datetime-local"
          value={item.startsAt}
          onChange={(event) => onChange({ startsAt: event.target.value })}
        />
      </Item>
      <Item label={until} value={shownWhen(item.endsAt, zone)} editing={canEdit}>
        <Field
          label={until}
          type="datetime-local"
          value={item.endsAt}
          onChange={(event) => onChange({ endsAt: event.target.value })}
        />
      </Item>
      <Item
        label={blocking}
        value={item.blocking ? 'Sí, bloquea' : 'No, solo avisa'}
        editing={canEdit}
      >
        <p className={styles.rowMeta}>{blocking}</p>
        <Switch
          on={item.blocking}
          label={blocking}
          onChange={(next) => onChange({ blocking: next })}
        />
      </Item>
    </div>
  );
}

/** Un dato de la ficha: control si se edita, valor si solo se lee. */
function Item({
  label,
  value,
  editing,
  children,
}: {
  label: string;
  value: string;
  editing?: boolean;
  children?: ReactNode;
}) {
  if (editing && children) {
    return <div className={styles.formItem}>{children}</div>;
  }
  return (
    <div className={styles.formItem}>
      <p className={styles.rowMeta}>{label}</p>
      <p className={styles.formValue}>{value}</p>
    </div>
  );
}
