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
import { Field, TicketButton, formatTicketAmount } from '@boletera/ui';
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
import { SheetSelect, Stepper, Switch } from '../events/_ticket/controls';
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
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error) return cause.message;
  return 'No se guardó. Revisa la conexión.';
}

function readMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
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
  if (!token || !eventsLoaded) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando canales">
        <div className={styles.skeleton} style={{ height: 48, maxWidth: 320 }} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 360 }} />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <section className={styles.page}>
        <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
          <h1 className={styles.sectionTitle}>Canales de venta</h1>
        </header>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Todavía no hay eventos</p>
          <p className={styles.quiet}>
            El reparto entre web, app, taquilla y socios se define en cada evento.
          </p>
          <Link href="/events" className={styles.ghostLink}>
            Ver eventos
          </Link>
        </div>
      </section>
    );
  }

  const tone = (value: string) =>
    value === 'success'
      ? styles.chipOk
      : value === 'warning'
        ? styles.chipWarn
        : value === 'danger'
          ? styles.chipDanger
          : styles.chip;

  return (
    <section className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Canales de venta</h1>
        </div>
        <div className={local.eventPick}>
          <p className={styles.rowMeta}>Evento</p>
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
          {selected ? (
            <Link href={`/events/${selected}`} className={styles.panelLink}>
              Abrir resumen del evento
            </Link>
          ) : null}
        </div>
      </header>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Canales saludables</p>
          <p className={styles.kpiValue}>
            {formatCount(healthSummary.healthy)}
            <span className={local.of}> / {formatCount(healthCards.length)}</span>
          </p>
          <p className={styles.kpiNote}>
            {healthSummary.worstLatencyMs != null
              ? `peor latencia ${formatMs(healthSummary.worstLatencyMs)}`
              : 'sin telemetría de latencia'}
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Órdenes</p>
          <p className={styles.kpiValue}>{formatCount(healthSummary.totalOrders)}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Ingresos</p>
          <p className={styles.kpiValue}>{money(healthSummary.totalRevenue)}</p>
          <p className={styles.kpiNote}>
            {healthSummary.worstErrorRate != null
              ? `peor tasa de error ${formatPercentPoints(healthSummary.worstErrorRate * 100)}`
              : 'sin errores registrados'}
          </p>
        </div>
      </div>
      {healthError ? (
        <p className={styles.danger} role="alert">
          No se pudo leer la salud de los canales: {healthError}
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <div className={local.alerts}>
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={alert.severity === 'critical' ? local.alertCritical : local.alert}
            >
              <span className={tone(severityMeta(alert.severity).tone)}>
                {severityMeta(alert.severity).label}
              </span>
              <p className={styles.rowTitle}>{alert.title}</p>
              <p className={styles.quiet}>{alert.explanation}</p>
              <p className={styles.tertiary}>{alert.suggestion}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Reparto del inventario</h2>
          <span className={total === 100 ? styles.chipOk : styles.chipDanger}>
            Activos suman {total}%
          </span>
        </div>
        <div className={styles.tableWrap} style={{ border: 0, maxHeight: 'none' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Canal</th>
                <th scope="col">Activo</th>
                <th scope="col">Cupo</th>
                <th scope="col">Responsable</th>
              </tr>
            </thead>
            <tbody>
              {CHANNEL_ORDER.map((key) => {
                const entry = allocation[key];
                const label = channelLabel(key);
                const responsible = RESPONSIBLE_PARTY_CHANNELS.includes(key);
                return (
                  <tr key={key} data-param={label}>
                    <td>
                      <strong>{label}</strong>
                      {entry.enabled ? (
                        <div
                          className={styles.bar}
                          style={{ height: 4, marginTop: 8, maxWidth: 160 }}
                        >
                          <div
                            className={styles.barFill}
                            style={{ width: `${entry.allocation}%` }}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Switch
                        label={`${label} activo`}
                        on={entry.enabled}
                        onChange={(on) => toggleChannel(key, on)}
                      />
                    </td>
                    <td style={{ minWidth: 180 }}>
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
                      ) : (
                        <span className={styles.quiet}>Inactivo</span>
                      )}
                    </td>
                    <td style={{ minWidth: 220 }}>
                      {responsible ? (
                        <div className={styles.stack} style={{ gap: 8 }}>
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
                      ) : (
                        <span className={styles.quiet}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {saveError ? (
          <p className={styles.danger} role="alert">
            {saveError}
          </p>
        ) : null}
        <div className={`${styles.saveBar} ${local.saveBarEnd}`}>
          <p className={allocationIssue && dirty ? styles.out : styles.quiet} aria-live="polite">
            {dirty
              ? allocationIssue
                ? allocationIssue.message
                : `Sin guardar · ${changes.join(' · ')}`
              : (notice ??
                (neverSaved
                  ? 'Este evento aún no tiene reparto guardado: se muestra el sugerido.'
                  : ''))}
          </p>
          <TicketButton
            disabled={!canSave || saving || allocationIssue !== null}
            onClick={() => void save()}
          >
            {saving ? 'Guardando' : 'Guardar reparto'}
          </TicketButton>
        </div>
      </div>

      <div className={styles.split}>
        <div className={`${styles.panel} ${styles.splitWide}`}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Salud por canal</h2>
          </div>
          {healthCards.length === 0 ? (
            <p className={styles.quiet}>Todavía no hay datos de salud para este evento.</p>
          ) : (
            <div className={styles.tableWrap} style={{ border: 0, maxHeight: 'none' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Canal</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className={styles.num}>
                      Órdenes
                    </th>
                    <th scope="col" className={styles.num}>
                      Error
                    </th>
                    <th scope="col" className={styles.num}>
                      Latencia
                    </th>
                    <th scope="col" className={styles.num}>
                      Ingresos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {healthCards.map((card) => {
                    const meta = healthStatusMeta(card.status);
                    return (
                      <tr key={card.key}>
                        <td>
                          <strong>{card.label}</strong>
                          {card.activeTerminals != null ? (
                            <p className={styles.rowMeta}>
                              {formatCount(card.activeTerminals)} terminales
                            </p>
                          ) : card.activePartners != null ? (
                            <p className={styles.rowMeta}>
                              {formatCount(card.activePartners)} socios
                            </p>
                          ) : card.syncLagSec != null ? (
                            <p className={styles.rowMeta}>
                              retraso {formatSeconds(card.syncLagSec)}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <span className={tone(meta.tone)}>{meta.label}</span>
                        </td>
                        <td className={styles.num}>{formatCount(card.orders)}</td>
                        <td className={styles.num}>
                          {card.errorRate != null ? formatPercentPoints(card.errorRate * 100) : '—'}
                        </td>
                        <td className={styles.num}>
                          {card.latencyMs != null ? formatMs(card.latencyMs) : '—'}
                        </td>
                        <td className={styles.num}>
                          <strong>{money(card.revenue)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={`${styles.panel} ${styles.splitNarrow}`}>
          <h2 className={styles.panelTitle}>Mezcla de ingresos · 7 días</h2>
          {analyticsError ? (
            <p className={styles.danger} role="alert">
              No se pudo leer la mezcla de ingresos: {analyticsError}
            </p>
          ) : revenueMix.length === 0 ? (
            <p className={styles.quiet}>Sin órdenes cobradas en los últimos 7 días.</p>
          ) : (
            <ul className={local.mix}>
              {revenueMix.map((slice) => (
                <li key={slice.id} className={local.mixRow}>
                  <div className={local.mixHead}>
                    <span>{slice.label}</span>
                    <span className={local.mixNum}>
                      {money(slice.value)} · {formatPercentPoints(slice.percent)}
                    </span>
                  </div>
                  <div className={styles.bar}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${Math.max(slice.percent, 2)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
