'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { Field, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Segment, SheetSelect, Stepper, Switch } from '../events/_ticket/controls';
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
function loyaltyRule(
  campaign: Campaign
): { value: number; discountType: 'percentage' | 'fixed' } | null {
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
      value: 'Apagados',
      effect: 'sin programa de lealtad activo',
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
        setEventId((current) =>
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
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      });
    return () => {
      alive = false;
    };
  }, [token, eventId, canWrite, nonce]);

  const pauseChanges = campaigns.filter(
    (item) => (paused[item.id] ?? false) !== (item.status === 'PAUSED')
  );
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
          <h1 className={styles.sectionTitle}>Campañas y códigos</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir descuentos"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) {
    return (
      <div className={styles.skeleton} style={{ height: 400 }} aria-label="Cargando campañas" />
    );
  }

  const event = events.find((item) => item.id === eventId) ?? null;
  const loyalty = loyaltyCard(campaigns);

  const redeemedTotal = campaigns.reduce((sum, item) => sum + item.redeemed, 0);
  const activeCount = campaigns.filter(
    (item) => item.status === 'ACTIVE' && !(paused[item.id] ?? false)
  ).length;
  const codesTotal = campaigns.reduce((sum, item) => sum + item.codes.length, 0);

  return (
    <section className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Campañas y códigos</h1>
        </div>
        {events.length > 0 ? (
          <div className={styles.formItem} style={{ width: 'min(360px, 100%)' }}>
            <p className={styles.rowMeta}>Evento</p>
            <SheetSelect
              label="Evento"
              value={eventId ?? ''}
              placeholder="Elige un evento"
              options={events.map((item) => ({ value: item.id, label: item.title }))}
              onChange={(next) => {
                setEventId(next);
                setNotice(null);
              }}
            />
          </div>
        ) : null}
      </header>

      {events.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Todavía no hay eventos</p>
          <p className={styles.quiet}>Las campañas se crean dentro de cada evento.</p>
          <Link href="/events/new" className={styles.goldLink}>
            Crear evento
          </Link>
        </div>
      ) : null}

      {event ? (
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Campañas activas</p>
            <p className={styles.kpiValue}>{formatCount(activeCount)}</p>
            <p className={styles.kpiNote}>de {formatCount(campaigns.length)} en este evento</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Canjes</p>
            <p className={styles.kpiValue}>{formatCount(redeemedTotal)}</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Códigos</p>
            <p className={styles.kpiValue}>{formatCount(codesTotal)}</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Puntos de lealtad</p>
            <p className={styles.kpiValue}>{loyalty.value}</p>
            <p className={styles.kpiNote}>{loyalty.effect}</p>
          </div>
        </div>
      ) : null}

      {event && campaigns.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Este evento aún no tiene campañas</p>
          <p className={styles.quiet}>
            Crea una preventa o un descuento con el formulario de abajo.
          </p>
        </div>
      ) : null}

      {campaigns.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Campaña</th>
                <th scope="col">Código</th>
                <th scope="col" className={styles.num}>
                  Descuento
                </th>
                <th scope="col">Canjes</th>
                <th scope="col">Vigencia</th>
                <th scope="col">Estado</th>
                <th scope="col">Pausa</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((item) => {
                const isPaused = paused[item.id] ?? false;
                const cap = item.allocation > 0 ? item.allocation : null;
                const pct = cap ? Math.min(100, (item.redeemed / cap) * 100) : 0;
                const chip =
                  item.status === 'ACTIVE' && !isPaused
                    ? styles.chipOk
                    : item.status === 'PAUSED' || isPaused
                      ? styles.chipWarn
                      : item.status === 'DRAFT'
                        ? styles.chipGold
                        : styles.chip;
                return (
                  <tr key={item.id} data-param={item.name}>
                    <td>
                      <strong>{item.name}</strong>
                      <p className={styles.rowMeta}>
                        {word(CAMPAIGN_TYPE, item.type)} · máx. {formatCount(item.quantityPerUser)}{' '}
                        por persona
                      </p>
                    </td>
                    <td>
                      {item.codes[0] ? (
                        <span className={styles.mono}>
                          {item.codes[0]}
                          {item.codes.length > 1 ? ` +${item.codes.length - 1}` : ''}
                        </span>
                      ) : (
                        <span className={styles.quiet}>Sin código</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      <strong>{discountLabel(item.discountType, item.discountValue)}</strong>
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <div className={styles.shareCell}>
                        {cap ? (
                          <div className={styles.bar} style={{ flex: 1, height: 6 }}>
                            <div className={styles.barFill} style={{ width: `${pct}%` }} />
                          </div>
                        ) : null}
                        <span className={styles.quiet} style={{ whiteSpace: 'nowrap' }}>
                          {formatCount(item.redeemed)}
                          {cap ? ` / ${formatCount(cap)}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className={styles.quiet} style={{ whiteSpace: 'nowrap' }}>
                      {formatWhen(item.startsAt)}
                      <br />
                      {formatWhen(item.endsAt)}
                    </td>
                    <td>
                      <span className={chip}>
                        {isPaused && item.status === 'ACTIVE'
                          ? 'En pausa'
                          : word(STATUS, item.status)}
                      </span>
                    </td>
                    <td>
                      <Switch
                        label={`Pausar ${item.name}`}
                        on={isPaused}
                        onChange={(next) => {
                          setPaused((current) => ({ ...current, [item.id]: next }));
                          setNotice(null);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {canWrite && event ? (
        <div className={styles.stack}>
          <h2 className={styles.panelTitle} style={{ marginTop: 8 }}>
            Nueva campaña para {event.title}
          </h2>
          <Param name="Nombre del descuento">
            <ParameterCard
              name="Nombre del descuento"
              value={draft.name.trim() || '—'}
              effect="Ponle nombre para poder crearla."
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
              effect="La preventa genera códigos; la anticipada aplica el descuento a todos."
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
              effect="Porcentaje o monto fijo por boleto."
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
              effect="Cuánto se descuenta a cada boleto."
            >
              {draft.discountType === 'fixed' ? (
                <Field
                  label="Valor del descuento"
                  kind="money"
                  value={draft.discountValue}
                  onChange={(input) =>
                    setDraft((current) => ({ ...current, discountValue: input.target.value }))
                  }
                />
              ) : (
                <Stepper
                  label="Valor del descuento"
                  value={Number(draft.discountValue) || 0}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, discountValue: String(next) }))
                  }
                />
              )}
            </ParameterCard>
          </Param>
          <Param name="Cupo de preventa">
            <ParameterCard
              name="Cupo de preventa"
              value={formatCount(draft.allocation)}
              valueStyle="tabular"
              effect="Entre 0 y 100 boletos."
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
            <ParameterCard
              name="Descuento desde"
              value={formatWhen(draft.startsAt)}
              effect="Inicio de la campaña."
            >
              <Field
                label="Descuento desde"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(input) =>
                  setDraft((current) => ({ ...current, startsAt: input.target.value }))
                }
              />
            </ParameterCard>
          </Param>
          <Param name="Descuento hasta">
            <ParameterCard
              name="Descuento hasta"
              value={formatWhen(draft.endsAt)}
              effect="Fin de la campaña."
            >
              <Field
                label="Descuento hasta"
                type="datetime-local"
                value={draft.endsAt}
                onChange={(input) =>
                  setDraft((current) => ({ ...current, endsAt: input.target.value }))
                }
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
            Guardar cambios
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
