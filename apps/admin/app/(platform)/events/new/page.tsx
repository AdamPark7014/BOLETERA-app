'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { countSeats } from '@boletera/venue-engine';
import { ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import {
  createEvent,
  createEventSeries,
  createResidency,
  getVenueLayout,
  listVenues,
} from '@/lib/platform-api';
import { AnonymousView, NoOrgView, useSession } from '../_shared/api-state';
import { AdminFrame } from '../_ticket/AdminFrame';
import { Param, Segment, SheetSelect, Stepper } from '../_ticket/controls';
import styles from '../_ticket/frame.module.scss';

const DRAFT_KEY = 'boletera_draft_event';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type EventType = 'single' | 'series' | 'residency';
type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

type FormState = {
  title: string;
  description: string;
  type: EventType;
  startDate: string;
  endDate: string;
  salesStartAt: string;
  salesEndAt: string;
  venueId: string;
  capacity: string;
  basePrice: string;
  zoneName: string;
  seriesCount: string;
  residencyCount: string;
  frequency: Frequency;
};

const EMPTY: FormState = {
  title: '',
  description: '',
  type: 'single',
  startDate: '',
  endDate: '',
  salesStartAt: '',
  salesEndAt: '',
  venueId: '',
  capacity: '',
  basePrice: '',
  zoneName: '',
  seriesCount: '3',
  residencyCount: '8',
  frequency: 'weekly',
};

type MapState = { status: 'idle' | 'loading' | 'ok' | 'empty' | 'missing'; seats: number };

function parseLocal(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value : fallback;
}

function readDraft(value: unknown): FormState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = record.type;
  const frequency = record.frequency;
  return {
    ...EMPTY,
    title: asText(record.title),
    description: asText(record.description),
    type: type === 'series' || type === 'residency' || type === 'single' ? type : 'single',
    startDate: asText(record.startDate),
    endDate: asText(record.endDate),
    salesStartAt: asText(record.salesStartAt),
    salesEndAt: asText(record.salesEndAt),
    venueId: asText(record.venueId),
    capacity: asText(record.capacity),
    basePrice: asText(record.basePrice),
    zoneName: asText(record.zoneName),
    seriesCount: asText(record.seriesCount, '3'),
    residencyCount: asText(record.residencyCount, '8'),
    frequency:
      frequency === 'daily' || frequency === 'weekly' || frequency === 'biweekly' || frequency === 'monthly'
        ? frequency
        : 'weekly',
  };
}

export default function NewEventPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <CreateBody />
      </AdminFrame>
    </Suspense>
  );
}

function CreateBody() {
  const router = useRouter();
  const session = useSession();
  const token = session.token;
  const canCreate = hasCapability(session.role, 'events.manage');
  const [venues, setVenues] = useState<{ id: string; name: string; capacity?: number }[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [map, setMap] = useState<MapState>({ status: 'idle', seats: 0 });
  const [draftFound, setDraftFound] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt?: number; form?: unknown };
      if (!parsed?.form || !parsed.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setDraftFound(readDraft(parsed.form));
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (JSON.stringify(form) === JSON.stringify(EMPTY)) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), form }));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [form]);

  useEffect(() => {
    if (!token) return;
    listVenues(token)
      .then(setVenues)
      .catch(() => setVenues([]));
  }, [token]);

  useEffect(() => {
    if (!token || !form.venueId) {
      setMap({ status: 'idle', seats: 0 });
      return;
    }
    let alive = true;
    setMap({ status: 'loading', seats: 0 });
    getVenueLayout(token, form.venueId)
      .then((data) => {
        if (!alive) return;
        const seats = data.layout?.mapData ? countSeats(data.layout.mapData) : 0;
        setMap({ status: seats > 0 ? 'ok' : 'empty', seats });
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        const missing = cause instanceof ApiError && cause.isNotFound;
        setMap({ status: missing ? 'missing' : 'empty', seats: 0 });
      });
    return () => {
      alive = false;
    };
  }, [token, form.venueId]);

  const price = Number(form.basePrice);
  const capacity = Number(form.capacity);
  const start = parseLocal(form.startDate);
  const end = parseLocal(form.endDate);
  const salesStart = parseLocal(form.salesStartAt);
  const salesEnd = parseLocal(form.salesEndAt);
  const seriesCount = Number(form.seriesCount);
  const residencyCount = Number(form.residencyCount);

  const titleError = form.title.trim().length > 0 && form.title.trim().length < 3
    ? 'El título necesita al menos 3 caracteres.'
    : undefined;
  const startError = form.startDate && start && start.getTime() < Date.now()
    ? 'La fecha de inicio ya pasó.'
    : undefined;
  const endError = start && end && end.getTime() <= start.getTime()
    ? 'El fin es anterior o igual al inicio.'
    : undefined;
  const salesError =
    salesStart && salesEnd && salesEnd.getTime() <= salesStart.getTime()
      ? 'La venta cierra antes de abrir.'
      : start && salesEnd && salesEnd.getTime() > start.getTime()
        ? 'La venta termina después de que empieza la función.'
        : start && salesStart && salesStart.getTime() > start.getTime()
          ? 'La venta abre después de que empieza la función.'
          : undefined;
  const venueError =
    map.status === 'missing'
      ? 'El recinto no tiene mapa.'
      : map.status === 'empty'
        ? 'El mapa del recinto no tiene butacas.'
        : undefined;
  const capacityError =
    form.capacity !== '' && (!Number.isFinite(capacity) || capacity <= 0)
      ? 'El cupo tiene que ser mayor que cero.'
      : map.status === 'ok' && Number.isFinite(capacity) && capacity > map.seats
        ? `El cupo supera las butacas del mapa (${map.seats.toLocaleString('es-MX')}).`
        : undefined;
  const priceError =
    form.basePrice !== '' && (!Number.isFinite(price) || price <= 0)
      ? 'El precio tiene que ser mayor que $0.00.'
      : undefined;
  const zoneError = form.zoneName !== '' && !form.zoneName.trim() ? 'La zona necesita un nombre.' : undefined;
  const seriesError =
    form.type === 'series' && (seriesCount < 2 || seriesCount > 52)
      ? 'Una serie necesita entre 2 y 52 fechas.'
      : form.type === 'residency' && (residencyCount < 2 || residencyCount > 100)
        ? 'Una residencia necesita entre 2 y 100 funciones.'
        : undefined;

  const ready =
    canCreate &&
    form.title.trim().length >= 3 &&
    form.venueId !== '' &&
    start != null &&
    start.getTime() >= Date.now() &&
    form.zoneName.trim().length > 0 &&
    price > 0 &&
    capacity > 0 &&
    map.status === 'ok' &&
    capacity <= map.seats &&
    !endError &&
    !salesError &&
    !seriesError;

  const venueName = venues.find((venue) => venue.id === form.venueId)?.name ?? '—';

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  async function submit() {
    if (!token || !ready || saving || !start) return;
    setSaving(true);
    setError(null);
    try {
      if (form.type === 'series') {
        const dates = Array.from({ length: seriesCount }, (_, index) => {
          const date = new Date(form.startDate);
          date.setDate(date.getDate() + index * 7);
          return {
            date: date.toISOString(),
            title: `${form.title.trim()} — fecha ${index + 1}`,
            capacity,
            basePrice: price,
          };
        });
        await createEventSeries(token, {
          seriesName: form.title.trim(),
          description: form.description,
          venueId: form.venueId,
          occurrences: dates,
        });
        localStorage.removeItem(DRAFT_KEY);
        router.push('/events');
        return;
      }
      if (form.type === 'residency') {
        await createResidency(token, {
          name: form.title.trim(),
          venueId: form.venueId,
          startDate: form.startDate,
          frequency: form.frequency,
          occurrenceCount: residencyCount,
          capacity,
          basePrice: price,
        });
        localStorage.removeItem(DRAFT_KEY);
        router.push('/events');
        return;
      }
      const event = await createEvent(token, {
        title: form.title.trim(),
        description: form.description,
        type: 'single',
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        venueId: form.venueId,
        capacity,
        basePrice: price,
        salesStartAt: form.salesStartAt || undefined,
        salesEndAt: form.salesEndAt || undefined,
      });
      localStorage.removeItem(DRAFT_KEY);
      router.push(event.id ? `/events/${event.id}?seccion=zonas` : '/events');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : 'No se guardó. Revisa la conexión.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Crear evento</h1>
        <p className={styles.quiet}>El evento queda en borrador.</p>
      </header>
      {draftFound ? (
        <div className={styles.stack}>
          <p className={styles.quiet}>Hay un borrador sin terminar.</p>
          <TicketButton
            variant="secondary"
            onClick={() => {
              setForm(draftFound);
              setDraftFound(null);
            }}
          >
            Retomar borrador
          </TicketButton>
          <TicketButton
            variant="ghost"
            onClick={() => {
              localStorage.removeItem(DRAFT_KEY);
              setDraftFound(null);
            }}
          >
            Descartar
          </TicketButton>
        </div>
      ) : null}
      {!canCreate ? <p className={styles.quiet}>Tu rol no crea eventos.</p> : null}
      <div className={styles.stack}>
        <Param name="Título">
          <ParameterCard
            name="Título"
            value={form.title.trim() || '—'}
            effect="Nombre en la ficha y en la venta."
          >
            {canCreate ? (
              <Field
                label="Título"
                value={form.title}
                error={titleError}
                onChange={(event) => set('title', event.target.value)}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Recinto">
          <ParameterCard name="Recinto" value={venueName} effect="Sala de la función.">
            {canCreate ? (
              <>
                <SheetSelect
                  label="Recinto"
                  value={form.venueId}
                  placeholder="Elegir recinto"
                  options={venues.map((venue) => ({ value: venue.id, label: venue.name }))}
                  onChange={(venueId) => set('venueId', venueId)}
                />
                {venueError ? <p className={styles.danger}>{venueError}</p> : null}
                {map.status === 'loading' ? <p className={styles.tertiary}>Leyendo el mapa.</p> : null}
              </>
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Inicio">
          <ParameterCard
            name="Inicio"
            value={form.startDate ? form.startDate.replace('T', ' ') : '—'}
            effect="Hora de la función."
          >
            {canCreate ? (
              <Field
                label="Inicio"
                type="datetime-local"
                value={form.startDate}
                error={startError}
                onChange={(event) => set('startDate', event.target.value)}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Zona">
          <ParameterCard
            name="Zona"
            value={form.zoneName.trim() || '—'}
            effect="Nombre de la primera zona."
          >
            {canCreate ? (
              <Field
                label="Zona"
                value={form.zoneName}
                error={zoneError}
                onChange={(event) => set('zoneName', event.target.value)}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Precio base">
          <ParameterCard
            name="Precio base"
            value={price > 0 ? formatTicketAmount(price) : '—'}
            valueStyle="tabular"
            effect="Lo que recibe el promotor por boleto."
          >
            {canCreate ? (
              <Field
                label="Precio base"
                kind="money"
                value={form.basePrice}
                error={priceError}
                onChange={(event) => set('basePrice', event.target.value)}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Cupo de la oferta">
          <ParameterCard
            name="Cupo de la oferta"
            value={capacity > 0 ? capacity.toLocaleString('es-MX') : '—'}
            valueStyle="tabular"
            effect="Cupo de la primera zona."
            closedNote="Apartado 15 min · Reembolsable · Transferible · Cargo 10% · IVA 16%."
            advanced={
              canCreate ? (
                <div className={styles.stack}>
                  <Field
                    label="Descripción"
                    value={form.description}
                    onChange={(event) => set('description', event.target.value)}
                  />
                  <Field
                    label="Fin"
                    type="datetime-local"
                    value={form.endDate}
                    error={endError}
                    onChange={(event) => set('endDate', event.target.value)}
                  />
                  <Field
                    label="Inicio de venta"
                    type="datetime-local"
                    value={form.salesStartAt}
                    error={salesError}
                    onChange={(event) => set('salesStartAt', event.target.value)}
                  />
                  <Field
                    label="Fin de venta"
                    type="datetime-local"
                    value={form.salesEndAt}
                    error={salesError}
                    onChange={(event) => set('salesEndAt', event.target.value)}
                  />
                  <Segment
                    label="Tipo"
                    value={form.type}
                    options={[
                      { value: 'single', label: 'Único' },
                      { value: 'series', label: 'Serie' },
                      { value: 'residency', label: 'Residencia' },
                    ]}
                    onChange={(type) => set('type', type)}
                  />
                  {form.type === 'series' ? (
                    <Stepper
                      label="Fechas"
                      value={Number.isFinite(seriesCount) ? seriesCount : null}
                      min={2}
                      max={52}
                      onChange={(next) => set('seriesCount', String(next))}
                    />
                  ) : null}
                  {form.type === 'residency' ? (
                    <>
                      <Segment
                        label="Frecuencia"
                        value={form.frequency}
                        options={[
                          { value: 'daily', label: 'Diaria' },
                          { value: 'weekly', label: 'Semanal' },
                          { value: 'biweekly', label: 'Quincenal' },
                          { value: 'monthly', label: 'Mensual' },
                        ]}
                        onChange={(frequency) => set('frequency', frequency)}
                      />
                      <Stepper
                        label="Funciones"
                        value={Number.isFinite(residencyCount) ? residencyCount : null}
                        min={2}
                        max={100}
                        onChange={(next) => set('residencyCount', String(next))}
                      />
                    </>
                  ) : null}
                  {seriesError ? <p className={styles.danger}>{seriesError}</p> : null}
                </div>
              ) : (
                <p className={styles.quiet}>Tu rol no crea eventos.</p>
              )
            }
          >
            {canCreate ? (
              <>
                <Stepper
                  label="Cupo"
                  value={form.capacity === '' ? null : capacity}
                  min={1}
                  max={map.status === 'ok' ? map.seats : null}
                  onChange={(next) => set('capacity', String(next))}
                />
                {capacityError ? <p className={styles.danger}>{capacityError}</p> : null}
              </>
            ) : null}
          </ParameterCard>
        </Param>
      </div>
      {error ? (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      ) : null}
      {canCreate ? (
        <div className={styles.saveBar}>
          <p className={styles.tertiary}>Apartado 15 min · Reembolsable · Transferible · Cargo 10% · IVA 16%.</p>
          <TicketButton disabled={!ready || saving} onClick={() => void submit()}>
            Crear evento
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
