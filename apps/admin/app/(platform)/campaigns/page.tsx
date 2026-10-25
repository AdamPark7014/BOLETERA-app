'use client';

import { Suspense, useEffect, useState } from 'react';
import { Field, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Segment, Stepper, Switch } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString } from '../events/_ticket/read';

const STATUS: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  PAUSED: 'En pausa',
  ENDED: 'Terminada',
};

const CAMPAIGN_TYPE: Record<string, string> = {
  presale: 'Preventa',
  early_bird: 'Anticipada',
  loyalty: 'Lealtad',
};

type EventRow = { id: string; title: string };

type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  allocation: number;
  quantityPerUser: number;
  discountType: string;
  discountValue: number;
  points: number | null;
  codes: string[];
  redeemed: number;
};

type Draft = {
  name: string;
  type: 'presale' | 'early_bird';
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  allocation: number;
  quantityPerUser: number;
  startsAt: string;
  endsAt: string;
};

function word(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

function discountLabel(type: string, value: number): string {
  if (type === 'fixed') return formatTicketAmount(value);
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`;
}

function positiveRule(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Misma lectura que el cobro: puntos, o si no vienen, el descuento. Cero no cuenta. */
function loyaltyRule(campaign: Campaign): { value: number; discountType: 'percentage' | 'fixed' } | null {
  if (campaign.type !== 'loyalty') return null;
  const points = positiveRule(campaign.points);
  const discount = positiveRule(campaign.discountValue);
  if (points === null && discount === null) return null;
  if (discount !== null && campaign.discountType === 'percentage') {
    return { value: discount, discountType: 'percentage' };
  }
  if (discount !== null) return { value: discount, discountType: 'fixed' };
  return { value: points as number, discountType: 'fixed' };
}

function loyaltyIsCharging(campaign: Campaign, now: Date): boolean {
  if (!loyaltyRule(campaign) || campaign.status !== 'ACTIVE') return false;
  const start = new Date(campaign.startsAt ?? '');
  const end = new Date(campaign.endsAt ?? '');
  return start <= now && end >= now;
}

function loyaltyCard(campaigns: Campaign[], now = new Date()): { value: string; effect: string } {
  const rules = campaigns.flatMap((item) => {
    const rule = loyaltyRule(item);
    return rule ? [{ item, rule }] : [];
  });
  if (rules.length === 0) {
    return {
      value: 'Sin efecto',
      effect: 'El endpoint no escribe. La cuenta no tiene ese dato.',
    };
  }
  const charging = rules.find((entry) => loyaltyIsCharging(entry.item, now));
  const chosen = charging ?? rules[0];
  const value =
    chosen.rule.discountType === 'percentage'
      ? `${chosen.rule.value.toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`
      : formatTicketAmount(chosen.rule.value);
  if (!charging) {
    return {
      value,
      effect: 'Sin efecto mientras la campaña no está activa.',
    };
  }
  return {
    value,
    effect: 'Se descuenta al cobrar, por la misma vía que un código.',
  };
}

function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyDraft(): Draft {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    name: '',
    type: 'presale',
    discountType: 'percentage',
    discountValue: '10',
    allocation: 10,
    quantityPerUser: 1,
    startsAt: localInput(start),
    endsAt: localInput(end),
  };
}

function readEvent(raw: unknown): EventRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const title = readString(row.title);
  if (!id || !title) return null;
  return { id, title };
}

function readCampaign(raw: unknown): Campaign | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const codes = Array.isArray(row.codes)
    ? row.codes.flatMap((item) => {
        const code = readString(item);
        return code ? [code] : [];
      })
    : [];
  return {
    id,
    name,
    type: readString(row.type) ?? '—',
    status: readString(row.status) ?? 'DRAFT',
    startsAt: readString(row.startsAt),
    endsAt: readString(row.endsAt),
    allocation: readNumber(row.allocation) ?? 0,
    quantityPerUser: readNumber(row.quantityPerUser) ?? 1,
    discountType: readString(row.discountType) ?? 'percentage',
    discountValue: readNumber(row.discountValue) ?? 0,
    points: readNumber(row.points),
    codes,
    redeemed: readNumber(row.redeemed) ?? 0,
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <DescuentosBody />
      </AdminFrame>
    </Suspense>
  );
}

function DescuentosBody() {
  const session = useSession();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canWrite = hasCapability(session.role, 'marketing.manage');

  useEffect(() => {
    if (!token || !canWrite) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>('/admin/events', token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const event = readEvent(item);
          return event ? [event] : [];
        });
        setEvents(next);
        setEventId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
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
  }, [token, canWrite, session.status]);

  useEffect(() => {
    if (!token || !eventId || !canWrite) return;
    let alive = true;
    adminApi<unknown>(`/campaigns/list/${eventId}`, token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const campaign = readCampaign(item);
          return campaign ? [campaign] : [];
        });
        setCampaigns(next);
        setPaused(Object.fromEntries(next.map((item) => [item.id, item.status === 'PAUSED'])));
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      });
    return () => {
      alive = false;
    };
  }, [token, eventId, canWrite, nonce]);

  const pauseChanges = campaigns.filter((item) => (paused[item.id] ?? false) !== (item.status === 'PAUSED'));
  const creating = draft.name.trim().length > 0;
  const dirty = pauseChanges.length > 0 || creating;

  async function save() {
    if (!token || !eventId || !session.orgId || !dirty || saving) return;
    const value = Number(draft.discountValue);
    if (creating) {
      if (!Number.isFinite(value) || value < 0) {
        setActionError('El valor del descuento no puede ser negativo.');
        return;
      }
      if (!draft.startsAt || !draft.endsAt || new Date(draft.endsAt) <= new Date(draft.startsAt)) {
        setActionError('El fin tiene que ser posterior al inicio.');
        return;
      }
    }
    setSaving(true);
    setActionError(null);
    const lines: string[] = [];
    try {
      for (const item of pauseChanges) {
        const next = paused[item.id] ?? false;
        await adminApi(`/campaigns/${item.id}/${next ? 'pause' : 'resume'}`, token, {
          method: 'POST',
          body: '{}',
        });
        lines.push(`${item.name}: ${next ? 'En pausa' : 'Activa'}`);
      }
      if (creating) {
        await adminApi(`/campaigns/create/${session.orgId}/${eventId}`, token, {
          method: 'POST',
          body: JSON.stringify({
            name: draft.name.trim(),
            type: draft.type,
            startsAt: new Date(draft.startsAt).toISOString(),
            endsAt: new Date(draft.endsAt).toISOString(),
            allocation: draft.allocation,
            quantityPerUser: draft.quantityPerUser,
            discountType: draft.discountType,
            discountValue: value,
          }),
        });
        lines.push(`Descuento creado · ${draft.name.trim()}`);
        setDraft(emptyDraft());
      }
      setNotice(lines.join(' · '));
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canWrite && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Descuentos</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView error={error} context="abrir descuentos" onRetry={() => setNonce((current) => current + 1)} />
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando descuentos.</p>;

  const event = events.find((item) => item.id === eventId) ?? null;
  const loyalty = loyaltyCard(campaigns);

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Descuentos</h1>
        <p className={styles.quiet}>
          Campañas que el evento ya guarda. El alta escribe porcentaje o monto fijo. 2×1, envío y
          cashback no tienen cobro detrás.
        </p>
      </header>
      {events.length === 0 ? <p className={styles.quiet}>No hay eventos.</p> : null}
      <div className={styles.stack}>
        {events.map((item) => {
          const open = item.id === eventId;
          return (
            <button
              key={item.id}
              type="button"
              className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
              aria-expanded={open}
              onClick={() => {
                setEventId(item.id);
                setNotice(null);
              }}
            >
              <span>{item.title}</span>
              <span className={styles.figure}>{open ? 'Abierta' : 'Abrir'}</span>
            </button>
          );
        })}
      </div>
      {event && campaigns.length === 0 ? <p className={styles.quiet}>No hay descuentos.</p> : null}
      <div className={styles.stack}>
        {campaigns.map((item) => {
          const open = openId === item.id;
          const isPaused = paused[item.id] ?? false;
          const code = item.codes[0] ?? 'Ninguno';
          return (
            <div key={item.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span>{item.name}</span>
                <span className={styles.figure}>
                  {discountLabel(item.discountType, item.discountValue)}
                </span>
              </button>
              {open ? (
                <div className={styles.stack}>
                  <Param name="Código">
                    <ParameterCard
                      name="Código"
                      value={code}
                      valueStyle="mono"
                      effect={
                        item.codes.length > 1
                          ? `Hay ${formatCount(item.codes.length)} códigos. El servicio los generó.`
                          : 'El servicio lo genera en la preventa. No se teclea.'
                      }
                    />
                  </Param>
                  <Param name="Nombre del descuento">
                    <ParameterCard
                      name="Nombre del descuento"
                      value={item.name}
                      effect="Nombre interno. Esta ruta no lo renombra."
                    />
                  </Param>
                  <Param name="Tipo">
                    <ParameterCard
                      name="Tipo"
                      value={item.discountType === 'fixed' ? 'Monto fijo' : 'Porcentaje'}
                      effect={`Campaña ${word(CAMPAIGN_TYPE, item.type)}. El alta no escribe 2×1, envío ni cashback.`}
                    />
                  </Param>
                  <Param name="Valor del descuento">
                    <ParameterCard
                      name="Valor del descuento"
                      value={discountLabel(item.discountType, item.discountValue)}
                      valueStyle="tabular"
                      effect="Descuento ya guardado. Esta ruta no lo cambia."
                    />
                  </Param>
                  <Param name="Cupo de preventa">
                    <ParameterCard
                      name="Cupo de preventa"
                      value={formatCount(item.allocation)}
                      valueStyle="tabular"
                      effect="Tope de 0 a 100 que el alta ya guardó."
                    />
                  </Param>
                  <Param name="Usos por persona">
                    <ParameterCard
                      name="Usos por persona"
                      value={formatCount(item.quantityPerUser)}
                      valueStyle="tabular"
                      effect="Tope por persona de esta campaña."
                    />
                  </Param>
                  <Param name="Canjes">
                    <ParameterCard
                      name="Canjes"
                      value={formatCount(item.redeemed)}
                      valueStyle="tabular"
                      effect="Los cuenta el servicio."
                    />
                  </Param>
                  <Param name="Descuento desde">
                    <ParameterCard
                      name="Descuento desde"
                      value={formatWhen(item.startsAt)}
                      effect="Inicio ya guardado."
                    />
                  </Param>
                  <Param name="Descuento hasta">
                    <ParameterCard name="Descuento hasta" value={formatWhen(item.endsAt)} effect="Fin ya guardado." />
                  </Param>
                  <Param name="Estado">
                    <ParameterCard
                      name="Estado"
                      value={word(STATUS, item.status)}
                      effect="Pausar o reanudar es lo que esta ruta escribe sobre una campaña ya hecha."
                    >
                      <Switch
                        label="Preventa en pausa"
                        on={isPaused}
                        onChange={(next) => {
                          setPaused((current) => ({ ...current, [item.id]: next }));
                          setNotice(null);
                        }}
                      />
                    </ParameterCard>
                  </Param>
                </div>
              ) : null}
            </div>
          );
        })}
        <Param name="Puntos de lealtad">
          <ParameterCard
            name="Puntos de lealtad"
            value={loyalty.value}
            valueStyle={loyalty.value === 'Sin efecto' ? undefined : 'tabular'}
            effect={loyalty.effect}
          />
        </Param>
      </div>
      {canWrite && event ? (
        <div className={styles.stack}>
          <h2 className={styles.sectionTitle}>Nuevo</h2>
          <Param name="Nombre del descuento">
            <ParameterCard
              name="Nombre del descuento"
              value={draft.name.trim() || '—'}
              effect="Vacío: Guardar no crea campaña."
            >
              <Field
                label="Nombre del descuento"
                value={draft.name}
                onChange={(input) => {
                  setDraft((current) => ({ ...current, name: input.target.value }));
                  setNotice(null);
                }}
              />
            </ParameterCard>
          </Param>
          <Param name="Tipo de campaña">
            <ParameterCard
              name="Tipo de campaña"
              value={word(CAMPAIGN_TYPE, draft.type)}
              effect="Preventa genera códigos. Anticipada también deja el descuento."
            >
              <Segment
                label="Tipo de campaña"
                value={draft.type}
                options={[
                  { value: 'presale', label: 'Preventa' },
                  { value: 'early_bird', label: 'Anticipada' },
                ]}
                onChange={(next) => setDraft((current) => ({ ...current, type: next }))}
              />
            </ParameterCard>
          </Param>
          <Param name="Tipo">
            <ParameterCard
              name="Tipo"
              value={draft.discountType === 'fixed' ? 'Monto fijo' : 'Porcentaje'}
              effect="El alta solo persiste estos dos."
            >
              <Segment
                label="Tipo"
                value={draft.discountType}
                options={[
                  { value: 'percentage', label: 'Porcentaje' },
                  { value: 'fixed', label: 'Monto fijo' },
                ]}
                onChange={(next) => setDraft((current) => ({ ...current, discountType: next }))}
              />
            </ParameterCard>
          </Param>
          <Param name="Valor del descuento">
            <ParameterCard
              name="Valor del descuento"
              value={
                draft.discountType === 'fixed'
                  ? formatTicketAmount(Number(draft.discountValue) || 0)
                  : `${draft.discountValue || '0'}%`
              }
              valueStyle="tabular"
              effect="Descuento que se escribe al crear."
            >
              {draft.discountType === 'fixed' ? (
                <Field
                  label="Valor del descuento"
                  kind="money"
                  value={draft.discountValue}
                  onChange={(input) => setDraft((current) => ({ ...current, discountValue: input.target.value }))}
                />
              ) : (
                <Stepper
                  label="Valor del descuento"
                  value={Number(draft.discountValue) || 0}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(next) => setDraft((current) => ({ ...current, discountValue: String(next) }))}
                />
              )}
            </ParameterCard>
          </Param>
          <Param name="Cupo de preventa">
            <ParameterCard
              name="Cupo de preventa"
              value={formatCount(draft.allocation)}
              valueStyle="tabular"
              effect="El API lo acepta de 0 a 100."
            >
              <Stepper
                label="Cupo de preventa"
                value={draft.allocation}
                min={0}
                max={100}
                onChange={(next) => setDraft((current) => ({ ...current, allocation: next }))}
              />
            </ParameterCard>
          </Param>
          <Param name="Usos por persona">
            <ParameterCard
              name="Usos por persona"
              value={formatCount(draft.quantityPerUser)}
              valueStyle="tabular"
              effect="Mínimo 1."
            >
              <Stepper
                label="Usos por persona"
                value={draft.quantityPerUser}
                min={1}
                max={null}
                onChange={(next) => setDraft((current) => ({ ...current, quantityPerUser: next }))}
              />
            </ParameterCard>
          </Param>
          <Param name="Descuento desde">
            <ParameterCard name="Descuento desde" value={formatWhen(draft.startsAt)} effect="Inicio de la campaña.">
              <Field
                label="Descuento desde"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(input) => setDraft((current) => ({ ...current, startsAt: input.target.value }))}
              />
            </ParameterCard>
          </Param>
          <Param name="Descuento hasta">
            <ParameterCard name="Descuento hasta" value={formatWhen(draft.endsAt)} effect="Fin de la campaña.">
              <Field
                label="Descuento hasta"
                type="datetime-local"
                value={draft.endsAt}
                onChange={(input) => setDraft((current) => ({ ...current, endsAt: input.target.value }))}
              />
            </ParameterCard>
          </Param>
        </div>
      ) : null}
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {canWrite ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
