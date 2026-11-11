'use client';

/**
 * Canales de venta por evento: reparto de inventario entre los 13 canales,
 * responsables, salud y mezcla de ingresos de 7 días.
 *
 * Guarda lo mismo que guardaba la pantalla anterior (`POST /channels/:id/configure`
 * con activación, reparto, responsable y ubicaciones de taquilla). La ficha del
 * evento (`/events/:id?seccion=canales`) edita activación y reparto con sus
 * propios controles; aquí no se agrega lógica nueva.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Field, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import {
  configureChannels,
  getChannelAnalytics,
  getChannelHealth,
  listEvents,
  type EventRow,
} from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, SheetSelect, Stepper, Switch } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import local from './channels.module.scss';
import {
  CHANNEL_ORDER,
  RESPONSIBLE_PARTY_CHANNELS,
  allocationTotal,
  buildChannelAlerts,
  buildRevenueMix,
  channelLabel,
  formatCount,
  formatMs,
  formatPercentPoints,
  formatSeconds,
  healthStatusMeta,
  parseAllocationFromMetadata,
  parseChannelHealth,
  responsiblePartyLabel,
  severityMeta,
  summarizeHealth,
  toChannelConfiguration,
  validateAllocation,
  type AllocationForm,
  type ChannelFormEntry,
  type ChannelKey,
} from './model';

/** Cupo que recupera un canal al encenderse si estaba en 0. Igual que antes. */
const DEFAULT_FALLBACK: Partial<Record<ChannelKey, number>> = {
  web: 50,
  taquilla: 35,
  api: 15,
  mobile: 5,
  admin: 3,
  promoter: 2,
  corporate: 2,
  phone: 2,
  affiliate: 1,
};

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return `${cause.userMessage} (${cause.status})`;
  if (cause instanceof Error) return cause.message;
  return 'No se guardó. Revisa la conexión.';
}

function readMessage(cause: unknown): string {
  if (cause instanceof ApiError) return `${cause.userMessage} (${cause.status})`;
  if (cause instanceof Error) return cause.message;
  return 'Sin respuesta.';
}

function entryValue(entry: ChannelFormEntry): string {
  return entry.enabled ? `Activo · ${entry.allocation}%` : 'Inactivo';
}

function sameEntry(a: ChannelFormEntry, b: ChannelFormEntry): boolean {
  return (
    a.enabled === b.enabled &&
    a.allocation === b.allocation &&
    a.responsibleParty.trim() === b.responsibleParty.trim() &&
    a.locations.join('|') === b.locations.join('|')
  );
}

function money(value: number): string {
  return `${formatTicketAmount(value)} MXN`;
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <CanalesBody />
      </AdminFrame>
    </Suspense>
  );
}

function CanalesBody() {
  const session = useSession();
  const token = session.token;
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [selected, setSelected] = useState('');
  const [healthRaw, setHealthRaw] = useState<unknown>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [analyticsRaw, setAnalyticsRaw] = useState<unknown>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<AllocationForm>(() =>
    parseAllocationFromMetadata(undefined)
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [readNonce, setReadNonce] = useState(0);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setError(null);
    listEvents(token)
      .then((list) => {
        if (!alive) return;
        setEvents(list);
        setSelected((current) => current || list[0]?.id || '');
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause);
      })
      .finally(() => {
        if (alive) setEventsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [token, nonce]);

  const selectedEvent = events.find((event) => event.id === selected);
  const stored = useMemo(
    () => parseAllocationFromMetadata(selectedEvent?.metadata),
    [selectedEvent]
  );

  useEffect(() => {
    setAllocation(stored);
  }, [stored]);

  useEffect(() => {
    if (!selected || !token) return;
    let alive = true;
    setHealthError(null);
    setAnalyticsError(null);
    getChannelHealth(token, selected)
      .then((value) => {
        if (alive) setHealthRaw(value);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setHealthRaw(null);
        setHealthError(readMessage(cause));
      });
    getChannelAnalytics(token, selected)
      .then((value) => {
        if (alive) setAnalyticsRaw(value);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setAnalyticsRaw(null);
        setAnalyticsError(readMessage(cause));
      });
    return () => {
      alive = false;
    };
  }, [selected, token, readNonce]);

  const healthCards = useMemo(() => parseChannelHealth(healthRaw), [healthRaw]);
  const healthSummary = useMemo(() => summarizeHealth(healthCards), [healthCards]);
  const allocationIssue = useMemo(() => validateAllocation(allocation), [allocation]);
  const total = allocationTotal(allocation);

  const revenueMix = useMemo(() => {
    const bucket =
      (analyticsRaw as { last7days?: Record<string, { revenue: number; orders: number }> } | null)
        ?.last7days ?? {};
    const rows = CHANNEL_ORDER.map((key) => {
      const stats = bucket[key.toUpperCase()] ?? bucket[key];
      return {
        key,
        label: channelLabel(key),
        value: stats?.revenue ?? 0,
        secondaryValue: stats?.orders ?? 0,
      };
    }).filter((row) => row.value > 0 || row.secondaryValue > 0);
    const totalRevenue = rows.reduce((sum, row) => sum + row.value, 0);
    return buildRevenueMix(rows, totalRevenue);
  }, [analyticsRaw]);

  const alerts = useMemo(
    () => buildChannelAlerts(healthCards, revenueMix, allocation, allocationIssue),
    [healthCards, revenueMix, allocation, allocationIssue]
  );

  const changes = CHANNEL_ORDER.flatMap((key) => {
    const before = stored[key];
    const after = allocation[key];
    if (sameEntry(before, after)) return [];
    const parts: string[] = [];
    if (entryValue(before) !== entryValue(after))
      parts.push(`${entryValue(before)} → ${entryValue(after)}`);
    if (before.responsibleParty.trim() !== after.responsibleParty.trim()) parts.push('responsable');
    if (before.locations.join('|') !== after.locations.join('|')) parts.push('ubicaciones');
    return [`${channelLabel(key)}: ${parts.join(', ')}`];
  });
  // Sin reparto guardado, el formulario parte de valores por omisión: se puede guardar tal cual.
  const neverSaved = selectedEvent != null && !selectedEvent.metadata?.channels;
  const dirty = changes.length > 0;
  const canSave = dirty || neverSaved;

  function patchChannel(key: ChannelKey, patch: Partial<ChannelFormEntry>) {
    setAllocation((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setNotice(null);
  }

  function toggleChannel(key: ChannelKey, enabled: boolean) {
    const entry = allocation[key];
    const restored = entry.allocation > 0 ? entry.allocation : (DEFAULT_FALLBACK[key] ?? 0);
    patchChannel(key, { enabled, allocation: enabled ? restored : 0 });
  }

  async function save() {
    const issue = validateAllocation(allocation);
    if (issue) {
      setSaveError(issue.message);
      return;
    }
    if (!token || !selected || saving) return;
    setSaving(true);
    setSaveError(null);
    const summary = changes.join(' · ');
    try {
      await configureChannels(token, selected, toChannelConfiguration(allocation));
      setNotice(summary || 'Canales guardados.');
      const list = await listEvents(token);
      setEvents(list);
      setReadNonce((current) => current + 1);
    } catch (cause) {
      setSaveError(failMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="cargar los eventos de tu organización"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (!token || !eventsLoaded) return <p className={styles.quiet}>Cargando canales.</p>;

  if (events.length === 0) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Canales</h1>
          <p className={styles.quiet}>Sin eventos. El reparto de canales se define por evento.</p>
        </header>
      </section>
    );
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Canales</h1>
        <p className={styles.quiet}>
          Reparto de inventario por canal. Solo los canales activos cuentan, y deben sumar 100%.
        </p>
        <div className={local.eventPick}>
          <SheetSelect
            label="Evento"
            value={selected}
            placeholder="Elige un evento"
            options={events.map((event) => ({ value: event.id, label: event.title }))}
            onChange={(value) => {
              setSelected(value);
              setNotice(null);
              setSaveError(null);
            }}
          />
        </div>
        {selected ? (
          <Link href={`/events/${selected}?seccion=canales`} className={local.link}>
            Abrir la ficha del evento
          </Link>
        ) : null}
      </header>

      <ul className={styles.rows} aria-label="Cifras de canales">
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Canales saludables</p>
            <p className={styles.rowMeta}>De {formatCount(healthCards.length)} canales</p>
          </div>
          <span />
          <p className={styles.figure}>{formatCount(healthSummary.healthy)}</p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Órdenes</p>
            <p className={styles.rowMeta}>Todas las fuentes, según salud</p>
          </div>
          <span />
          <p className={styles.figure}>{formatCount(healthSummary.totalOrders)}</p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Ingresos</p>
            <p className={styles.rowMeta}>Último corte de salud</p>
          </div>
          <span />
          <p className={styles.figure}>{money(healthSummary.totalRevenue)}</p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Peor tasa de error</p>
            <p className={styles.rowMeta}>Telemetría</p>
          </div>
          <span />
          <p className={styles.figure}>
            {healthSummary.worstErrorRate != null
              ? formatPercentPoints(healthSummary.worstErrorRate * 100)
              : '—'}
          </p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Peor latencia</p>
            <p className={styles.rowMeta}>Web y móvil</p>
          </div>
          <span />
          <p className={styles.figure}>
            {healthSummary.worstLatencyMs != null ? formatMs(healthSummary.worstLatencyMs) : '—'}
          </p>
        </li>
      </ul>
      {healthError ? (
        <p className={styles.danger} role="alert">
          Salud de canales sin respuesta: {healthError}
        </p>
      ) : null}

      <div className={local.block}>
        <p className={local.subTitle}>Reparto</p>
        <p className={total === 100 ? styles.quiet : styles.out}>Activos suman {total}%</p>
      </div>
      <div className={styles.stack}>
        {CHANNEL_ORDER.map((key) => {
          const entry = allocation[key];
          const label = channelLabel(key);
          const notes = [
            entry.responsibleParty.trim() ? entry.responsibleParty.trim() : null,
            key === 'taquilla' && entry.locations.length > 0 ? entry.locations.join(', ') : null,
          ].filter((line): line is string => line != null);
          return (
            <Param key={key} name={label}>
              <ParameterCard
                name={label}
                value={entryValue(entry)}
                valueStyle="tabular"
                effect="Parte del reparto. Los activos suman 100."
                closedNote={notes.length > 0 ? notes.join(' · ') : undefined}
                advanced={
                  RESPONSIBLE_PARTY_CHANNELS.includes(key) ? (
                    <div className={styles.stack}>
                      <Field
                        label={responsiblePartyLabel(key)}
                        value={entry.responsibleParty}
                        placeholder="Nombre o referencia"
                        disabled={!entry.enabled}
                        onChange={(event) =>
                          patchChannel(key, { responsibleParty: event.target.value })
                        }
                      />
                      {key === 'taquilla' ? (
                        <Field
                          label="Ubicaciones"
                          hint="Separadas por coma"
                          value={entry.locations.join(', ')}
                          placeholder="Centro, Norte"
                          disabled={!entry.enabled}
                          onChange={(event) =>
                            patchChannel(key, {
                              locations: event.target.value
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      ) : null}
                    </div>
                  ) : undefined
                }
              >
                <div className={styles.stack}>
                  <Switch
                    label={`${label} activo`}
                    on={entry.enabled}
                    onChange={(on) => toggleChannel(key, on)}
                  />
                  {entry.enabled ? (
                    <Stepper
                      label={`Cupo ${label}`}
                      value={entry.allocation}
                      min={0}
                      max={100}
                      unit="%"
                      editable
                      onChange={(value) => patchChannel(key, { allocation: value })}
                    />
                  ) : null}
                </div>
              </ParameterCard>
            </Param>
          );
        })}
      </div>
      {saveError ? (
        <p className={styles.danger} role="alert">
          {saveError}
        </p>
      ) : null}
      {/* Al final del reparto y fija en su sitio: la barra pegajosa del marco tapaba tarjetas al desplazarse. */}
      <div className={`${styles.saveBar} ${local.saveBarEnd}`}>
        <p className={allocationIssue && dirty ? styles.out : styles.quiet} aria-live="polite">
          {dirty
            ? allocationIssue
              ? allocationIssue.message
              : `Sin guardar · ${changes.join(' · ')}`
            : (notice ??
              (neverSaved ? 'Sin reparto guardado. Se muestran los valores por omisión.' : ''))}
        </p>
        <TicketButton
          disabled={!canSave || saving || allocationIssue !== null}
          onClick={() => void save()}
        >
          Guardar sección
        </TicketButton>
      </div>

      <div className={local.block}>
        <p className={local.subTitle}>Salud</p>
        <ul className={styles.rows}>
          {healthCards.map((card) => {
            const meta = [
              healthStatusMeta(card.status).label,
              `${formatCount(card.orders)} órdenes`,
              card.errorRate != null ? `Error ${formatPercentPoints(card.errorRate * 100)}` : null,
              card.latencyMs != null ? `Latencia ${formatMs(card.latencyMs)}` : null,
              card.syncLagSec != null ? `Retraso ${formatSeconds(card.syncLagSec)}` : null,
              card.activeTerminals != null
                ? `${formatCount(card.activeTerminals)} terminales`
                : null,
              card.activePartners != null ? `${formatCount(card.activePartners)} partners` : null,
            ].filter(Boolean);
            return (
              <li key={card.key} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{card.label}</p>
                  <p className={styles.rowMeta}>{meta.join(' · ')}</p>
                </div>
                <span />
                <p className={styles.figure}>{money(card.revenue)}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={local.block}>
        <p className={local.subTitle}>Mezcla de ingresos · 7 días</p>
        {analyticsError ? (
          <p className={styles.danger} role="alert">
            Analítica de canales sin respuesta: {analyticsError}
          </p>
        ) : revenueMix.length === 0 ? (
          <p className={styles.quiet}>Sin órdenes completadas en el periodo.</p>
        ) : (
          <ul className={styles.rows}>
            {revenueMix.map((slice) => (
              <li key={slice.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{slice.label}</p>
                  <p className={styles.rowMeta}>{formatCount(slice.orders)} órdenes</p>
                </div>
                <p className={styles.tertiary}>{formatPercentPoints(slice.percent)}</p>
                <p className={styles.figure}>{money(slice.value)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {alerts.length > 0 ? (
        <div className={local.block}>
          <p className={local.subTitle}>Alertas</p>
          <ul className={styles.rows}>
            {alerts.map((alert) => (
              <li key={alert.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{alert.title}</p>
                  <p className={styles.rowMeta}>{alert.explanation}</p>
                  <p className={styles.rowMeta}>{alert.suggestion}</p>
                </div>
                <span />
                <p className={alert.severity === 'critical' ? styles.out : styles.tertiary}>
                  {severityMeta(alert.severity).label}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
