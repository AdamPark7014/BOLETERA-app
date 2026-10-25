'use client';

import { useEffect, useState } from 'react';
import { formatLocalDateTime, parseLocalDateTime, zonedTimeToUtc } from '@boletera/shared';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { Param, Segment, Stepper } from './controls';
import controlStyles from './controls.module.scss';
import styles from './frame.module.scss';
import { channelLabel } from './holds';
import { asRecord, formatWhen, readNumber, readString } from './read';

const KINDS = [
  { value: 'PRESALE', label: 'Preventa' },
  { value: 'MEMBERS', label: 'Socios' },
  { value: 'PUBLIC', label: 'Público' },
  { value: 'LAST_MINUTE', label: 'Último momento' },
  { value: 'DOOR', label: 'Puerta' },
] as const;

const STATUSES = [
  { value: 'SCHEDULED', label: 'Programada' },
  { value: 'ACTIVE', label: 'Activa' },
  { value: 'ENDED', label: 'Terminada' },
  { value: 'CANCELLED', label: 'Cancelada' },
] as const;

const CHANNELS = [
  'WEB',
  'TAQUILLA',
  'API',
  'PHONE',
  'ADMIN',
  'PROMOTER',
  'COURTESY',
  'CORPORATE',
  'MOBILE',
  'INVITATION',
  'AFFILIATE',
  'VIP',
  'RESALE',
] as const;

type Draft = {
  id: string;
  isNew: boolean;
  name: string;
  kind: string;
  code: string;
  startsLocal: string;
  endsLocal: string;
  status: string;
  channels: string[];
  allocation: number | null;
  maxPerOrder: number | null;
  discount: number;
  priority: number;
  notes: string;
};

function labelOf(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function channelsValue(channels: string[]): string {
  if (channels.length === 0) return 'Todos';
  return channels.map((channel) => channelLabel(channel)).join(', ');
}

function allocationValue(value: number | null): string {
  return value == null ? 'Sin tope' : `${value}%`;
}

function toLocal(iso: string, zone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatLocalDateTime(date, zone);
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

function sameChannels(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

function readPhase(raw: unknown, zone: string): Draft | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const starts = readString(row.startsAt);
  const ends = readString(row.endsAt);
  if (!id || !starts || !ends) return null;
  const channels = Array.isArray(row.channels)
    ? row.channels.filter((item): item is string => typeof item === 'string' && CHANNELS.includes(item as (typeof CHANNELS)[number]))
    : [];
  return {
    id,
    isNew: false,
    name: readString(row.name) ?? '',
    kind: readString(row.kind) ?? 'PUBLIC',
    code: readString(row.code) ?? '',
    startsLocal: toLocal(starts, zone),
    endsLocal: toLocal(ends, zone),
    status: readString(row.status) ?? 'SCHEDULED',
    channels,
    allocation: readNumber(row.allocationPercent),
    maxPerOrder: readNumber(row.maxPerOrder),
    discount: readNumber(row.discountPercent) ?? 0,
    priority: readNumber(row.priority) ?? 100,
    notes: readString(row.notes) ?? '',
  };
}

function readPhases(payload: unknown, zone: string): Draft[] {
  const row = asRecord(payload);
  const list = Array.isArray(row.phases) ? row.phases : [];
  return list.flatMap((item) => {
    const phase = readPhase(item, zone);
    return phase ? [phase] : [];
  });
}

function blank(zone: string, eventStarts: string | null): Draft {
  const start = new Date();
  const eventTime = eventStarts ? new Date(eventStarts).getTime() : Number.NaN;
  const eventStarted = Number.isFinite(eventTime) && eventTime <= start.getTime();
  const end = !eventStarted && Number.isFinite(eventTime) ? new Date(eventTime) : new Date(start.getTime() + 60 * 60 * 1000);
  const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: 'nueva',
    isNew: true,
    name: '',
    kind: eventStarted ? 'DOOR' : 'PUBLIC',
    code: '',
    startsLocal: formatLocalDateTime(start, zone),
    endsLocal: formatLocalDateTime(safeEnd, zone),
    status: 'SCHEDULED',
    channels: [],
    allocation: null,
    maxPerOrder: null,
    discount: 0,
    priority: 100,
    notes: '',
  };
}

function phaseValid(draft: Draft): boolean {
  if (!draft.name.trim()) return false;
  if (!draft.startsLocal || !draft.endsLocal) return false;
  if (draft.endsLocal <= draft.startsLocal) return false;
  if (draft.allocation != null && (draft.allocation < 1 || draft.allocation > 100)) return false;
  if (draft.discount < 0 || draft.discount > 100) return false;
  if (draft.maxPerOrder != null && draft.maxPerOrder < 1) return false;
  return true;
}

function patchBody(draft: Draft, base: Draft, zone: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (draft.name.trim() !== base.name.trim()) body.name = draft.name.trim();
  if (draft.kind !== base.kind) body.kind = draft.kind;
  if ((draft.code.trim() || null) !== (base.code.trim() || null)) body.code = draft.code.trim() || null;
  if (draft.startsLocal !== base.startsLocal) body.startsAt = toIso(draft.startsLocal, zone);
  if (draft.endsLocal !== base.endsLocal) body.endsAt = toIso(draft.endsLocal, zone);
  if (draft.status !== base.status) body.status = draft.status;
  if (!sameChannels(draft.channels, base.channels)) body.channels = draft.channels;
  if (draft.allocation !== base.allocation) body.allocationPercent = draft.allocation;
  if (draft.maxPerOrder !== base.maxPerOrder) body.maxPerOrder = draft.maxPerOrder;
  if (draft.discount !== base.discount) body.discountPercent = draft.discount;
  if (draft.priority !== base.priority) body.priority = draft.priority;
  if ((draft.notes.trim() || null) !== (base.notes.trim() || null)) body.notes = draft.notes.trim() || null;
  return body;
}

function changeLine(draft: Draft, base: Draft | null): string {
  if (!base) return `Fase creada · ${draft.name.trim()}`;
  const parts: string[] = [];
  if (draft.name.trim() !== base.name.trim()) {
    parts.push(`Nombre de la fase: ${base.name} → ${draft.name.trim()}`);
  }
  if (draft.kind !== base.kind) {
    parts.push(`Tipo de fase: ${labelOf(KINDS, base.kind)} → ${labelOf(KINDS, draft.kind)}`);
  }
  if ((draft.code.trim() || 'Ninguno') !== (base.code.trim() || 'Ninguno')) {
    parts.push(`Código de acceso: ${base.code.trim() || 'Ninguno'} → ${draft.code.trim() || 'Ninguno'}`);
  }
  if (draft.startsLocal !== base.startsLocal) parts.push('Inicio de la fase');
  if (draft.endsLocal !== base.endsLocal) parts.push('Fin de la fase');
  if (draft.status !== base.status) {
    parts.push(`Estado de la fase: ${labelOf(STATUSES, base.status)} → ${labelOf(STATUSES, draft.status)}`);
  }
  if (!sameChannels(draft.channels, base.channels)) {
    parts.push(`Canales de la fase: ${channelsValue(base.channels)} → ${channelsValue(draft.channels)}`);
  }
  if (draft.allocation !== base.allocation) {
    parts.push(`Cupo de la fase: ${allocationValue(base.allocation)} → ${allocationValue(draft.allocation)}`);
  }
  if (draft.maxPerOrder !== base.maxPerOrder) {
    parts.push(`Máximo por orden en la fase: ${base.maxPerOrder ?? 'El de la zona'} → ${draft.maxPerOrder ?? 'El de la zona'}`);
  }
  if (draft.discount !== base.discount) {
    parts.push(`Descuento de la fase: ${base.discount}% → ${draft.discount}%`);
  }
  if (draft.priority !== base.priority) {
    parts.push(`Prioridad: ${base.priority} → ${draft.priority}`);
  }
  if ((draft.notes.trim() || '—') !== (base.notes.trim() || '—')) parts.push('Notas de la fase');
  return parts.join(' · ');
}

function createBody(draft: Draft, zone: string): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    code: draft.code.trim() || null,
    startsAt: toIso(draft.startsLocal, zone),
    endsAt: toIso(draft.endsLocal, zone),
    status: draft.status,
    channels: draft.channels,
    allocationPercent: draft.allocation,
    maxPerOrder: draft.maxPerOrder,
    discountPercent: draft.discount,
    priority: draft.priority,
    notes: draft.notes.trim() || null,
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

function ChannelSheet({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = CHANNELS.filter((channel) => channelLabel(channel).toLowerCase().includes(needle));
  return (
    <div>
      <button
        type="button"
        className={controlStyles.trigger}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        {channelsValue(value)}
      </button>
      {open ? (
        <div className={controlStyles.sheet} role="listbox" aria-label="Canales de la fase" aria-multiselectable="true">
          <Field label="Buscar" kind="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <p className={styles.tertiary}>Vacío: los trece.</p>
          {shown.length === 0 ? <p className={styles.quiet}>Nada con ese criterio.</p> : null}
          {shown.map((channel) => {
            const selected = value.includes(channel);
            return (
              <button
                key={channel}
                type="button"
                role="option"
                aria-selected={selected}
                className={controlStyles.option}
                onClick={() => {
                  onChange(selected ? value.filter((item) => item !== channel) : [...value, channel]);
                }}
              >
                {channelLabel(channel)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PhasesSection({
  eventId,
  event,
  token,
  canWrite,
}: {
  eventId: string;
  event: unknown;
  token: string;
  canWrite: boolean;
}) {
  const row = asRecord(event);
  const zone = readString(row.timezone) ?? 'America/Mexico_City';
  const eventStarts = readString(row.startsAt);
  const [saved, setSaved] = useState<Draft[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await adminApi<unknown>(`/events/manage/${eventId}/sale-phases`, token);
      const next = readPhases(payload, zone);
      setSaved(next);
      setDrafts(next);
      setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
    } catch (cause) {
      setLoadError(failMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // La zona y el evento no cambian la lista: se vuelve a leer al guardar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, token]);

  function patch(id: string, partial: Partial<Draft>) {
    setDrafts((current) => current.map((item) => (item.id === id ? { ...item, ...partial } : item)));
    setNotice(null);
    setError(null);
  }

  function add() {
    const existing = drafts.find((item) => item.isNew);
    if (existing) {
      setOpenId(existing.id);
      return;
    }
    const created = blank(zone, eventStarts);
    setDrafts((current) => [...current, created]);
    setOpenId(created.id);
    setNotice(null);
  }

  const pending = drafts.filter((draft) => {
    if (draft.isNew) return true;
    const base = saved.find((item) => item.id === draft.id);
    if (!base) return true;
    return Object.keys(patchBody(draft, base, zone)).length > 0;
  });
  const dirty = pending.length > 0;
  const valid = pending.every(phaseValid);

  async function save() {
    if (!dirty || !valid || saving || !canWrite) return;
    setSaving(true);
    setError(null);
    const lines: string[] = [];
    const done = new Set<string>();
    let failedMessage: string | null = null;
    for (const draft of pending) {
      const base = saved.find((item) => item.id === draft.id) ?? null;
      try {
        if (draft.isNew) {
          await adminApi(`/events/manage/${eventId}/sale-phases`, token, {
            method: 'POST',
            body: JSON.stringify(createBody(draft, zone)),
          });
        } else if (base) {
          const body = patchBody(draft, base, zone);
          if (Object.keys(body).length === 0) continue;
          await adminApi(`/events/manage/${eventId}/sale-phases/${draft.id}`, token, {
            method: 'PUT',
            body: JSON.stringify(body),
          });
        }
        done.add(draft.id);
        lines.push(changeLine(draft, base));
      } catch (cause) {
        failedMessage = failMessage(cause);
        break;
      }
    }
    const keep = pending.filter((draft) => !done.has(draft.id));
    try {
      const payload = await adminApi<unknown>(`/events/manage/${eventId}/sale-phases`, token);
      const next = readPhases(payload, zone);
      const keptById = new Map(keep.filter((draft) => !draft.isNew).map((draft) => [draft.id, draft]));
      const merged = [
        ...next.map((draft) => keptById.get(draft.id) ?? draft),
        ...keep.filter((draft) => draft.isNew),
      ];
      setSaved(next);
      setDrafts(merged);
      setOpenId((current) => {
        if (keep[0]) return keep[0].id;
        if (current && merged.some((item) => item.id === current)) return current;
        return merged.at(-1)?.id ?? null;
      });
    } catch (cause) {
      failedMessage = failedMessage ?? failMessage(cause);
    }
    if (lines.length) setNotice(lines.join(' · '));
    if (failedMessage) setError(failedMessage);
    setSaving(false);
  }

  if (loading) return <p className={styles.quiet}>Cargando fases.</p>;
  if (loadError) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Fases</h1>
          <p className={styles.danger} role="alert">
            {loadError}
          </p>
        </header>
        <TicketButton variant="secondary" onClick={() => void load()}>
          Reintentar
        </TicketButton>
      </section>
    );
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Fases</h1>
        <p className={styles.quiet}>Una fase abierta a la vez. Socios no abre un club.</p>
        {canWrite ? (
          <TicketButton variant="secondary" onClick={add}>
            Agregar fase
          </TicketButton>
        ) : null}
      </header>
      {drafts.length === 0 ? <p className={styles.quiet}>No hay fases.</p> : null}
      <div className={styles.stack}>
        {drafts.map((draft) => {
          const open = openId === draft.id;
          return (
            <div key={draft.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : draft.id)}
              >
                <span>{draft.name.trim() || 'Sin nombre'}</span>
                <span className={styles.figure}>
                  {labelOf(STATUSES, draft.status)} · {allocationValue(draft.allocation)}
                </span>
              </button>
              {open ? (
                <>
                  <Param name="Nombre de la fase">
                    <ParameterCard
                      name="Nombre de la fase"
                      value={draft.name.trim() || '—'}
                      effect="Único por evento."
                    >
                      {canWrite ? (
                        <Field
                          label="Nombre de la fase"
                          value={draft.name}
                          onChange={(event) => patch(draft.id, { name: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Tipo de fase">
                    <ParameterCard
                      name="Tipo de fase"
                      value={labelOf(KINDS, draft.kind)}
                      effect="Socios está en el segmento. No hay producto de membresía detrás."
                    >
                      {canWrite ? (
                        <Segment
                          label="Tipo de fase"
                          value={draft.kind}
                          options={[...KINDS]}
                          onChange={(next) => patch(draft.id, { kind: next })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Código de acceso">
                    <ParameterCard
                      name="Código de acceso"
                      value={draft.code.trim() || 'Ninguno'}
                      valueStyle="mono"
                      effect="Vacío: entra quien pueda comprar."
                    >
                      {canWrite ? (
                        <Field
                          label="Código de acceso"
                          value={draft.code}
                          onChange={(event) => patch(draft.id, { code: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Inicio de la fase">
                    <ParameterCard
                      name="Inicio de la fase"
                      value={shownWhen(draft.startsLocal, zone)}
                      effect="Abre la venta de esta fase."
                    >
                      {canWrite ? (
                        <Field
                          label="Inicio de la fase"
                          type="datetime-local"
                          value={draft.startsLocal}
                          onChange={(event) => patch(draft.id, { startsLocal: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Fin de la fase">
                    <ParameterCard
                      name="Fin de la fase"
                      value={shownWhen(draft.endsLocal, zone)}
                      effect="Salvo puerta, no puede pasar del inicio del evento."
                    >
                      {canWrite ? (
                        <Field
                          label="Fin de la fase"
                          type="datetime-local"
                          value={draft.endsLocal}
                          onChange={(event) => patch(draft.id, { endsLocal: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Estado de la fase">
                    <ParameterCard
                      name="Estado de la fase"
                      value={labelOf(STATUSES, draft.status)}
                      effect="Programada, activa, terminada o cancelada."
                    >
                      {canWrite ? (
                        <Segment
                          label="Estado de la fase"
                          value={draft.status}
                          options={[...STATUSES]}
                          onChange={(next) => patch(draft.id, { status: next })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Canales de la fase">
                    <ParameterCard
                      name="Canales de la fase"
                      value={channelsValue(draft.channels)}
                      effect="Vacío significa los trece."
                    >
                      {canWrite ? (
                        <ChannelSheet
                          value={draft.channels}
                          onChange={(next) => patch(draft.id, { channels: next })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Cupo de la fase">
                    <ParameterCard
                      name="Cupo de la fase"
                      value={allocationValue(draft.allocation)}
                      valueStyle="tabular"
                      effect="Porcentaje del aforo. Sin tope si queda vacío."
                    >
                      {canWrite ? (
                        <>
                          <Stepper
                            label="Cupo de la fase"
                            value={draft.allocation}
                            min={1}
                            max={100}
                            unit="%"
                            onChange={(next) => patch(draft.id, { allocation: next })}
                          />
                          {draft.allocation != null ? (
                            <TicketButton variant="ghost" onClick={() => patch(draft.id, { allocation: null })}>
                              Sin tope
                            </TicketButton>
                          ) : null}
                        </>
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Máximo por orden en la fase">
                    <ParameterCard
                      name="Máximo por orden en la fase"
                      value={draft.maxPerOrder == null ? 'El de la zona' : String(draft.maxPerOrder)}
                      valueStyle="tabular"
                      effect="Si queda vacío, manda el máximo de la zona."
                    >
                      {canWrite ? (
                        <>
                          <Stepper
                            label="Máximo por orden en la fase"
                            value={draft.maxPerOrder}
                            min={1}
                            max={null}
                            onChange={(next) => patch(draft.id, { maxPerOrder: next })}
                          />
                          {draft.maxPerOrder != null ? (
                            <TicketButton variant="ghost" onClick={() => patch(draft.id, { maxPerOrder: null })}>
                              El de la zona
                            </TicketButton>
                          ) : null}
                        </>
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Descuento de la fase">
                    <ParameterCard
                      name="Descuento de la fase"
                      value={`${draft.discount}%`}
                      valueStyle="tabular"
                      effect="Porcentaje de esta fase."
                    >
                      {canWrite ? (
                        <Stepper
                          label="Descuento de la fase"
                          value={draft.discount}
                          min={0}
                          max={100}
                          unit="%"
                          onChange={(next) => patch(draft.id, { discount: next })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Prioridad">
                    <ParameterCard
                      name="Prioridad"
                      value={String(draft.priority)}
                      valueStyle="tabular"
                      effect="La menor corre primero si se empalman."
                    >
                      {canWrite ? (
                        <Stepper
                          label="Prioridad"
                          value={draft.priority}
                          min={0}
                          max={null}
                          onChange={(next) => patch(draft.id, { priority: next })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Notas de la fase">
                    <ParameterCard
                      name="Notas de la fase"
                      value={draft.notes.trim() || '—'}
                      effect="Uso interno."
                    >
                      {canWrite ? (
                        <Field
                          label="Notas de la fase"
                          value={draft.notes}
                          onChange={(event) => patch(draft.id, { notes: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      ) : null}
      {canWrite ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty && !valid ? 'La fase necesita nombre, inicio y un fin posterior.' : dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || !valid || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
