'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { formatLocalDateTime, parseLocalDateTime, zonedTimeToUtc } from '@boletera/shared';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, SheetSelect, Stepper, Switch } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString, yesNo } from '../events/_ticket/read';

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
  return draft.blackouts.filter((item) => item.id || item.reason.trim() || item.startsAt || item.endsAt);
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
  pair('Zona horaria del recinto', ZONE_LABEL[before.timezone] ?? before.timezone, ZONE_LABEL[after.timezone] ?? after.timezone);
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
    pair('Blackout desde', shownWhen(row.startsAt, zoneOf(before)), shownWhen(next.startsAt, zoneOf(after)));
    pair('Blackout hasta', shownWhen(row.endsAt, zoneOf(before)), shownWhen(next.endsAt, zoneOf(after)));
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
  if (email && (!email.includes('@') || /\s/.test(email))) return 'El correo del recinto no es válido.';
  for (const item of draft.blackouts) {
    if (blankBlackout(item)) continue;
    if (!item.reason.trim() || !item.startsAt || !item.endsAt) {
      return 'El blackout necesita motivo, inicio y fin.';
    }
    try {
      if (Date.parse(toIso(item.endsAt, zoneOf(draft))) <= Date.parse(toIso(item.startsAt, zoneOf(draft)))) {
        return 'El blackout termina antes de empezar.';
      }
    } catch {
      return 'La fecha del blackout no se leyó.';
    }
  }
  return null;
}

function payloadBlackouts(draft: VenueDraft): { id?: string; reason: string; startsAt: string; endsAt: string; blocking: boolean }[] {
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
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
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
          <h1 className={styles.sectionTitle}>Recinto</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir recintos" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando recintos.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Recinto</h1>
        <p className={styles.quiet}>
          {canEdit ? 'Se guarda la sala y el blackout. El slug quedó al crear.' : 'Se lee. La guarda quien edita el mapa.'}
        </p>
      </header>
      {venues.length === 0 ? <p className={styles.quiet}>No hay recintos.</p> : null}
      <div className={styles.stack}>
        {venues.map((venue) => {
          const open = openId === venue.id;
          const draft = drafts[venue.id];
          const baseline = baselines[venue.id];
          const dirty = draft && baseline ? comparable(draft) !== comparable(baseline) : false;
          return (
            <div key={venue.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : venue.id)}
              >
                <span>{draft?.name.trim() || venue.name}</span>
                <span className={styles.figure}>{formatCount(draft?.totalCapacity ?? venue.totalCapacity)}</span>
              </button>
              {open && draft ? (
                <VenueCards
                  venue={venue}
                  draft={draft}
                  canEdit={canEdit}
                  onChange={(recipe) => touch(venue.id, recipe)}
                  onAddBlackout={() =>
                    touch(venue.id, (current) => ({
                      ...current,
                      blackouts: [...current.blackouts, emptyBlackout(`nuevo-${Date.now()}`)],
                    }))
                  }
                />
              ) : null}
              {open && draft && canEdit ? (
                <>
                  {actionError && openId === venue.id ? (
                    <p className={styles.danger} role="alert">
                      {actionError}
                    </p>
                  ) : null}
                  <div className={styles.saveBar}>
                    <p className={styles.quiet} aria-live="polite">
                      {dirty ? 'Sin guardar' : notice?.id === venue.id ? notice.text : ''}
                    </p>
                    <TicketButton disabled={!dirty || savingId === venue.id} onClick={() => void save(venue.id)}>
                      Guardar sección
                    </TicketButton>
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
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

  return (
    <div className={styles.stack}>
      <Card name="Nombre del recinto" value={text(draft.name)} effect="Nombre de la sala." editing={canEdit}>
        <Field label="Nombre del recinto" value={draft.name} onChange={(event) => set('name', event.target.value)} />
      </Card>
      <Card name="Slug del recinto" value={text(venue.slug)} style="mono" effect="Quedó al crear. Aquí se lee." />
      <Card name="Descripción del recinto" value={text(draft.description)} effect="Texto corto." editing={canEdit}>
        <Field
          label="Descripción del recinto"
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </Card>
      <Card name="Dirección" value={text(draft.address)} effect="Calle y número." editing={canEdit}>
        <Field label="Dirección" value={draft.address} onChange={(event) => set('address', event.target.value)} />
      </Card>
      <Card name="Ciudad del recinto" value={text(draft.city)} effect="Ciudad de la sala." editing={canEdit}>
        <Field label="Ciudad del recinto" value={draft.city} onChange={(event) => set('city', event.target.value)} />
      </Card>
      <Card name="Estado del recinto" value={text(draft.state)} effect="Entidad." editing={canEdit}>
        <Field label="Estado del recinto" value={draft.state} onChange={(event) => set('state', event.target.value)} />
      </Card>
      <Card name="País del recinto" value={text(draft.country)} effect="País." editing={canEdit}>
        <Field label="País del recinto" value={draft.country} onChange={(event) => set('country', event.target.value)} />
      </Card>
      <Card name="Código postal del recinto" value={text(draft.postalCode)} effect="CP." editing={canEdit}>
        <Field
          label="Código postal del recinto"
          value={draft.postalCode}
          onChange={(event) => set('postalCode', event.target.value)}
        />
      </Card>
      <Card name="Latitud" value={coordLabel(draft.latitude)} style="tabular" effect="Coordenada de la sala." editing={canEdit}>
        <Field
          label="Latitud"
          inputMode="decimal"
          value={draft.latitude}
          onChange={(event) => set('latitude', event.target.value)}
        />
      </Card>
      <Card name="Longitud" value={coordLabel(draft.longitude)} style="tabular" effect="Par de la latitud." editing={canEdit}>
        <Field
          label="Longitud"
          inputMode="decimal"
          value={draft.longitude}
          onChange={(event) => set('longitude', event.target.value)}
        />
      </Card>
      <Card
        name="Zona horaria del recinto"
        value={ZONE_LABEL[draft.timezone] ?? text(draft.timezone)}
        effect="Horas de la sala."
        editing={canEdit}
      >
        <SheetSelect
          label="Zona horaria del recinto"
          value={draft.timezone}
          placeholder="Zona horaria"
          options={options}
          onChange={(next) => set('timezone', next)}
        />
      </Card>
      <Card name="Aforo total" value={formatCount(draft.totalCapacity)} style="tabular" effect="Cupo del recinto." editing={canEdit}>
        <Stepper
          label="Aforo total"
          value={draft.totalCapacity}
          min={0}
          max={null}
          onChange={(next) => set('totalCapacity', next)}
        />
      </Card>
      <Card
        name="Butacas accesibles"
        value={formatCount(draft.accessibilitySeats)}
        style="tabular"
        effect="Cupo accesible declarado."
        editing={canEdit}
      >
        <Stepper
          label="Butacas accesibles"
          value={draft.accessibilitySeats}
          min={0}
          max={null}
          onChange={(next) => set('accessibilitySeats', next)}
        />
      </Card>
      <Card
        name="Butacas premium"
        value={formatCount(draft.premiumSeats)}
        style="tabular"
        effect="Cupo premium declarado."
        editing={canEdit}
      >
        <Stepper
          label="Butacas premium"
          value={draft.premiumSeats}
          min={0}
          max={null}
          onChange={(next) => set('premiumSeats', next)}
        />
      </Card>
      <Card
        name="Butacas generales"
        value={formatCount(draft.generalSeats)}
        style="tabular"
        effect="Cupo general declarado."
        editing={canEdit}
      >
        <Stepper
          label="Butacas generales"
          value={draft.generalSeats}
          min={0}
          max={null}
          onChange={(next) => set('generalSeats', next)}
        />
      </Card>
      <Card name="Teléfono del recinto" value={text(draft.phone)} effect="Contacto." editing={canEdit}>
        <Field label="Teléfono del recinto" value={draft.phone} onChange={(event) => set('phone', event.target.value)} />
      </Card>
      <Card name="Correo del recinto" value={text(draft.email)} effect="Contacto." editing={canEdit}>
        <Field label="Correo del recinto" value={draft.email} onChange={(event) => set('email', event.target.value)} />
      </Card>
      <Card name="Sitio del recinto" value={text(draft.website)} effect="Web." editing={canEdit}>
        <Field label="Sitio del recinto" value={draft.website} onChange={(event) => set('website', event.target.value)} />
      </Card>
      <Card
        name="Imagen del recinto"
        value={draft.image.trim() ? draft.image.trim() : 'Sin imagen'}
        effect="Dirección de la foto."
        editing={canEdit}
      >
        <Field label="Imagen del recinto" value={draft.image} onChange={(event) => set('image', event.target.value)} />
      </Card>
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
              blackouts: current.blackouts.map((row) => (row.key === item.key ? { ...row, ...patch } : row)),
            }))
          }
        />
      ))}
      {canEdit && !hasBlank ? (
        <TicketButton variant="secondary" onClick={onAddBlackout}>
          Agregar blackout
        </TicketButton>
      ) : null}
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
  const reason = blackoutLabel('Motivo del blackout', index, total);
  const from = blackoutLabel('Blackout desde', index, total);
  const until = blackoutLabel('Blackout hasta', index, total);
  const blocking = blackoutLabel('Blackout bloquea', index, total);
  return (
    <>
      <Card name={reason} value={text(item.reason)} effect="Por qué la sala no recibe función." editing={canEdit}>
        <Field label={reason} value={item.reason} onChange={(event) => onChange({ reason: event.target.value })} />
      </Card>
      <Card name={from} value={shownWhen(item.startsAt, zone)} effect="Inicio." editing={canEdit}>
        <Field label={from} type="datetime-local" value={item.startsAt} onChange={(event) => onChange({ startsAt: event.target.value })} />
      </Card>
      <Card name={until} value={shownWhen(item.endsAt, zone)} effect="Fin." editing={canEdit}>
        <Field label={until} type="datetime-local" value={item.endsAt} onChange={(event) => onChange({ endsAt: event.target.value })} />
      </Card>
      <Card name={blocking} value={yesNo(item.blocking)} effect="Encendido impide programar. Apagado advierte." editing={canEdit}>
        <Switch on={item.blocking} label={blocking} onChange={(next) => onChange({ blocking: next })} />
      </Card>
    </>
  );
}

function Card({
  name,
  value,
  effect,
  style,
  editing,
  children,
}: {
  name: string;
  value: string;
  effect: string;
  style?: 'tabular' | 'mono';
  editing?: boolean;
  children?: ReactNode;
}) {
  return (
    <Param name={name}>
      <ParameterCard name={name} value={value} valueStyle={style} effect={effect}>
        {editing ? children : null}
      </ParameterCard>
    </Param>
  );
}
