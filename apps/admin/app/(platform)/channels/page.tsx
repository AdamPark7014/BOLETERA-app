'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@boletera/ui';
import {
  listEvents,
  getChannelHealth,
  getChannelAnalytics,
  configureChannels,
  type EventRow,
} from '@/lib/platform-api';
import { ApiError } from '@/lib/api';
import {
  AnonymousView,
  ApiErrorView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';
import styles from './channels.module.scss';
import {
  CHANNEL_ORDER,
  RESPONSIBLE_PARTY_CHANNELS,
  allocationTotal,
  buildChannelAlerts,
  buildRevenueMix,
  channelLabel,
  formatCount,
  formatMxn,
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
  type ChannelKey,
} from './model';

export default function ChannelsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState('');
  const [healthRaw, setHealthRaw] = useState<unknown>(null);
  const [analyticsRaw, setAnalyticsRaw] = useState<unknown>(null);
  const [allocation, setAllocation] = useState<AllocationForm>(() =>
    parseAllocationFromMetadata(undefined),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const session = useSession();
  const token = session.token;

  useEffect(() => {
    if (!token) return;
    setError(null);
    listEvents(token)
      .then((list) => {
        setEvents(list);
        if (list[0] && !selected) setSelected(list[0].id);
      })
      .catch(setError);
  }, [token, nonce, selected]);

  useEffect(() => {
    if (!selected || !token) return;
    getChannelHealth(token, selected).then(setHealthRaw).catch(() => setHealthRaw(null));
    getChannelAnalytics(token, selected).then(setAnalyticsRaw).catch(() => setAnalyticsRaw(null));
    const ev = events.find((e) => e.id === selected);
    if (ev?.metadata) setAllocation(parseAllocationFromMetadata(ev.metadata));
  }, [selected, events, token]);

  const healthCards = useMemo(() => parseChannelHealth(healthRaw), [healthRaw]);
  const healthSummary = useMemo(() => summarizeHealth(healthCards), [healthCards]);
  const allocationIssue = useMemo(() => validateAllocation(allocation), [allocation]);
  const total = allocationTotal(allocation);

  const revenueMix = useMemo(() => {
    const bucket =
      (analyticsRaw as { last7days?: Record<string, { revenue: number; orders: number }> })
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
    [healthCards, revenueMix, allocation, allocationIssue],
  );

  function patchChannel(key: ChannelKey, patch: Partial<AllocationForm[ChannelKey]>) {
    setAllocation((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  function toggleChannel(key: ChannelKey, enabled: boolean) {
    patchChannel(key, {
      enabled,
      allocation: enabled ? prevAllocationFor(key) : 0,
    });
  }

  function prevAllocationFor(key: ChannelKey): number {
    const entry = allocation[key];
    if (entry.allocation > 0) return entry.allocation;
    return DEFAULT_FALLBACK[key] ?? 0;
  }

  async function save() {
    const issue = validateAllocation(allocation);
    if (issue) {
      setMsg(issue.message);
      return;
    }
    if (!token || !selected) return;
    setSaving(true);
    setMsg(null);
    try {
      await configureChannels(token, selected, toChannelConfiguration(allocation));
      setMsg('Canales guardados');
      const list = await listEvents(token);
      setEvents(list);
      getChannelHealth(token, selected).then(setHealthRaw).catch(() => setHealthRaw(null));
      getChannelAnalytics(token, selected).then(setAnalyticsRaw).catch(() => setAnalyticsRaw(null));
    } catch (e) {
      setMsg(
        e instanceof ApiError
          ? `${e.userMessage} (${e.status})`
          : e instanceof Error
            ? e.message
            : 'Error',
      );
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
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.pageHeader}>
        <div className={styles.headerCopy}>
          <div className={styles.eyebrowRow}>
            <p className={styles.eyebrow}>Distribución</p>
          </div>
          <h1>Canales de venta</h1>
          <p className={styles.lead}>
            Configura los 13 canales del dominio: activación, asignación de inventario (debe sumar
            100 % entre canales habilitados) y responsables.
          </p>
        </div>
        <div className={styles.headerControls}>
          <label className={styles.srOnly} htmlFor="channel-event-select">
            Evento
          </label>
          <select
            id="channel-event-select"
            className={styles.eventSelect}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className={styles.kpiGrid}>
        <article className={platform.statCard}>
          <span>Canales saludables</span>
          <strong>{healthSummary.healthy}</strong>
          <small>de {healthCards.length} canales</small>
        </article>
        <article className={platform.statCard}>
          <span>Órdenes (salud)</span>
          <strong>{formatCount(healthSummary.totalOrders)}</strong>
          <small>todas las fuentes</small>
        </article>
        <article className={platform.statCard}>
          <span>Ingresos (salud)</span>
          <strong>{formatMxn(healthSummary.totalRevenue)}</strong>
          <small>último snapshot</small>
        </article>
        <article className={platform.statCard}>
          <span>Asignación</span>
          <strong className={total === 100 ? styles.totalOk : styles.totalBad}>{total} %</strong>
          <small>{total === 100 ? 'Lista para guardar' : 'Debe sumar 100 %'}</small>
        </article>
        <article className={platform.statCard}>
          <span>Peor error rate</span>
          <strong>
            {healthSummary.worstErrorRate != null
              ? formatPercentPoints(healthSummary.worstErrorRate * 100)
              : '—'}
          </strong>
          <small>telemetría</small>
        </article>
        <article className={platform.statCard}>
          <span>Peor latencia</span>
          <strong>
            {healthSummary.worstLatencyMs != null ? formatMs(healthSummary.worstLatencyMs) : '—'}
          </strong>
          <small>web / móvil</small>
        </article>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2>Asignación por canal</h2>
            <p>Solo los canales habilitados cuentan hacia el 100 % de inventario.</p>
          </div>
        </div>

        <div className={styles.formGrid}>
          {CHANNEL_ORDER.map((key) => {
            const entry = allocation[key];
            const showResponsible = RESPONSIBLE_PARTY_CHANNELS.includes(key);
            return (
              <div key={key} className={styles.channelField}>
                <div className={styles.channelFieldHead}>
                  <span className={styles.channelFieldLabel}>{channelLabel(key)}</span>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) => toggleChannel(key, e.target.checked)}
                    />
                    {entry.enabled ? 'Activo' : 'Off'}
                  </label>
                </div>
                <label className={styles.fieldLabel} htmlFor={`alloc-${key}`}>
                  Asignación %
                </label>
                <input
                  id={`alloc-${key}`}
                  className={styles.input}
                  type="number"
                  min={0}
                  max={100}
                  disabled={!entry.enabled}
                  value={entry.allocation}
                  onChange={(e) =>
                    patchChannel(key, { allocation: Number(e.target.value) || 0 })
                  }
                />
                {showResponsible && (
                  <>
                    <label className={styles.fieldLabel} htmlFor={`resp-${key}`}>
                      {responsiblePartyLabel(key)}
                    </label>
                    <input
                      id={`resp-${key}`}
                      className={styles.input}
                      type="text"
                      disabled={!entry.enabled}
                      placeholder="Nombre o referencia"
                      value={entry.responsibleParty}
                      onChange={(e) => patchChannel(key, { responsibleParty: e.target.value })}
                    />
                  </>
                )}
                {key === 'taquilla' && entry.enabled && (
                  <>
                    <label className={styles.fieldLabel} htmlFor="taq-locations">
                      Ubicaciones (coma)
                    </label>
                    <input
                      id="taq-locations"
                      className={styles.input}
                      type="text"
                      placeholder="Centro, Norte, VIP booth"
                      value={entry.locations.join(', ')}
                      onChange={(e) =>
                        patchChannel(key, {
                          locations: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.totalRow}>
          <p className={total === 100 ? styles.totalOk : styles.totalBad}>
            Total habilitado: {total} % {total !== 100 && '(ajusta hasta 100 %)'}
          </p>
          <div className={styles.formActions}>
            <button
              type="button"
              className={platform.primaryBtn}
              disabled={saving || allocationIssue !== null}
              onClick={save}
            >
              {saving ? 'Guardando…' : 'Guardar asignación'}
            </button>
            {selected && (
              <Link href={`/events/${selected}`} className={platform.ghostBtn}>
                Hub del evento →
              </Link>
            )}
          </div>
        </div>

        {allocationIssue && (
          <div className={styles.callout} role="alert">
            {allocationIssue.message}
          </div>
        )}
        {msg && !allocationIssue && (
          <div className={styles.successBanner} style={{ marginTop: '0.85rem' }}>
            {msg}
          </div>
        )}
      </section>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Salud en tiempo real</h2>
              <p>Estado operativo de los 13 canales de venta.</p>
            </div>
          </div>
          <div className={styles.healthGrid}>
            {healthCards.map((card) => {
              const meta = healthStatusMeta(card.status);
              return (
                <article key={card.key} className={styles.healthCard}>
                  <div className={styles.healthTop}>
                    <h3 className={styles.healthTitle}>{card.label}</h3>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <dl className={styles.healthMeta}>
                    <div>
                      <dt>Órdenes</dt>
                      <dd>{formatCount(card.orders)}</dd>
                    </div>
                    <div>
                      <dt>Ingresos</dt>
                      <dd>{formatMxn(card.revenue)}</dd>
                    </div>
                    {card.errorRate != null && (
                      <div>
                        <dt>Error rate</dt>
                        <dd>{formatPercentPoints(card.errorRate * 100)}</dd>
                      </div>
                    )}
                    {card.latencyMs != null && (
                      <div>
                        <dt>Latencia</dt>
                        <dd>{formatMs(card.latencyMs)}</dd>
                      </div>
                    )}
                    {card.syncLagSec != null && (
                      <div>
                        <dt>Sync lag</dt>
                        <dd>{formatSeconds(card.syncLagSec)}</dd>
                      </div>
                    )}
                    {card.activeTerminals != null && (
                      <div>
                        <dt>Terminales</dt>
                        <dd>{formatCount(card.activeTerminals)}</dd>
                      </div>
                    )}
                    {card.activePartners != null && (
                      <div>
                        <dt>Partners</dt>
                        <dd>{formatCount(card.activePartners)}</dd>
                      </div>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Mix de ingresos (7 días)</h2>
              <p>Desglose analítico por canal desde la API de reporting.</p>
            </div>
          </div>
          {revenueMix.length === 0 ? (
            <p className={styles.fieldHint}>Sin órdenes completadas en el periodo.</p>
          ) : (
            <ul className={styles.mixList}>
              {revenueMix.map((slice) => (
                <li key={slice.id} className={styles.mixItem}>
                  <span className={styles.mixName}>{slice.label}</span>
                  <span className={styles.mixOrders}>{formatCount(slice.orders)} órdenes</span>
                  <span className={styles.mixRev}>
                    {formatMxn(slice.value)} · {formatPercentPoints(slice.percent)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {alerts.length > 0 && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Alertas y recomendaciones</h2>
              <p>Señales automáticas a partir de salud, mix y asignación.</p>
            </div>
          </div>
          <ul className={styles.alertList}>
            {alerts.map((alert) => {
              const meta = severityMeta(alert.severity);
              return (
                <li key={alert.id} className={styles.alertItem}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className={styles.alertTitle}>{alert.title}</span>
                  </div>
                  <p className={styles.alertBody}>{alert.explanation}</p>
                  <p className={styles.alertAction}>{alert.suggestion}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

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
