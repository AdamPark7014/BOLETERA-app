'use client';

/**
 * Alta de evento con validación al momento.
 *
 * Antes el asistente solo comprobaba que los campos no estuvieran vacíos, así
 * que se podía crear un evento sin precio, con un aforo que no existe en el mapa
 * o con la venta cerrando después de la función. Todo eso se detectaba en
 * producción. Ahora cada regla se evalúa en cada tecla y el botón de crear no se
 * habilita mientras quede un error; los avisos no bloquean pero se ven.
 *
 * El borrador se guarda solo: llenar cuatro pasos y perderlos por un F5 o por un
 * 401 a mitad de camino era la queja número uno.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardFooter, CardHeader, PageHeader } from '@boletera/ui';
import { createEvent, createEventSeries, createResidency, getVenueLayout, listVenues } from '@/lib/platform-api';
import { countSeats } from '@boletera/venue-engine';
import { ApiError } from '@/lib/api';
import { AnonymousView, NoOrgView, useSession } from '../_shared/api-state';
import styles from './new-event.module.scss';

const STEPS = ['Datos', 'Venue / mapa', 'Ofertas / precios', 'Publicar'] as const;

const STEP_HINTS: Record<(typeof STEPS)[number], string> = {
  Datos: 'Información básica del evento y ventana de venta.',
  'Venue / mapa': 'Recinto, mapa de butacas y aforo declarado.',
  'Ofertas / precios': 'Zona inicial y precio base en MXN.',
  Publicar: 'Revisa el resumen antes de confirmar la creación.',
};

const DRAFT_KEY = 'boletera_draft_event';
/** Un borrador de hace más de una semana es ruido, no trabajo pendiente. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type EventForm = {
  title: string;
  description: string;
  type: 'single' | 'series' | 'residency';
  startDate: string;
  endDate: string;
  salesStartAt: string;
  salesEndAt: string;
  venueId: string;
  capacity: number;
  basePrice: number;
  zoneName: string;
  seriesCount: number;
  residencyCount: number;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
};

const EMPTY_FORM: EventForm = {
  title: '',
  description: '',
  type: 'single',
  startDate: '',
  endDate: '',
  salesStartAt: '',
  salesEndAt: '',
  venueId: '',
  capacity: 5000,
  basePrice: 150,
  zoneName: 'General',
  seriesCount: 3,
  residencyCount: 8,
  frequency: 'weekly',
};

type Issue = {
  /** `error` impide crear; `warning` solo avisa. */
  severity: 'error' | 'warning';
  /** Paso al que lleva el enlace del aviso. */
  step: number;
  /** `id` del control al que hay que mover el foco. */
  field: string;
  message: string;
  hint?: string;
};

type VenueMapInfo = {
  venueId: string;
  layoutId: string | null;
  seats: number;
  status: 'loading' | 'ok' | 'empty' | 'missing';
};

function parseLocal(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Todas las reglas en un solo sitio, evaluadas en cada render.
 *
 * Devolver una lista plana (en vez de marcar cada input) permite pintar el
 * resumen accionable del paso final sin duplicar la lógica.
 */
function validate(form: EventForm, venueMap: VenueMapInfo | null, venueCapacity?: number): Issue[] {
  const issues: Issue[] = [];
  const start = parseLocal(form.startDate);
  const end = parseLocal(form.endDate);
  const salesStart = parseLocal(form.salesStartAt);
  const salesEnd = parseLocal(form.salesEndAt);

  if (form.title.trim().length < 3) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-title',
      message: 'El evento necesita un título de al menos 3 caracteres.',
      hint: 'Es lo que verá el comprador en la web y en el boleto.',
    });
  }

  if (!start) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-start',
      message: 'Falta la fecha y hora de inicio.',
    });
  } else if (start.getTime() < Date.now()) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-start',
      message: 'La fecha de inicio ya pasó.',
      hint: 'Un evento en el pasado no se puede publicar ni vender; corrige la fecha.',
    });
  }

  if (start && end && end.getTime() <= start.getTime()) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-end',
      message: 'El fin del evento es anterior o igual al inicio.',
    });
  }

  if (salesStart && salesEnd && salesEnd.getTime() <= salesStart.getTime()) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-sales-end',
      message: 'La venta cierra antes de abrir.',
    });
  }

  // La regla que más dinero cuesta: vender después de que empezó la función.
  if (start && salesEnd && salesEnd.getTime() > start.getTime()) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-sales-end',
      message: 'La venta termina después de que empieza el evento.',
      hint: 'Cierra la venta como muy tarde a la hora de inicio; si no, se venden boletos para una función que ya arrancó.',
    });
  }

  if (start && salesStart && salesStart.getTime() > start.getTime()) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-sales-start',
      message: 'La venta abre después de que empieza el evento.',
    });
  }

  if (form.type === 'series' && (form.seriesCount < 2 || form.seriesCount > 52)) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-series-count',
      message: 'Una serie necesita entre 2 y 52 fechas.',
    });
  }

  if (form.type === 'residency' && (form.residencyCount < 2 || form.residencyCount > 100)) {
    issues.push({
      severity: 'error',
      step: 0,
      field: 'ev-residency-count',
      message: 'Una residencia necesita entre 2 y 100 funciones.',
    });
  }

  if (!form.venueId) {
    issues.push({
      severity: 'error',
      step: 1,
      field: 'ev-venue',
      message: 'Falta el recinto.',
      hint: 'El inventario se genera a partir del mapa del recinto: sin recinto no hay nada que vender.',
    });
  } else if (venueMap?.status === 'missing') {
    issues.push({
      severity: 'error',
      step: 1,
      field: 'ev-venue',
      message: 'El recinto elegido no tiene mapa guardado.',
      hint: 'Abre el diseñador de mapa del recinto y guarda un layout antes de crear el evento.',
    });
  } else if (venueMap?.status === 'empty') {
    issues.push({
      severity: 'error',
      step: 1,
      field: 'ev-venue',
      message: 'El mapa del recinto no tiene ninguna butaca.',
      hint: 'Genera las zonas y butacas en el diseñador; publicar sobre un mapa vacío produce cero boletos.',
    });
  }

  if (!Number.isFinite(form.capacity) || form.capacity <= 0) {
    issues.push({
      severity: 'error',
      step: 1,
      field: 'ev-capacity',
      message: 'El aforo debe ser mayor que cero.',
    });
  } else if (venueMap?.status === 'ok' && form.capacity > venueMap.seats) {
    issues.push({
      severity: 'error',
      step: 1,
      field: 'ev-capacity',
      message: `El aforo declarado (${form.capacity.toLocaleString('es-MX')}) supera las butacas del mapa (${venueMap.seats.toLocaleString('es-MX')}).`,
      hint: 'Se venderían más boletos de los que existen. Baja el aforo o añade butacas al mapa.',
    });
  } else if (venueMap?.status === 'ok' && form.capacity < venueMap.seats) {
    issues.push({
      severity: 'warning',
      step: 1,
      field: 'ev-capacity',
      message: `Quedan ${(venueMap.seats - form.capacity).toLocaleString('es-MX')} butacas del mapa fuera del aforo declarado.`,
      hint: 'Es válido (aforo reducido), pero confirma que es intencional.',
    });
  }

  if (venueCapacity && form.capacity > venueCapacity) {
    issues.push({
      severity: 'warning',
      step: 1,
      field: 'ev-capacity',
      message: `El aforo supera la capacidad registrada del recinto (${venueCapacity.toLocaleString('es-MX')}).`,
    });
  }

  if (!Number.isFinite(form.basePrice) || form.basePrice <= 0) {
    issues.push({
      severity: 'error',
      step: 2,
      field: 'ev-price',
      message: 'Falta el precio base, o es cero.',
      hint: 'Un evento sin precio no se puede poner a la venta. Si es gratuito, créalo con precio simbólico y ajústalo en la pestaña Precios.',
    });
  }

  if (!form.zoneName.trim()) {
    issues.push({
      severity: 'error',
      step: 2,
      field: 'ev-zone',
      message: 'La oferta necesita un nombre de zona.',
    });
  }

  if (!salesEnd) {
    issues.push({
      severity: 'warning',
      step: 0,
      field: 'ev-sales-end',
      message: 'No definiste cierre de venta.',
      hint: 'Sin cierre, la venta sigue abierta hasta que alguien la pare a mano.',
    });
  }

  return issues;
}

export default function NewEventPage() {
  const router = useRouter();
  const session = useSession();
  const [venues, setVenues] = useState<{ id: string; name: string; capacity?: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const [venueMap, setVenueMap] = useState<VenueMapInfo | null>(null);
  const [draftFound, setDraftFound] = useState<EventForm | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftLoaded = useRef(false);

  const token = session.token;

  const set = useCallback(<K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  /* ── Borrador ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt: number; form: EventForm };
      if (!parsed?.form || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setDraftFound({ ...EMPTY_FORM, ...parsed.form });
      setDraftSavedAt(parsed.savedAt);
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    // No se guarda el formulario vacío: dejaría un borrador falso en cada visita.
    if (!draftLoaded.current && form === EMPTY_FORM) return;
    const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
    if (!dirty) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), form }));
        setDraftSavedAt(Date.now());
      } catch {
        // Cuota llena: no vale la pena romper el alta por no poder guardar el borrador.
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [form]);

  function restoreDraft() {
    if (!draftFound) return;
    draftLoaded.current = true;
    setForm(draftFound);
    setDraftFound(null);
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setDraftFound(null);
    setDraftSavedAt(null);
  }

  /* ── Datos del recinto ──────────────────────────────────────────────────── */

  useEffect(() => {
    if (!token) return;
    listVenues(token)
      .then(setVenues)
      .catch(() => setVenues([]));
  }, [token]);

  useEffect(() => {
    if (!token || !form.venueId) {
      setVenueMap(null);
      return;
    }
    let alive = true;
    setVenueMap({ venueId: form.venueId, layoutId: null, seats: 0, status: 'loading' });
    getVenueLayout(token, form.venueId)
      .then((data) => {
        if (!alive) return;
        const seats = data.layout?.mapData ? countSeats(data.layout.mapData) : 0;
        setVenueMap({
          venueId: form.venueId,
          layoutId: data.layout?.id ?? null,
          seats,
          status: seats > 0 ? 'ok' : 'empty',
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // 404 = el recinto todavía no tiene layout: es un error de datos, no de red.
        const missing = err instanceof ApiError && err.isNotFound;
        setVenueMap({
          venueId: form.venueId,
          layoutId: null,
          seats: 0,
          status: missing ? 'missing' : 'empty',
        });
      });
    return () => {
      alive = false;
    };
  }, [token, form.venueId]);

  const selectedVenue = venues.find((v) => v.id === form.venueId);
  const issues = useMemo(
    () => validate(form, venueMap, selectedVenue?.capacity),
    [form, venueMap, selectedVenue],
  );
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const stepErrors = (s: number) => errors.filter((i) => i.step === s);

  /** Lleva al paso del problema y pone el foco en el control. */
  function goToIssue(issue: Issue) {
    setStep(issue.step);
    requestAnimationFrame(() => {
      const el = document.getElementById(issue.field);
      if (el instanceof HTMLElement) {
        el.focus();
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  async function submit() {
    if (!token || errors.length > 0) return;
    setSaving(true);
    setMsg(null);
    try {
      if (form.type === 'series') {
        const dates = Array.from({ length: form.seriesCount }, (_, i) => {
          const d = new Date(form.startDate);
          d.setDate(d.getDate() + i * 7);
          return {
            date: d.toISOString(),
            title: `${form.title} — fecha ${i + 1}`,
            capacity: form.capacity,
            basePrice: form.basePrice,
          };
        });
        const result = await createEventSeries(token, {
          seriesName: form.title,
          description: form.description,
          venueId: form.venueId,
          occurrences: dates,
        });
        localStorage.removeItem(DRAFT_KEY);
        setMsg(`Serie creada: ${result.totalEvents} eventos`);
        router.push('/events');
        return;
      }

      if (form.type === 'residency') {
        const result = await createResidency(token, {
          name: form.title,
          venueId: form.venueId,
          startDate: form.startDate,
          frequency: form.frequency,
          occurrenceCount: form.residencyCount,
          capacity: form.capacity,
          basePrice: form.basePrice,
        });
        localStorage.removeItem(DRAFT_KEY);
        setMsg(`Residencia creada: ${result.totalEvents} fechas`);
        router.push('/events');
        return;
      }

      const event = await createEvent(token, {
        title: form.title,
        description: form.description,
        type: form.type,
        startDate: form.startDate,
        venueId: form.venueId,
        capacity: form.capacity,
        basePrice: form.basePrice,
        // La ventana de venta se validaba en el asistente y se descartaba antes
        // de llegar al API. Ahora se envía y se guarda.
        salesStartAt: form.salesStartAt || undefined,
        salesEndAt: form.salesEndAt || undefined,
      });
      localStorage.removeItem(DRAFT_KEY);
      router.push(`/events/${event.id}`);
    } catch (err) {
      // El borrador se conserva a propósito: si el alta falla, el trabajo sigue ahí.
      setMsg(
        err instanceof ApiError
          ? `${err.userMessage} (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Error al crear',
      );
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;

  const stepDescription = `Paso ${step + 1} de ${STEPS.length}: ${STEPS[step]}${
    draftSavedAt
      ? ` · borrador guardado ${new Date(draftSavedAt).toLocaleTimeString('es-MX')}`
      : ''
  }`;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Catálogo"
        title="Nuevo evento"
        description={stepDescription}
        breadcrumbs={[
          { label: 'Eventos', href: '/events' },
          { label: 'Nuevo evento' },
        ]}
        actions={
          <Button type="button" variant="outline" onClick={() => router.push('/events')}>
            ← Volver
          </Button>
        }
      />

      {draftFound && (
        <div className={styles.draftBanner} role="status">
          <p>
            Hay un borrador sin terminar de{' '}
            <strong>{draftFound.title || 'un evento sin título'}</strong>
            {draftSavedAt ? ` (${new Date(draftSavedAt).toLocaleString('es-MX')})` : ''}.
          </p>
          <div className={styles.draftActions}>
            <Button type="button" onClick={restoreDraft}>
              Retomar borrador
            </Button>
            <Button type="button" variant="outline" onClick={discardDraft}>
              Descartar
            </Button>
          </div>
        </div>
      )}

      {msg && (
        <p role="alert" className={styles.submitError}>
          {msg}
        </p>
      )}

      <ol className={styles.steps}>
        {STEPS.map((label, i) => {
          const count = stepErrors(i).length;
          return (
            <li key={label}>
              <button
                type="button"
                className={styles.stepChip}
                data-state={i === step ? 'current' : i < step ? 'done' : 'todo'}
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
              >
                {i + 1}. {label}
                {count > 0 && (
                  <span className={styles.stepBadge} aria-label={`${count} problemas`}>
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <Card variant="outline" padding="lg" className={styles.wizardCard}>
        <CardHeader
          title={step === 3 ? 'Antes de crear' : STEPS[step]}
          description={STEP_HINTS[STEPS[step]]}
        />

        <div className={styles.formGrid}>
          {step === 0 && (
            <>
              <label className={`${styles.field} ${styles.full}`} htmlFor="ev-title">
                Título
                <input
                  id="ev-title"
                  required
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </label>
              <label className={`${styles.field} ${styles.full}`} htmlFor="ev-description">
                Descripción
                <textarea
                  id="ev-description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </label>
              <label className={styles.field} htmlFor="ev-type">
                Tipo
                <select
                  id="ev-type"
                  value={form.type}
                  onChange={(e) => set('type', e.target.value as EventForm['type'])}
                >
                  <option value="single">Single</option>
                  <option value="series">Serie (múltiples fechas)</option>
                  <option value="residency">Residencia (recurrente)</option>
                </select>
              </label>
              <label className={styles.field} htmlFor="ev-start">
                Inicio del evento
                <input
                  id="ev-start"
                  type="datetime-local"
                  required
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </label>
              <label className={styles.field} htmlFor="ev-end">
                Fin del evento (opcional)
                <input
                  id="ev-end"
                  type="datetime-local"
                  value={form.endDate}
                  onChange={(e) => set('endDate', e.target.value)}
                />
              </label>
              <label className={styles.field} htmlFor="ev-sales-start">
                Apertura de venta
                <input
                  id="ev-sales-start"
                  type="datetime-local"
                  value={form.salesStartAt}
                  onChange={(e) => set('salesStartAt', e.target.value)}
                />
              </label>
              <label className={styles.field} htmlFor="ev-sales-end">
                Cierre de venta
                <input
                  id="ev-sales-end"
                  type="datetime-local"
                  value={form.salesEndAt}
                  onChange={(e) => set('salesEndAt', e.target.value)}
                  aria-describedby="ev-sales-end-hint"
                />
              </label>
              <p id="ev-sales-end-hint" className={`${styles.full} ${styles.hint}`}>
                La ventana de venta se valida aquí, pero el API de alta todavía no la persiste
                (`/events/manage` solo acepta inicio y fin del evento). Configúrala en la pestaña de
                canales del evento hasta que exista el campo.
              </p>
              {form.type === 'series' && (
                <label htmlFor="ev-series-count">
                  Nº de fechas
                  <input
                    id="ev-series-count"
                    type="number"
                    min={2}
                    max={52}
                    value={form.seriesCount}
                    onChange={(e) => set('seriesCount', Number(e.target.value))}
                  />
                </label>
              )}
              {form.type === 'residency' && (
                <>
                  <label className={styles.field} htmlFor="ev-frequency">
                    Frecuencia
                    <select
                      id="ev-frequency"
                      value={form.frequency}
                      onChange={(e) => set('frequency', e.target.value as EventForm['frequency'])}
                    >
                      <option value="weekly">Semanal</option>
                      <option value="biweekly">Quincenal</option>
                      <option value="monthly">Mensual</option>
                      <option value="daily">Diaria</option>
                    </select>
                  </label>
                  <label className={styles.field} htmlFor="ev-residency-count">
                    Nº de funciones
                    <input
                      id="ev-residency-count"
                      type="number"
                      min={2}
                      max={100}
                      value={form.residencyCount}
                      onChange={(e) => set('residencyCount', Number(e.target.value))}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <label className={`${styles.field} ${styles.full}`} htmlFor="ev-venue">
                Venue
                <select
                  id="ev-venue"
                  required
                  value={form.venueId}
                  onChange={(e) => set('venueId', e.target.value)}
                  aria-describedby="ev-venue-status"
                >
                  <option value="">Seleccionar…</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>

              <p id="ev-venue-status" className={`${styles.full} ${styles.mapStatus}`}>
                {!form.venueId && 'Elige un recinto para comprobar su mapa.'}
                {venueMap?.status === 'loading' && 'Comprobando el mapa del recinto…'}
                {venueMap?.status === 'ok' && (
                  <>
                    Mapa guardado con <strong>{venueMap.seats.toLocaleString('es-MX')}</strong>{' '}
                    butacas.{' '}
                    <Link href={`/venues/${form.venueId}/map`}>Abrir el diseñador de mapa</Link>
                  </>
                )}
                {venueMap?.status === 'empty' && (
                  <>
                    El mapa existe pero no tiene butacas.{' '}
                    <Link href={`/venues/${form.venueId}/map`}>Generar zonas y butacas</Link>
                  </>
                )}
                {venueMap?.status === 'missing' && (
                  <>
                    Este recinto no tiene layout guardado.{' '}
                    <Link href={`/venues/${form.venueId}/map`}>Crear el mapa</Link>
                  </>
                )}
              </p>

              <label className={styles.field} htmlFor="ev-capacity">
                Aforo declarado
                <input
                  id="ev-capacity"
                  type="number"
                  min={1}
                  value={form.capacity}
                  onChange={(e) => set('capacity', Number(e.target.value))}
                />
              </label>

              {venueMap?.status === 'ok' && venueMap.seats !== form.capacity && (
                <p className={styles.full}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => set('capacity', venueMap.seats)}
                  >
                    Ajustar el aforo a las {venueMap.seats.toLocaleString('es-MX')} butacas del mapa
                  </Button>
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <label className={styles.field} htmlFor="ev-zone">
                Zona / oferta
                <input
                  id="ev-zone"
                  value={form.zoneName}
                  onChange={(e) => set('zoneName', e.target.value)}
                />
              </label>
              <label className={styles.field} htmlFor="ev-price">
                Precio base (MXN)
                <input
                  id="ev-price"
                  type="number"
                  min={1}
                  step={0.01}
                  value={form.basePrice}
                  onChange={(e) => set('basePrice', Number(e.target.value))}
                  aria-describedby="ev-price-hint"
                />
              </label>
              <p id="ev-price-hint" className={`${styles.full} ${styles.hint}`}>
                Se guarda como precio mínimo del evento; el máximo se calcula al 2,5×. Los precios
                por zona se afinan después en la pestaña Precios del evento.
              </p>
            </>
          )}

          {step === 3 && (
            <div className={styles.full}>
              <ul className={styles.summary}>
                <li>
                  <strong>{form.title || '—'}</strong> ({form.type})
                </li>
                <li>Inicio: {form.startDate || '—'}</li>
                <li>Venta: {form.salesStartAt || '—'} → {form.salesEndAt || 'sin cierre'}</li>
                <li>
                  Recinto: {selectedVenue?.name || '—'} ·{' '}
                  {venueMap?.status === 'ok'
                    ? `${venueMap.seats.toLocaleString('es-MX')} butacas en el mapa`
                    : 'sin mapa utilizable'}
                </li>
                <li>Aforo declarado: {form.capacity.toLocaleString('es-MX')}</li>
                <li>
                  Oferta {form.zoneName}: ${form.basePrice} MXN
                </li>
              </ul>
              <p className={styles.hint}>
                El evento se crea en estado BORRADOR. La generación de boletos ocurre al pulsar
                «Publicar inventario» en su ficha, no aquí.
              </p>
            </div>
          )}
        </div>

        {/* Resumen accionable: cada problema lleva a su campo. */}
        {(errors.length > 0 || warnings.length > 0) && (
          <section className={styles.issues} aria-labelledby="issues-title">
            <h2 id="issues-title">
              {errors.length > 0
                ? `${errors.length} ${errors.length === 1 ? 'problema impide' : 'problemas impiden'} crear el evento`
                : `${warnings.length} ${warnings.length === 1 ? 'aviso' : 'avisos'}`}
            </h2>
            <ul>
              {[...errors, ...warnings].map((issue, i) => (
                <li key={`${issue.field}-${i}`} data-severity={issue.severity}>
                  <span className={styles.issueTag}>
                    {issue.severity === 'error' ? 'ERROR' : 'AVISO'}
                  </span>
                  <div>
                    <button
                      type="button"
                      className={styles.issueLink}
                      onClick={() => goToIssue(issue)}
                    >
                      {issue.message}
                    </button>
                    {issue.hint && <p className={styles.issueHint}>{issue.hint}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <CardFooter className={styles.navRow}>
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
              Atrás
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)}>
              Siguiente
            </Button>
          ) : (
            <Button
              type="button"
              loading={saving}
              loadingLabel="Creando…"
              disabled={errors.length > 0}
              onClick={submit}
            >
              Crear evento
            </Button>
          )}
          {step === STEPS.length - 1 && errors.length > 0 && (
            <p className={styles.blockedNote} role="status">
              Resuelve los {errors.length} errores de arriba para habilitar la creación.
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
