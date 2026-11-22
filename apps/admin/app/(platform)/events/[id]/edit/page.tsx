'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Field, ParameterCard, TicketButton, TicketState } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { getEventHub, listVenues, type EventHub } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../_shared/api-state';
import { AdminFrame } from '../../_ticket/AdminFrame';
import { NotFound } from '../../_ticket/NotFound';
import { Param, SheetSelect, Switch } from '../../_ticket/controls';
import styles from '../../_ticket/frame.module.scss';

type VenueOption = { id: string; name: string; capacity?: number };

type PublishCheck = {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'blocker';
  message: string;
  detail?: string;
  action?: { id: string; label: string; detail?: string };
};

type PublishValidation = {
  eventId: string;
  ready: boolean;
  progress: { total: number; passed: number; warnings: number; blockers: number };
  checks: PublishCheck[];
};

type SectionKey = 'basics' | 'schedule' | 'policies' | 'publish';

type FormState = {
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  rating: string;
  venueId: string;
  startDate: string;
  doorsAt: string;
  salesStartAt: string;
  salesEndAt: string;
  totalCapacity: string;
  allowResale: boolean;
  transferAllowed: boolean;
  refundable: boolean;
  resaleMaxPercent: string;
  resaleDeadline: string;
  refundDeadline: string;
  transferDeadline: string;
  capacityExplanation: string;
};

const CATEGORIES = [
  { value: 'MUSIC', label: 'Música' },
  { value: 'SPORTS', label: 'Deportes' },
  { value: 'THEATER', label: 'Teatro' },
  { value: 'COMEDY', label: 'Comedia' },
  { value: 'CONFERENCE', label: 'Conferencia' },
  { value: 'WORKSHOP', label: 'Taller' },
  { value: 'FESTIVAL', label: 'Festival' },
  { value: 'FAMILY', label: 'Familiar' },
  { value: 'STANDUP', label: 'Stand-up' },
  { value: 'CINEMA', label: 'Cine' },
  { value: 'OTHER', label: 'Otro' },
];

function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readPolicies(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const policies = (meta as Record<string, unknown>).eventPolicies;
  return policies && typeof policies === 'object' ? (policies as Record<string, unknown>) : {};
}

function hubToForm(hub: EventHub): FormState {
  const event = hub.event as Record<string, unknown>;
  const meta = event.metadata;
  const policies = readPolicies(meta);
  const explanation =
    meta &&
    typeof meta === 'object' &&
    typeof (meta as Record<string, unknown>).capacityExplanation === 'string'
      ? String((meta as Record<string, unknown>).capacityExplanation)
      : '';
  return {
    title: String(event.title ?? ''),
    description: String(event.description ?? ''),
    imageUrl: String(event.image ?? ''),
    category: String(event.category ?? 'MUSIC'),
    rating: String(event.rating ?? ''),
    venueId: String(event.venueId ?? (event.venue as { id?: string } | undefined)?.id ?? ''),
    startDate: toLocalInput(event.startsAt as string),
    doorsAt: toLocalInput(event.doorsAt as string | null),
    salesStartAt: toLocalInput(event.salesStartAt as string | null),
    salesEndAt: toLocalInput(event.salesEndAt as string | null),
    totalCapacity: String(event.totalCapacity ?? ''),
    allowResale: Boolean(event.allowResale ?? true),
    transferAllowed: Boolean(event.transferAllowed ?? true),
    refundable: Boolean(event.refundable ?? true),
    resaleMaxPercent: policies.resaleMaxPercent != null ? String(policies.resaleMaxPercent) : '',
    resaleDeadline: policies.resaleDeadline ? toLocalInput(String(policies.resaleDeadline)) : '',
    refundDeadline: policies.refundDeadline ? toLocalInput(String(policies.refundDeadline)) : '',
    transferDeadline: policies.transferDeadline
      ? toLocalInput(String(policies.transferDeadline))
      : '',
    capacityExplanation: explanation,
  };
}

export default function EditEventPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EditBody />
      </AdminFrame>
    </Suspense>
  );
}

function EditBody() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const token = session.token;
  const canManage = hasCapability(session.role, 'events.manage');

  const [hub, setHub] = useState<EventHub | null>(null);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [section, setSection] = useState<SectionKey>('basics');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<PublishValidation | null>(null);
  const [validationState, setValidationState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle'
  );
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateDate, setDuplicateDate] = useState('');
  const [duplicateTitle, setDuplicateTitle] = useState('');
  const [duplicating, setDuplicating] = useState(false);

  const reload = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      const [hubData, venueList] = await Promise.all([
        getEventHub(token, id),
        listVenues(token).catch(() => [] as VenueOption[]),
      ]);
      setHub(hubData);
      setVenues(venueList);
      setForm(hubToForm(hubData));
      setDuplicateTitle(`${String((hubData.event as { title?: string }).title ?? '')} (copia)`);
    } catch (cause) {
      setError(cause);
      setHub(null);
      setForm(null);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadValidation = useCallback(async () => {
    if (!token || !id) return;
    setValidationState('loading');
    try {
      const data = await adminApi<PublishValidation>(
        `/events/manage/${id}/publish-validation`,
        token
      );
      setValidation(data);
      setValidationState('ready');
    } catch {
      setValidation(null);
      setValidationState('error');
    }
  }, [token, id]);

  useEffect(() => {
    if (section === 'publish') void loadValidation();
  }, [section, loadValidation]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSaveMsg(null);
  }

  function validateSection(target: SectionKey): Record<string, string> {
    if (!form) return {};
    const errors: Record<string, string> = {};
    if (target === 'basics') {
      if (form.title.trim().length < 3) errors.title = 'El título necesita al menos 3 caracteres.';
      if (!form.venueId) errors.venueId = 'Elige un recinto.';
      if (!form.imageUrl.trim()) errors.imageUrl = 'Agrega la URL de la imagen.';
      const capacity = Number(form.totalCapacity);
      if (!Number.isInteger(capacity) || capacity <= 0) {
        errors.totalCapacity = 'Indica un cupo mayor que cero.';
      }
    }
    if (target === 'schedule') {
      if (!form.startDate) errors.startDate = 'Indica fecha y hora de inicio.';
      else if (Number.isNaN(new Date(form.startDate).getTime())) {
        errors.startDate = 'Fecha de inicio inválida.';
      }
      if (form.salesStartAt && form.salesEndAt) {
        const start = new Date(form.salesStartAt);
        const end = new Date(form.salesEndAt);
        if (end <= start) errors.salesEndAt = 'La venta no puede cerrar antes de abrir.';
      }
      if (form.salesEndAt && form.startDate) {
        if (new Date(form.salesEndAt) > new Date(form.startDate)) {
          errors.salesEndAt = 'La venta no puede cerrar después del inicio.';
        }
      }
    }
    if (target === 'policies') {
      if (form.resaleMaxPercent !== '') {
        const pct = Number(form.resaleMaxPercent);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 5) {
          errors.resaleMaxPercent = 'El tope de reventa va de 0.01 a 5 (p. ej. 1.2 = 120%).';
        }
      }
      if (form.capacityExplanation.trim() && form.capacityExplanation.trim().length < 20) {
        errors.capacityExplanation = 'La explicación necesita al menos 20 caracteres.';
      }
    }
    return errors;
  }

  async function saveSection(target: SectionKey) {
    if (!token || !id || !form || !canManage || saving) return;
    const errors = validateSection(target);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0];
      window.setTimeout(() => document.getElementById(`edit-${first}`)?.focus(), 0);
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      let body: Record<string, unknown> = {};
      if (target === 'basics') {
        body = {
          title: form.title.trim(),
          description: form.description,
          imageUrl: form.imageUrl.trim(),
          venueId: form.venueId,
          category: form.category,
          rating: form.rating.trim() || null,
          totalCapacity: Number(form.totalCapacity),
          capacityExplanation: form.capacityExplanation.trim() || null,
        };
      } else if (target === 'schedule') {
        body = {
          startDate: new Date(form.startDate).toISOString(),
          doorsAt: form.doorsAt ? new Date(form.doorsAt).toISOString() : null,
          salesStartAt: form.salesStartAt ? new Date(form.salesStartAt).toISOString() : null,
          salesEndAt: form.salesEndAt ? new Date(form.salesEndAt).toISOString() : null,
        };
      } else if (target === 'policies') {
        body = {
          allowResale: form.allowResale,
          transferAllowed: form.transferAllowed,
          refundable: form.refundable,
          policies: {
            resaleMaxPercent: form.resaleMaxPercent === '' ? null : Number(form.resaleMaxPercent),
            resaleDeadline: form.resaleDeadline
              ? new Date(form.resaleDeadline).toISOString()
              : null,
            refundDeadline: form.refundDeadline
              ? new Date(form.refundDeadline).toISOString()
              : null,
            transferDeadline: form.transferDeadline
              ? new Date(form.transferDeadline).toISOString()
              : null,
          },
        };
      }
      await adminApi(`/events/manage/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setSaveMsg('Guardado.');
      await reload();
      if (target === 'publish' || section === 'publish') await loadValidation();
    } catch (cause) {
      setSaveMsg(
        cause instanceof ApiError
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : 'No se pudo guardar.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function syncCapacity() {
    if (!token || !id || !canManage || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const result = await adminApi<{ totalCapacity: number; mapSeats: number }>(
        `/events/manage/${id}/sync-capacity`,
        token,
        { method: 'POST', body: '{}' }
      );
      setSaveMsg(`Cupo igualado al mapa: ${result.totalCapacity.toLocaleString('es-MX')} butacas.`);
      await reload();
      await loadValidation();
    } catch (cause) {
      setSaveMsg(
        cause instanceof ApiError
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : 'No se pudo igualar el cupo.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function runDuplicate() {
    if (!token || !id || !canManage || duplicating) return;
    if (!duplicateDate) {
      setFieldErrors({ duplicateDate: 'Indica la nueva fecha.' });
      return;
    }
    setDuplicating(true);
    try {
      const created = await adminApi<{ id: string }>(`/events/manage/${id}/duplicate`, token, {
        method: 'POST',
        body: JSON.stringify({
          startDate: new Date(duplicateDate).toISOString(),
          title: duplicateTitle.trim() || undefined,
        }),
      });
      router.push(`/events/${created.id}/edit`);
    } catch (cause) {
      setSaveMsg(
        cause instanceof ApiError
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : 'No se pudo duplicar.'
      );
    } finally {
      setDuplicating(false);
    }
  }

  const missing = error instanceof ApiError && error.isNotFound;

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (missing) {
    return <NotFound title="No encontramos este evento" href="/events" linkLabel="Ver eventos" />;
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir la edición" onRetry={() => void reload()} />;
  }
  if (loading || !form || !hub || !token || !id) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando edición">
        <div className={styles.skeleton} style={{ height: 72 }} />
        <div className={styles.skeleton} style={{ height: 240 }} />
      </div>
    );
  }

  if (!canManage) {
    return (
      <TicketState
        title="Sin permiso"
        body="Tu rol no puede editar eventos."
        action={<Link href={`/events/${id}`}>Volver al evento</Link>}
      />
    );
  }

  const tabs: { id: SectionKey; label: string }[] = [
    { id: 'basics', label: 'Datos' },
    { id: 'schedule', label: 'Horarios' },
    { id: 'policies', label: 'Políticas' },
    { id: 'publish', label: 'Publicar' },
  ];

  return (
    <section>
      <header className={styles.sectionHead}>
        <div>
          <p className={styles.quiet}>
            <Link href={`/events/${id}`}>← Evento</Link>
          </p>
          <h1 className={styles.sectionTitle}>Editar evento</h1>
        </div>
        <TicketButton variant="secondary" onClick={() => setDuplicateOpen((v) => !v)}>
          Duplicar evento
        </TicketButton>
      </header>

      {duplicateOpen ? (
        <div className={styles.stack} style={{ marginBottom: 24 }}>
          <ParameterCard name="Nueva fecha de inicio" value="" effect="">
            <Field
              id="edit-duplicateDate"
              label="Nueva fecha"
              type="datetime-local"
              value={duplicateDate}
              onChange={(e) => setDuplicateDate(e.target.value)}
              error={fieldErrors.duplicateDate}
            />
          </ParameterCard>
          <ParameterCard name="Título de la copia" value="" effect="">
            <Field
              id="edit-duplicateTitle"
              label="Título copia"
              value={duplicateTitle}
              onChange={(e) => setDuplicateTitle(e.target.value)}
            />
          </ParameterCard>
          <TicketButton onClick={() => void runDuplicate()} disabled={duplicating}>
            {duplicating ? 'Duplicando…' : 'Crear borrador'}
          </TicketButton>
        </div>
      ) : null}

      <nav
        className={styles.row}
        aria-label="Secciones de edición"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        {tabs.map((tab) => (
          <TicketButton
            key={tab.id}
            variant={section === tab.id ? 'primary' : 'ghost'}
            onClick={() => setSection(tab.id)}
          >
            {tab.label}
          </TicketButton>
        ))}
      </nav>

      {saveMsg ? <p className={styles.quiet}>{saveMsg}</p> : null}

      {section === 'basics' ? (
        <div className={styles.stack}>
          <ParameterCard name="Título" value="" effect="">
            <Field
              id="edit-title"
              label="Título"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              error={fieldErrors.title}
            />
          </ParameterCard>
          <ParameterCard name="Descripción" value="" effect="">
            <textarea
              id="edit-description"
              rows={4}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              style={{
                width: '100%',
                minHeight: 96,
                background: 'transparent',
                color: 'inherit',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: 12,
              }}
            />
          </ParameterCard>
          <ParameterCard name="Imagen (URL)" value="" effect="">
            <Field
              id="edit-imageUrl"
              label="Imagen"
              value={form.imageUrl}
              onChange={(e) => setField('imageUrl', e.target.value)}
              error={fieldErrors.imageUrl}
            />
          </ParameterCard>
          <ParameterCard name="Recinto" value="" effect="">
            <SheetSelect
              label="Recinto"
              value={form.venueId}
              placeholder="Elegir recinto"
              onChange={(value) => setField('venueId', value)}
              options={venues.map((v) => ({ value: v.id, label: v.name }))}
            />
            {fieldErrors.venueId ? <p className={styles.quiet}>{fieldErrors.venueId}</p> : null}
          </ParameterCard>
          <ParameterCard name="Categoría" value="" effect="">
            <SheetSelect
              label="Categoría"
              value={form.category}
              placeholder="Elegir categoría"
              onChange={(value) => setField('category', value)}
              options={CATEGORIES}
            />
          </ParameterCard>
          <ParameterCard name="Clasificación" value="" effect="">
            <Field
              id="edit-rating"
              label="Clasificación"
              value={form.rating}
              placeholder="PG, AA, B15…"
              onChange={(e) => setField('rating', e.target.value)}
            />
          </ParameterCard>
          <ParameterCard name="Cupo" value="" effect="">
            <Field
              id="edit-totalCapacity"
              label="Cupo"
              type="number"
              min={1}
              value={form.totalCapacity}
              onChange={(e) => setField('totalCapacity', e.target.value)}
              error={fieldErrors.totalCapacity}
            />
          </ParameterCard>
          <ParameterCard name="Explicación si el cupo no coincide con el mapa" value="" effect="">
            <textarea
              id="edit-capacityExplanation"
              rows={3}
              value={form.capacityExplanation}
              onChange={(e) => setField('capacityExplanation', e.target.value)}
              placeholder="Opcional. Minimo 20 caracteres si el desfase es intencional."
              style={{
                width: '100%',
                minHeight: 72,
                background: 'transparent',
                color: 'inherit',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: 12,
              }}
            />
            {fieldErrors.capacityExplanation ? (
              <p className={styles.danger}>{fieldErrors.capacityExplanation}</p>
            ) : null}
          </ParameterCard>
          <TicketButton onClick={() => void saveSection('basics')} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar datos'}
          </TicketButton>
        </div>
      ) : null}

      {section === 'schedule' ? (
        <div className={styles.stack}>
          <ParameterCard name="Inicio del evento" value="" effect="">
            <Field
              id="edit-startDate"
              label="Inicio"
              type="datetime-local"
              value={form.startDate}
              onChange={(e) => setField('startDate', e.target.value)}
              error={fieldErrors.startDate}
            />
          </ParameterCard>
          <ParameterCard name="Apertura de puertas" value="" effect="">
            <Field
              id="edit-doorsAt"
              label="Puertas"
              type="datetime-local"
              value={form.doorsAt}
              onChange={(e) => setField('doorsAt', e.target.value)}
            />
          </ParameterCard>
          <ParameterCard name="Venta abre" value="" effect="">
            <Field
              id="edit-salesStartAt"
              label="Venta abre"
              type="datetime-local"
              value={form.salesStartAt}
              onChange={(e) => setField('salesStartAt', e.target.value)}
            />
          </ParameterCard>
          <ParameterCard name="Venta cierra" value="" effect="">
            <Field
              id="edit-salesEndAt"
              label="Venta cierra"
              type="datetime-local"
              value={form.salesEndAt}
              onChange={(e) => setField('salesEndAt', e.target.value)}
              error={fieldErrors.salesEndAt}
            />
          </ParameterCard>
          <TicketButton onClick={() => void saveSection('schedule')} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar horarios'}
          </TicketButton>
        </div>
      ) : null}

      {section === 'policies' ? (
        <div className={styles.stack}>
          <Param name="Reembolso">
            <Switch
              on={form.refundable}
              label="Permitir reembolso"
              onChange={(next) => setField('refundable', next)}
            />
          </Param>
          <Param name="Transferencia">
            <Switch
              on={form.transferAllowed}
              label="Permitir transferencia"
              onChange={(next) => setField('transferAllowed', next)}
            />
          </Param>
          <Param name="Reventa">
            <Switch
              on={form.allowResale}
              label="Permitir reventa"
              onChange={(next) => setField('allowResale', next)}
            />
          </Param>
          <ParameterCard name="Tope de reventa (multiplicador, p. ej. 1.2)" value="" effect="">
            <Field
              id="edit-resaleMaxPercent"
              label="Tope reventa"
              type="number"
              step="0.01"
              min={0}
              value={form.resaleMaxPercent}
              onChange={(e) => setField('resaleMaxPercent', e.target.value)}
              error={fieldErrors.resaleMaxPercent}
            />
          </ParameterCard>
          <ParameterCard name="Fecha límite de reventa" value="" effect="">
            <Field
              id="edit-resaleDeadline"
              label="Límite reventa"
              type="datetime-local"
              value={form.resaleDeadline}
              onChange={(e) => setField('resaleDeadline', e.target.value)}
            />
          </ParameterCard>
          <ParameterCard name="Fecha límite de reembolso" value="" effect="">
            <Field
              id="edit-refundDeadline"
              label="Límite reembolso"
              type="datetime-local"
              value={form.refundDeadline}
              onChange={(e) => setField('refundDeadline', e.target.value)}
            />
          </ParameterCard>
          <ParameterCard name="Fecha límite de transferencia" value="" effect="">
            <Field
              id="edit-transferDeadline"
              label="Límite transferencia"
              type="datetime-local"
              value={form.transferDeadline}
              onChange={(e) => setField('transferDeadline', e.target.value)}
            />
          </ParameterCard>
          <TicketButton onClick={() => void saveSection('policies')} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar políticas'}
          </TicketButton>
        </div>
      ) : null}

      {section === 'publish' ? (
        <PublishPanel
          validation={validation}
          state={validationState}
          onRetry={() => void loadValidation()}
          onSyncCapacity={() => void syncCapacity()}
          saving={saving}
          eventId={id}
        />
      ) : null}
    </section>
  );
}

function PublishPanel({
  validation,
  state,
  onRetry,
  onSyncCapacity,
  saving,
  eventId,
}: {
  validation: PublishValidation | null;
  state: 'idle' | 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onSyncCapacity: () => void;
  saving: boolean;
  eventId: string;
}) {
  if (state === 'loading' && !validation) {
    return <p className={styles.quiet}>Revisando qué falta para publicar…</p>;
  }
  if (state === 'error' && !validation) {
    return (
      <div className={styles.stack}>
        <p className={styles.quiet}>No se pudo cargar la lista de comprobación.</p>
        <TicketButton variant="secondary" onClick={onRetry}>
          Reintentar
        </TicketButton>
      </div>
    );
  }
  if (!validation) return null;

  const { progress, ready, checks } = validation;
  return (
    <div className={styles.stack}>
      <header className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Lista de comprobación</h2>
          <p className={styles.quiet}>
            {ready
              ? progress.warnings > 0
                ? 'Puedes publicar; revisa los avisos.'
                : 'Todo listo para publicar.'
              : `Faltan ${progress.blockers} punto(s). Corrige antes de publicar.`}
          </p>
        </div>
        <p className={styles.quiet}>
          {progress.passed}/{progress.total}
        </p>
      </header>
      <ul className={styles.stack} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {checks.map((check) => (
          <li key={check.id} className={styles.stack} data-status={check.status}>
            <strong>
              {check.status === 'ok' ? 'Listo' : check.status === 'warning' ? 'Aviso' : 'Falta'} ·{' '}
              {check.label}
            </strong>
            <p className={styles.quiet}>{check.message}</p>
            {check.detail ? <p className={styles.quiet}>{check.detail}</p> : null}
            {check.action?.id === 'sync_capacity' ? (
              <TicketButton onClick={onSyncCapacity} disabled={saving}>
                {check.action.label}
              </TicketButton>
            ) : null}
            {check.action?.id === 'edit_image' || check.action?.id === 'edit_sales' ? (
              <p className={styles.quiet}>Usa las pestañas Datos u Horarios para corregirlo.</p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className={styles.row} style={{ gap: 12, flexWrap: 'wrap' }}>
        <TicketButton variant="secondary" onClick={onRetry} disabled={saving}>
          Actualizar lista
        </TicketButton>
        <Link href={`/events/${eventId}`}>
          <TicketButton variant="ghost">Volver al evento</TicketButton>
        </Link>
        {ready ? (
          <p className={styles.quiet}>
            Publica el inventario desde el hub del evento cuando confirmes el mapa.
          </p>
        ) : null}
      </div>
    </div>
  );
}
