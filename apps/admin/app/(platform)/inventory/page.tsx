'use client';

/**
 * Inventario de boletos: disponibilidad por zona y tier, holds, bloqueos,
 * proyección de agotamiento y alertas. Las gráficas de la versión anterior
 * (dona, barras, anillo) quedan como cifras tabulares con los mismos datos.
 */

import { Suspense, useDeferredValue, useMemo } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import {
  useInventoryAlerts,
  useInventoryAvailability,
  useInventoryEvents,
  useInventoryMetrics,
  useInventorySalesPace,
  useInventoryVenues,
} from '@/lib/queries/inventory';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import bt from '../orders/_bt/bt.module.scss';
import {
  buildEventOptions,
  buildSelloutRisks,
  buildZoneRows,
  statusCountValue,
} from './_lib/derive';
import {
  daysAgoIso,
  formatAvailability,
  formatCount,
  formatDaysToSellOut,
  formatOccupancyRatio,
  formatVelocity,
  rangeLabel,
} from './_lib/format';
import {
  PRESSURE_LABEL,
  PRESSURE_VALUES,
  RANGE_OPTIONS,
  type InventoryZoneTableRow,
  type RangeKey,
} from './_lib/types';
import { useInventoryUrlState } from './_lib/use-inventory-url-state';

const SEVERITY: Record<string, string> = {
  critical: 'Crítica',
  warning: 'Aviso',
  info: 'Información',
};

const RISK: Record<string, string> = {
  critical: 'crítico',
  at_risk: 'en riesgo',
  on_track: 'en ritmo',
};

function failMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

function blockedOf(row: InventoryZoneTableRow): number {
  return Math.max(
    0,
    row.totalQuantity - row.remainingQuantity - row.holdQuantity - row.soldQuantity
  );
}

function Pair({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={bt.pair}>
      <p className={bt.pairLabel}>{label}</p>
      <p className={tone ? `${bt.pairValue} ${tone}` : bt.pairValue}>{value}</p>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <InventarioBody />
      </AdminFrame>
    </Suspense>
  );
}

function InventarioBody() {
  const session = useSession();
  const canSee =
    hasCapability(session.role, 'events.view') || hasCapability(session.role, 'inventory.monitor');

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando inventario.</p>;
  if (!canSee) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Inventario</h1>
          <p className={styles.quiet}>Tu rol no ve inventario.</p>
        </header>
      </section>
    );
  }
  return <InventarioView orgId={session.orgId} />;
}

function InventarioView({ orgId }: { orgId: string }) {
  const url = useInventoryUrlState();
  const deferredQuery = useDeferredValue(url.q);

  const params = useMemo(
    () => ({
      organizationId: orgId,
      from: daysAgoIso(Number(url.range)),
      to: new Date().toISOString(),
      eventId: url.eventId ?? undefined,
    }),
    [orgId, url.eventId, url.range]
  );

  const inventory = useInventoryMetrics(params);
  const pace = useInventorySalesPace(params);
  const alerts = useInventoryAlerts(params);
  const events = useInventoryEvents();
  const venues = useInventoryVenues();

  const zoneRows = useMemo(() => buildZoneRows(inventory.data), [inventory.data]);
  const eventOptions = useMemo(
    () => buildEventOptions(zoneRows, events.data, venues.data),
    [events.data, venues.data, zoneRows]
  );

  const venueEventIds = useMemo(() => {
    if (!url.venueId) return null;
    return new Set(
      (events.data ?? []).filter((event) => event.venueId === url.venueId).map((event) => event.id)
    );
  }, [events.data, url.venueId]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return zoneRows.filter((row) => {
      if (url.eventId && row.eventId !== url.eventId) return false;
      if (venueEventIds && !venueEventIds.has(row.eventId)) return false;
      if (url.pressures.length && !url.pressures.includes(row.pressure)) return false;
      if (!needle) return true;
      return `${row.zone} ${row.tierName} ${row.eventTitle}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [deferredQuery, url.eventId, url.pressures, venueEventIds, zoneRows]);

  const selected = useMemo(
    () => (url.selectedId ? (zoneRows.find((row) => row.id === url.selectedId) ?? null) : null),
    [url.selectedId, zoneRows]
  );

  const availability = useInventoryAvailability(selected?.eventId ?? url.eventId);

  const summary = inventory.data?.summary;

  const statusRows = useMemo(() => {
    const breakdown = inventory.data?.statusBreakdown;
    if (breakdown?.rows?.length) {
      return breakdown.rows.map((row) => ({ id: row.key, label: row.label, value: row.value }));
    }
    if (!summary) return [];
    return [
      { id: 'available', label: 'Disponibles', value: summary.available },
      { id: 'held', label: 'En hold', value: summary.held },
      { id: 'sold', label: 'Vendidos', value: summary.sold },
      { id: 'blocked', label: 'Bloqueados', value: summary.blocked },
    ];
  }, [inventory.data?.statusBreakdown, summary]);

  const sellouts = useMemo(() => buildSelloutRisks(filtered), [filtered]);
  const inventoryAlerts = useMemo(
    () =>
      (alerts.data?.alerts ?? []).filter(
        (alert) => alert.domain === 'inventory' || alert.domain === 'events'
      ),
    [alerts.data]
  );
  const atRiskEvents = pace.data?.atRisk ?? [];

  const venueOptions = useMemo(() => {
    const used = new Set(eventOptions.map((event) => event.venueName).filter(Boolean));
    return (venues.data ?? []).filter((venue) => used.has(venue.name) || used.size === 0);
  }, [eventOptions, venues.data]);

  const pressureOptions = [
    { value: '', label: `Toda presión (${zoneRows.length})` },
    ...PRESSURE_VALUES.map((value) => ({
      value,
      label: `${PRESSURE_LABEL[value]} (${zoneRows.filter((row) => row.pressure === value).length})`,
    })),
  ];
  const eventSelect = [
    { value: '', label: 'Todos los eventos' },
    ...eventOptions.map((event) => ({
      value: event.id,
      label: event.venueName ? `${event.title} · ${event.venueName}` : event.title,
    })),
  ];
  const venueSelect = [
    { value: '', label: 'Todos los recintos' },
    ...venueOptions.map((venue) => ({ value: venue.id, label: venue.name })),
  ];

  const filtering = Boolean(url.q || url.pressures.length || url.eventId || url.venueId);
  const counts = availability.data?.statusCounts;

  function refresh() {
    void inventory.refetch();
    void pace.refetch();
    void alerts.refetch();
    void events.refetch();
    void venues.refetch();
    void availability.refetch();
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Inventario</h1>
        <p className={styles.quiet}>
          Disponibilidad por zona y tier, holds, bloqueos y proyección de agotamiento. Aquí se lee;
          los cupos se editan en cada evento.
        </p>
        <div className={bt.actions}>
          <div className={bt.segmentWrap}>
            <Segment<RangeKey>
              label="Rango de análisis"
              value={url.range}
              options={[...RANGE_OPTIONS]}
              onChange={url.setRange}
            />
          </div>
          <TicketButton variant="secondary" disabled={inventory.isFetching} onClick={refresh}>
            Actualizar
          </TicketButton>
        </div>
      </header>

      {inventory.error ? (
        <ApiErrorView
          error={inventory.error}
          context="leer el inventario"
          onRetry={() => void inventory.refetch()}
        />
      ) : inventory.isPending ? (
        <p className={styles.quiet}>Cargando inventario.</p>
      ) : (
        <>
          <div className={styles.rows}>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Aforo</p>
                <p className={styles.rowMeta}>{rangeLabel(url.range)}</p>
              </div>
              <span />
              <p className={styles.figure}>{formatCount(summary?.totalCapacity ?? 0)}</p>
            </div>
            {statusRows.map((row) => (
              <div key={row.id} className={styles.row}>
                <p className={styles.rowTitle}>{row.label}</p>
                <span />
                <p className={styles.figure}>{formatCount(row.value)}</p>
              </div>
            ))}
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Holds activos</p>
                <p className={styles.rowMeta}>Apartados vigentes en este momento</p>
              </div>
              <span />
              <p className={styles.figure}>{formatCount(summary?.activeHolds ?? 0)}</p>
            </div>
            <div className={styles.row}>
              <p className={styles.rowTitle}>Ocupación vendida</p>
              <span />
              <p className={styles.figure}>
                {formatOccupancyRatio(summary?.sold ?? 0, summary?.totalCapacity ?? 0)}
              </p>
            </div>
          </div>

          <div className={bt.block}>
            <div className={bt.toolbar}>
              <Field
                label="Buscar"
                kind="search"
                value={url.q}
                placeholder="Zona, tier o evento"
                onChange={(event) => url.setSearch(event.target.value)}
              />
              <div>
                <p className={bt.filterLabel}>Presión</p>
                <SheetSelect
                  label="Presión"
                  value={url.pressures[0] ?? ''}
                  placeholder="Toda presión"
                  options={pressureOptions}
                  onChange={(value) => url.setFilterSelection(value ? { pressure: [value] } : {})}
                />
              </div>
              <div>
                <p className={bt.filterLabel}>Evento</p>
                <SheetSelect
                  label="Evento"
                  value={url.eventId ?? ''}
                  placeholder="Todos los eventos"
                  options={eventSelect}
                  onChange={(value) => url.setEventId(value || null)}
                />
              </div>
              {venueOptions.length > 0 ? (
                <div>
                  <p className={bt.filterLabel}>Recinto</p>
                  <SheetSelect
                    label="Recinto"
                    value={url.venueId ?? ''}
                    placeholder="Todos los recintos"
                    options={venueSelect}
                    onChange={(value) => url.setVenueId(value || null)}
                  />
                </div>
              ) : null}
            </div>
            <div className={bt.actions}>
              <p className={styles.tertiary} role="status">
                {formatCount(filtered.length)} de {formatCount(zoneRows.length)} zonas
              </p>
              {filtering ? (
                <TicketButton variant="ghost" onClick={url.clearFilters}>
                  Limpiar filtros
                </TicketButton>
              ) : null}
            </div>
          </div>

          <div className={bt.block}>
            {zoneRows.length === 0 ? (
              <>
                <p className={styles.quiet}>
                  {events.data?.length
                    ? 'Hay eventos, pero el inventario aún no reporta zonas. Publica ofertas o espera la agregación.'
                    : 'Sin inventario. Crea y publica un evento con ofertas para ver cupos y holds.'}
                </p>
                <div className={bt.actions}>
                  <Link href="/events" className={bt.link}>
                    Abrir eventos
                  </Link>
                  <Link href="/venues" className={bt.link}>
                    Recintos
                  </Link>
                </div>
              </>
            ) : filtered.length === 0 ? (
              <p className={styles.quiet}>Nada con ese criterio.</p>
            ) : null}
            {filtered.map((row) => {
              const open = url.selectedId === row.id;
              return (
                <div key={row.id} className={styles.stack}>
                  <button
                    type="button"
                    className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                    aria-expanded={open}
                    onClick={() => url.setSelectedId(open ? null : row.id)}
                  >
                    <span>
                      {row.tierName} · {row.eventTitle} · Presión{' '}
                      {PRESSURE_LABEL[row.pressure].toLowerCase()}
                    </span>
                    <span className={styles.figure}>
                      {formatCount(row.remainingQuantity)} / {formatCount(row.totalQuantity)}
                    </span>
                  </button>
                  {open ? (
                    <div className={bt.detail}>
                      <div className={styles.rows}>
                        <Pair label="Zona" value={row.zone} />
                        <Pair label="Aforo de la zona" value={formatCount(row.totalQuantity)} />
                        <Pair label="Disponibles" value={formatCount(row.remainingQuantity)} />
                        <Pair label="En hold" value={formatCount(row.holdQuantity)} />
                        <Pair label="Vendidos" value={formatCount(row.soldQuantity)} />
                        <Pair label="Bloqueos estimados" value={formatCount(blockedOf(row))} />
                        <Pair
                          label="Disponibilidad"
                          value={formatAvailability(row.availabilityPercent)}
                        />
                        <Pair label="Velocidad" value={formatVelocity(row.sellThroughVelocity)} />
                        <Pair
                          label="Agotamiento estimado"
                          value={formatDaysToSellOut(row.daysToSellOut)}
                        />
                      </div>
                      <p className={styles.rowTitle}>Disponibilidad en vivo del evento</p>
                      {availability.isPending ? (
                        <p className={styles.quiet}>Consultando disponibilidad.</p>
                      ) : availability.error ? (
                        <p className={styles.danger} role="alert">
                          {failMessage(availability.error, 'No se leyó la disponibilidad en vivo.')}
                        </p>
                      ) : availability.data ? (
                        <div className={styles.rows}>
                          <Pair
                            label="Holds activos"
                            value={formatCount(availability.data.activeHolds)}
                          />
                          <Pair
                            label="Disponibles"
                            value={formatCount(statusCountValue(counts, ['AVAILABLE']))}
                          />
                          <Pair
                            label="Apartados"
                            value={formatCount(statusCountValue(counts, ['HELD']))}
                          />
                          <Pair
                            label="Vendidos, usados o transferidos"
                            value={formatCount(
                              statusCountValue(counts, ['SOLD', 'USED', 'TRANSFERRED'])
                            )}
                          />
                          <Pair
                            label="Bloqueos y otros"
                            value={formatCount(
                              statusCountValue(counts, ['BLOCKED', 'RESERVED_OPS', 'COMP'])
                            )}
                          />
                        </div>
                      ) : (
                        <p className={styles.quiet}>
                          Sin lectura de disponibilidad para este evento.
                        </p>
                      )}
                      <p className={styles.tertiary}>
                        Oferta <span className={styles.mono}>{row.offerId}</span>
                      </p>
                      <Link href={`/events/${row.eventId}`} className={bt.link}>
                        Abrir el evento
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className={bt.block}>
            <p className={styles.rowTitle}>Riesgo de agotamiento</p>
            <p className={styles.tertiary}>
              Zonas a 14 días o menos del agotamiento al ritmo actual.
            </p>
            {sellouts.length === 0 ? (
              <p className={styles.quiet}>
                Ninguna zona del filtro proyecta agotarse en dos semanas.
              </p>
            ) : (
              <div className={styles.rows}>
                {sellouts.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`${styles.row} ${bt.rowButton} ${bt.rowLink}`}
                    onClick={() => url.setSelectedId(row.id)}
                  >
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>
                        {row.tierName} · {row.eventTitle}
                      </p>
                      <p className={styles.rowMeta}>{formatCount(row.remainingQuantity)} libres</p>
                    </div>
                    <span />
                    <p className={styles.figure}>{formatDaysToSellOut(row.daysToSellOut)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={bt.block}>
            <p className={styles.rowTitle}>Riesgo de ritmo</p>
            <p className={styles.tertiary}>Eventos atrasados contra el ritmo de venta esperado.</p>
            {pace.isPending ? (
              <p className={styles.quiet}>Cargando ritmo de venta.</p>
            ) : pace.error ? (
              <p className={styles.danger} role="alert">
                {failMessage(pace.error, 'No se leyó el ritmo de venta.')}
              </p>
            ) : atRiskEvents.length === 0 ? (
              <p className={styles.quiet}>Ningún evento supera el umbral de atraso.</p>
            ) : (
              <div className={styles.rows}>
                {atRiskEvents.slice(0, 5).map((event) => (
                  <div key={event.eventId} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{event.title}</p>
                      <p className={styles.rowMeta}>
                        Riesgo {RISK[event.riskLevel] ?? event.riskLevel}
                      </p>
                    </div>
                    <span />
                    <p className={styles.figure}>
                      {event.occupancyPercent.toLocaleString('es-MX', { maximumFractionDigits: 1 })}{' '}
                      %
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={bt.block}>
            <p className={styles.rowTitle}>Alertas</p>
            {alerts.error ? (
              <p className={styles.danger} role="alert">
                {failMessage(alerts.error, 'No se leyeron las alertas.')}
              </p>
            ) : inventoryAlerts.length === 0 ? (
              <p className={styles.quiet}>Sin alertas de inventario en este periodo.</p>
            ) : (
              <div className={styles.rows}>
                {inventoryAlerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{alert.title}</p>
                      <p className={styles.rowMeta}>{alert.explanation}</p>
                    </div>
                    <span />
                    <p className={alert.severity === 'critical' ? styles.danger : styles.quiet}>
                      {SEVERITY[alert.severity] ?? alert.severity}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
