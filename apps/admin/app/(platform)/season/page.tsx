'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { formatLocalDateTime, parseLocalDateTime, zonedTimeToUtc } from '@boletera/shared';
import { Field, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, SheetSelect, Stepper, Switch } from '../events/_ticket/controls';
import controlStyles from '../events/_ticket/controls.module.scss';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString, yesNo } from '../events/_ticket/read';

const SEE = ['ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER'];
const ZONE = 'America/Mexico_City';
const CURRENCIES = ['MXN', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'BRL', 'INR', 'AED', 'CHF', 'SGD', 'HKD', 'NZD'];

type OrgEvent = { id: string; title: string };

type PassEvent = { id: string; title: string };

type Pass = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  seasonLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  price: number | null;
  currency: string | null;
  maxQuantity: number | null;
  soldQuantity: number | null;
  benefits: string | null;
  active: boolean;
  events: PassEvent[];
};

type PassDraft = {
  name: string;
  slug: string;
  description: string;
  seasonLabel: string;
  startsAt: string;
  endsAt: string;
  price: string;
  currency: string;
  maxQuantity: number;
  benefits: string;
  active: boolean;
  eventIds: string[];
};

function text(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

function benefitsLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function readEvent(raw: unknown): OrgEvent | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const title = readString(row.title);
  if (!id || !title) return null;
  return { id, title };
}

function readPass(raw: unknown): Pass | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const events = Array.isArray(row.events)
    ? row.events.flatMap((item) => {
        const event = readEvent(asRecord(item).event);
        return event ? [event] : [];
      })
    : [];
  return {
    id,
    name,
    slug: readString(row.slug),
    description: readString(row.description),
    seasonLabel: readString(row.seasonLabel),
    startsAt: readString(row.startsAt),
    endsAt: readString(row.endsAt),
    price: readNumber(row.price),
    currency: readString(row.currency),
    maxQuantity: readNumber(row.maxQuantity),
    soldQuantity: readNumber(row.soldQuantity),
    benefits: benefitsLabel(row.benefits),
    active: row.active !== false,
    events,
  };
}

function money(value: number | null, currency: string | null): string {
  if (value == null) return '—';
  if (currency && currency !== 'MXN') {
    return `${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  return formatTicketAmount(value);
}

function toLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return formatLocalDateTime(date, ZONE);
  } catch {
    return '';
  }
}

function toIso(local: string): string {
  return zonedTimeToUtc(parseLocalDateTime(local), ZONE).toISOString();
}

function shownWhen(local: string): string {
  if (!local) return '—';
  try {
    return formatWhen(toIso(local), ZONE);
  } catch {
    return '—';
  }
}

function priceLabel(raw: string, currency: string): string {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return '—';
  return money(value, currency);
}

function currencyOptions(current: string): { value: string; label: string }[] {
  const values = current && !CURRENCIES.includes(current) ? [current, ...CURRENCIES] : CURRENCIES;
  return values.map((value) => ({ value, label: value }));
}

function passDraft(pass: Pass): PassDraft {
  return {
    name: pass.name,
    slug: pass.slug ?? '',
    description: pass.description ?? '',
    seasonLabel: pass.seasonLabel ?? '',
    startsAt: toLocal(pass.startsAt),
    endsAt: toLocal(pass.endsAt),
    price: pass.price == null ? '' : String(pass.price),
    currency: pass.currency ?? 'MXN',
    maxQuantity: pass.maxQuantity ?? 0,
    benefits: pass.benefits ?? '',
    active: pass.active,
    eventIds: pass.events.map((event) => event.id),
  };
}

function comparable(draft: PassDraft): string {
  return JSON.stringify({ ...draft, eventIds: [...draft.eventIds].sort() });
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

function eventTitles(ids: string[], catalog: OrgEvent[], fallback: PassEvent[]): string {
  if (ids.length === 0) return 'Ninguno';
  return ids
    .map((id) => catalog.find((item) => item.id === id)?.title ?? fallback.find((item) => item.id === id)?.title ?? id)
    .join(' · ');
}

function describe(before: PassDraft, after: PassDraft, catalog: OrgEvent[], fallback: PassEvent[]): string {
  const lines: string[] = [];
  const pair = (label: string, from: string, to: string) => {
    if (from !== to) lines.push(`${label}: ${from || '—'} → ${to || '—'}`);
  };
  pair('Nombre del abono', before.name, after.name);
  pair('Slug del abono', before.slug, after.slug);
  pair('Descripción del abono', before.description, after.description);
  pair('Temporada', before.seasonLabel, after.seasonLabel);
  pair('Abono desde', shownWhen(before.startsAt), shownWhen(after.startsAt));
  pair('Abono hasta', shownWhen(before.endsAt), shownWhen(after.endsAt));
  pair('Precio del abono', priceLabel(before.price, before.currency), priceLabel(after.price, after.currency));
  pair('Moneda del abono', before.currency, after.currency);
  if (before.maxQuantity !== after.maxQuantity) {
    lines.push(`Cupo del abono: ${formatCount(before.maxQuantity)} → ${formatCount(after.maxQuantity)}`);
  }
  pair('Beneficios', before.benefits, after.benefits);
  if (before.active !== after.active) lines.push(`Abono activo: ${yesNo(before.active)} → ${yesNo(after.active)}`);
  if (!sameIds(before.eventIds, after.eventIds)) {
    lines.push(
      `Eventos del abono: ${eventTitles(before.eventIds, catalog, fallback)} → ${eventTitles(after.eventIds, catalog, fallback)}`,
    );
  }
  return lines.join(' · ');
}

function validate(draft: PassDraft): string | null {
  if (!draft.name.trim()) return 'El nombre del abono no puede quedar vacío.';
  if (!draft.slug.trim()) return 'El slug del abono no puede quedar vacío.';
  if (!draft.seasonLabel.trim()) return 'La temporada no puede quedar vacía.';
  if (!draft.startsAt || !draft.endsAt) return 'El abono necesita inicio y fin.';
  try {
    if (Date.parse(toIso(draft.endsAt)) <= Date.parse(toIso(draft.startsAt))) {
      return 'El abono termina antes de empezar.';
    }
  } catch {
    return 'La fecha del abono no se leyó.';
  }
  const price = Number(draft.price);
  if (draft.price.trim() === '' || !Number.isFinite(price) || price < 0) return 'El precio del abono no es válido.';
  if (!draft.currency.trim()) return 'La moneda del abono no puede quedar vacía.';
  const benefits = draft.benefits.trim();
  if (benefits.startsWith('{') || benefits.startsWith('[')) {
    try {
      JSON.parse(benefits);
    } catch {
      return 'Los beneficios no son JSON válido.';
    }
  }
  return null;
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function SeasonPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <AbonosBody />
      </AdminFrame>
    </Suspense>
  );
}

function AbonosBody() {
  const session = useSession();
  const [passes, setPasses] = useState<Pass[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PassDraft>>({});
  const [baselines, setBaselines] = useState<Record<string, PassDraft>>({});
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [eventsNote, setEventsNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const role = session.role;
  const canSee = role === 'SUPER_ADMIN' || (role != null && SEE.includes(role));
  const canEdit = hasCapability(role, 'events.manage');

  useEffect(() => {
    if (!token || !session.orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const orgId = session.orgId;
    let alive = true;
    setError(null);
    async function load() {
      const passesPromise = adminApi<unknown>(`/season/org/${orgId}`, token!);
      const eventsPromise = canEdit
        ? adminApi<unknown>('/admin/events', token!).catch(() => null)
        : Promise.resolve(null);
      const [payload, rawEvents] = await Promise.all([passesPromise, eventsPromise]);
      if (!alive) return;
      const list = Array.isArray(payload) ? payload : [];
      const next = list.flatMap((item) => {
        const pass = readPass(item);
        return pass ? [pass] : [];
      });
      const base = Object.fromEntries(next.map((pass) => [pass.id, passDraft(pass)]));
      setPasses(next);
      setDrafts(base);
      setBaselines(base);
      setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      if (!canEdit) {
        setEvents(null);
        setEventsNote(null);
        return;
      }
      if (!Array.isArray(rawEvents)) {
        setEvents([]);
        setEventsNote('No se cargó la lista de funciones. El resto sí se guarda.');
        return;
      }
      setEvents(rawEvents.flatMap((item) => {
        const event = readEvent(item);
        return event ? [event] : [];
      }));
      setEventsNote(null);
    }
    void load()
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
  }, [token, session.orgId, canSee, canEdit, session.status, nonce]);

  function touch(id: string, recipe: (draft: PassDraft) => PassDraft) {
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
    const pass = passes.find((item) => item.id === id);
    if (!token || !session.orgId || !draft || !baseline || !pass || savingId) return;
    const problem = validate(draft);
    if (problem) {
      setActionError(problem);
      return;
    }
    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = toIso(draft.startsAt);
      endsAt = toIso(draft.endsAt);
    } catch {
      setActionError('La fecha del abono no se leyó.');
      return;
    }
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      description: draft.description.trim() || null,
      seasonLabel: draft.seasonLabel.trim(),
      startsAt,
      endsAt,
      price: Number(draft.price),
      currency: draft.currency,
      maxQuantity: draft.maxQuantity,
      benefits: draft.benefits.trim() || null,
      active: draft.active,
    };
    if (!eventsNote) body.eventIds = draft.eventIds;
    setSavingId(id);
    setActionError(null);
    try {
      await adminApi(`/season/org/${session.orgId}/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice({ id, text: describe(baseline, draft, events ?? [], pass.events) || 'Abono guardado' });
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
          <h1 className={styles.sectionTitle}>Abonos</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir abonos" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando abonos.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Abonos</h1>
        <p className={styles.quiet}>
          {canEdit
            ? 'Se guarda el abono. Los vendidos los cuenta el servicio. La sección del asiento se pide al comprar.'
            : 'Se lee. La guarda quien edita eventos.'}
        </p>
      </header>
      {passes.length === 0 ? <p className={styles.quiet}>No hay abonos.</p> : null}
      <div className={styles.stack}>
        {passes.map((pass) => {
          const open = openId === pass.id;
          const draft = drafts[pass.id];
          const baseline = baselines[pass.id];
          const dirty = draft && baseline ? comparable(draft) !== comparable(baseline) : false;
          return (
            <div key={pass.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : pass.id)}
              >
                <span>{draft?.name.trim() || pass.name}</span>
                <span className={styles.figure}>{priceLabel(draft?.price ?? '', draft?.currency ?? pass.currency ?? 'MXN')}</span>
              </button>
              {open && draft ? (
                <PassCards
                  pass={pass}
                  draft={draft}
                  canEdit={canEdit}
                  events={events}
                  eventsNote={eventsNote}
                  onChange={(recipe) => touch(pass.id, recipe)}
                />
              ) : null}
              {open && draft && canEdit ? (
                <>
                  {actionError && openId === pass.id ? (
                    <p className={styles.danger} role="alert">
                      {actionError}
                    </p>
                  ) : null}
                  <div className={styles.saveBar}>
                    <p className={styles.quiet} aria-live="polite">
                      {dirty ? 'Sin guardar' : notice?.id === pass.id ? notice.text : ''}
                    </p>
                    <TicketButton disabled={!dirty || savingId === pass.id} onClick={() => void save(pass.id)}>
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

function PassCards({
  pass,
  draft,
  canEdit,
  events,
  eventsNote,
  onChange,
}: {
  pass: Pass;
  draft: PassDraft;
  canEdit: boolean;
  events: OrgEvent[] | null;
  eventsNote: string | null;
  onChange: (recipe: (draft: PassDraft) => PassDraft) => void;
}) {
  const set = <K extends keyof PassDraft>(key: K, value: PassDraft[K]) =>
    onChange((current) => ({ ...current, [key]: value }));
  const catalog = events ?? [];
  const canPickEvents = canEdit && !eventsNote && events !== null;

  return (
    <div className={styles.stack}>
      <Card name="Nombre del abono" value={text(draft.name)} effect="Nombre." editing={canEdit}>
        <Field label="Nombre del abono" value={draft.name} onChange={(event) => set('name', event.target.value)} />
      </Card>
      <Card name="Slug del abono" value={text(draft.slug)} style="mono" effect="Único en la organización." editing={canEdit}>
        <Field label="Slug del abono" value={draft.slug} onChange={(event) => set('slug', event.target.value)} />
      </Card>
      <Card name="Descripción del abono" value={text(draft.description)} effect="Texto corto." editing={canEdit}>
        <Field
          label="Descripción del abono"
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </Card>
      <Card name="Temporada" value={text(draft.seasonLabel)} effect="Etiqueta de la temporada." editing={canEdit}>
        <Field label="Temporada" value={draft.seasonLabel} onChange={(event) => set('seasonLabel', event.target.value)} />
      </Card>
      <Card name="Abono desde" value={shownWhen(draft.startsAt)} effect="Inicio." editing={canEdit}>
        <Field
          label="Abono desde"
          type="datetime-local"
          value={draft.startsAt}
          onChange={(event) => set('startsAt', event.target.value)}
        />
      </Card>
      <Card name="Abono hasta" value={shownWhen(draft.endsAt)} effect="Fin." editing={canEdit}>
        <Field
          label="Abono hasta"
          type="datetime-local"
          value={draft.endsAt}
          onChange={(event) => set('endsAt', event.target.value)}
        />
      </Card>
      <Card
        name="Precio del abono"
        value={priceLabel(draft.price, draft.currency)}
        style="tabular"
        effect="Precio del abono."
        editing={canEdit}
      >
        <Field
          label="Precio del abono"
          kind="money"
          inputMode="decimal"
          value={draft.price}
          onChange={(event) => set('price', event.target.value)}
        />
      </Card>
      <Card name="Moneda del abono" value={text(draft.currency)} effect="Moneda del abono." editing={canEdit}>
        <SheetSelect
          label="Moneda del abono"
          value={draft.currency}
          placeholder="Moneda"
          options={currencyOptions(draft.currency)}
          onChange={(next) => set('currency', next)}
        />
      </Card>
      <Card name="Cupo del abono" value={formatCount(draft.maxQuantity)} style="tabular" effect="Cupo del abono." editing={canEdit}>
        <Stepper
          label="Cupo del abono"
          value={draft.maxQuantity}
          min={pass.soldQuantity ?? 0}
          max={null}
          onChange={(next) => set('maxQuantity', next)}
        />
      </Card>
      <Card
        name="Abonos vendidos"
        value={formatCount(pass.soldQuantity)}
        style="tabular"
        effect="Los cuenta el servicio."
      />
      <Card name="Beneficios" value={text(draft.benefits)} effect="JSON de beneficios, o una línea." editing={canEdit}>
        <Field label="Beneficios" value={draft.benefits} onChange={(event) => set('benefits', event.target.value)} />
      </Card>
      <Card name="Abono activo" value={yesNo(draft.active)} effect="Apagado, no se vende." editing={canEdit}>
        <Switch on={draft.active} label="Abono activo" onChange={(next) => set('active', next)} />
      </Card>
      <Card
        name="Eventos del abono"
        value={eventTitles(draft.eventIds, catalog, pass.events)}
        effect={eventsNote ?? 'Funciones incluidas.'}
        editing={canPickEvents}
      >
        <EventSheet
          label="Eventos del abono"
          selected={draft.eventIds}
          options={catalog}
          onChange={(next) => set('eventIds', next)}
        />
      </Card>
      <Card name="Sección del asiento" value="—" effect="Se pide al comprar. El abono no tiene esa columna." />
    </div>
  );
}

function EventSheet({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: OrgEvent[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const many = options.length > 12;
  const needle = query.trim().toLowerCase();
  const shown = many && needle ? options.filter((option) => option.title.toLowerCase().includes(needle)) : options;
  const summary = selected.length === 0 ? 'Ninguno' : `${formatCount(selected.length)} incluidas`;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  return (
    <div>
      <button
        type="button"
        className={controlStyles.trigger}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((next) => !next)}
      >
        {summary}
      </button>
      {open ? (
        <div className={controlStyles.sheet} role="listbox" aria-label={label} aria-multiselectable="true">
          {many ? (
            <Field label="Buscar" kind="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          ) : null}
          {shown.length === 0 ? <p>Nada con ese criterio.</p> : null}
          {shown.map((option) => {
            const on = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                className={controlStyles.option}
                aria-selected={on}
                onClick={() => toggle(option.id)}
              >
                {option.title}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
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
