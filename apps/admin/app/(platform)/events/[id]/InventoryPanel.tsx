'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ProgressRing,
} from '@boletera/ui';
import type { InventoryMetrics } from '@boletera/shared';
import type { SeatMapData } from '@boletera/shared';
import { flatSeats, normalizeSeatMap, resolveOfferForSection } from '@boletera/venue-engine';
import type { EventHub } from '@/lib/platform-api';
import { useVenueLayout } from '@/lib/queries/venues';
import { formatCount, formatPercentPoints } from './format';
import styles from './event-hub.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

type SeatStatus = 'available' | 'held' | 'sold' | 'blocked';

type Props = {
  eventId: string;
  hub: EventHub;
  inventoryMetrics: InventoryMetrics | undefined;
  inventoryLoading: boolean;
  inventoryError: string | null;
  canManageVenue: boolean;
};

export function InventoryPanel({
  eventId,
  hub,
  inventoryMetrics,
  inventoryLoading,
  inventoryError,
  canManageVenue,
}: Props) {
  const venueId = hub.event.venue?.id ?? hub.event.venueId ?? '';
  const layoutQuery = useVenueLayout(venueId);
  const [seats3dStatus, setSeats3dStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/3d/events/${eventId}/interactive`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { statusBySeat?: Record<string, string> } | null) => {
        if (!cancelled && data?.statusBySeat) setSeats3dStatus(data.statusBySeat);
      })
      .catch(() => {
        if (!cancelled) setSeats3dStatus({});
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const venueMapData: SeatMapData | null = layoutQuery.data?.layout.mapData ?? null;
  const normalizedVenueMap = useMemo(
    () => (venueMapData ? normalizeSeatMap(venueMapData) : null),
    [venueMapData],
  );

  const seatsFor3d = useMemo(() => {
    if (!normalizedVenueMap) return [];
    const offers = hub.event.offers ?? [];
    return flatSeats(normalizedVenueMap).map((seat) => {
      const section = normalizedVenueMap.sections.find((item) => item.id === seat.sectionId);
      const offer = resolveOfferForSection(offers, section?.slug ?? '', seat.sectionName);
      const rawStatus = seats3dStatus[seat.id];
      const status: SeatStatus = seat.visibility?.blocked
        ? 'blocked'
        : rawStatus === 'held' ||
            rawStatus === 'sold' ||
            rawStatus === 'blocked' ||
            rawStatus === 'available'
          ? rawStatus
          : 'available';
      return {
        id: seat.id,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        z: seat.position?.y ?? seat.elevation ?? 0,
        rotation: seat.rotation,
        row: seat.row,
        elevation: seat.elevation,
        position: seat.position,
        rotation3d: seat.rotation3d,
        coord3d: seat.coord3d,
        visibility: seat.visibility,
        section: seat.sectionName,
        color: seat.sectionColor,
        price: offer ? Number(offer.basePrice) : undefined,
        levelId: seat.levelId,
        status,
      };
    });
  }, [normalizedVenueMap, hub.event.offers, seats3dStatus]);

  const zones =
    inventoryMetrics?.byZone.filter((row) => row.eventId === eventId) ?? [];
  const summary = inventoryMetrics?.summary;
  const hubInv = hub.inventory;

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="hub-panel-inventory"
      aria-labelledby="hub-tab-inventory"
    >
      <div className={styles.statGrid} aria-label="Resumen de inventario">
        <article className={styles.statCard}>
          <span>Capacidad hub</span>
          <strong>{formatCount(hubInv.total)}</strong>
          <small>{formatPercentPoints(hubInv.occupancyPercent)} ocupación</small>
        </article>
        <article className={styles.statCard}>
          <span>Vendidos</span>
          <strong>{formatCount(hubInv.sold)}</strong>
        </article>
        <article className={styles.statCard}>
          <span>Disponibles</span>
          <strong>{formatCount(hubInv.available)}</strong>
        </article>
        <article className={styles.statCard}>
          <span>En hold</span>
          <strong>{formatCount(hubInv.held)}</strong>
        </article>
        {summary ? (
          <article className={styles.statCard}>
            <span>Bloqueados (métricas)</span>
            <strong>{formatCount(summary.blocked)}</strong>
            <small>{formatCount(summary.activeHolds)} holds activos</small>
          </article>
        ) : null}
      </div>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Inventario por zona"
          description="Métricas de disponibilidad y velocidad de venta"
          actions={
            summary ? (
              <ProgressRing
                value={
                  summary.totalCapacity > 0
                    ? (summary.sold / summary.totalCapacity) * 100
                    : 0
                }
                label="Ocupación"
                size={56}
              />
            ) : undefined
          }
        />
        {inventoryError ? (
          <EmptyState
            title="No se pudo cargar inventario por zona"
            description={inventoryError}
            illustration="error"
            tone="danger"
            size="sm"
          />
        ) : inventoryLoading && zones.length === 0 ? (
          <EmptyState
            title="Cargando zonas…"
            description="Consultando métricas de inventario del evento."
            illustration="inbox"
            size="sm"
          />
        ) : zones.length === 0 ? (
          <EmptyState
            title="Sin desglose por zona"
            description="El hub tiene inventario agregado, pero las métricas por zona aún no están disponibles para este evento."
            illustration="seats"
            size="sm"
          />
        ) : (
          <div className={styles.tableWrap} role="region" aria-label="Zonas de inventario">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Zona</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Vendidos</th>
                  <th scope="col">Restantes</th>
                  <th scope="col">Disponibilidad</th>
                  <th scope="col">Velocidad</th>
                  <th scope="col">Días a sold-out</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.offerId}>
                    <td>{zone.zone}</td>
                    <td>{zone.tierName}</td>
                    <td>{formatCount(zone.soldQuantity)}</td>
                    <td>{formatCount(zone.remainingQuantity)}</td>
                    <td>
                      <Badge
                        tone={
                          zone.availabilityPercent < 15
                            ? 'danger'
                            : zone.availabilityPercent < 40
                              ? 'warning'
                              : 'success'
                        }
                        variant="soft"
                        size="sm"
                      >
                        {formatPercentPoints(zone.availabilityPercent)}
                      </Badge>
                    </td>
                    <td>{zone.sellThroughVelocity.toLocaleString('es-MX', { maximumFractionDigits: 2 })}/día</td>
                    <td>
                      {zone.daysToSellOut == null
                        ? '—'
                        : formatCount(Math.round(zone.daysToSellOut))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Mapa 3D en vivo"
          description="Estados de asiento desde el endpoint interactivo"
          actions={
            venueId && canManageVenue ? (
              <div className={styles.actionGroup}>
                <Link href={`/venues/${venueId}/map`}>Layout</Link>
                <Link href={`/venues/${venueId}/3d`}>Vista 3D</Link>
              </div>
            ) : undefined
          }
        />
        {!venueId ? (
          <EmptyState
            title="Evento sin venue"
            description="Asocia un venue para visualizar el mapa 3D."
            illustration="seats"
            size="sm"
          />
        ) : layoutQuery.isPending ? (
          <EmptyState
            title="Cargando layout…"
            description="Obteniendo el mapa del venue."
            illustration="inbox"
            size="sm"
          />
        ) : layoutQuery.error ? (
          <EmptyState
            title="No se pudo cargar el layout"
            description={
              layoutQuery.error instanceof Error
                ? layoutQuery.error.message
                : 'Error al consultar el mapa del venue.'
            }
            illustration="error"
            tone="danger"
            size="sm"
          />
        ) : seatsFor3d.length === 0 ? (
          <EmptyState
            title="Sin asientos en el layout"
            description="El venue todavía no tiene asientos en su mapa. Publica inventario cuando el layout esté listo."
            illustration="seats"
            size="sm"
          />
        ) : (
          <div className={styles.mapFrame}>
            <Venue3DViewer
              mode="orbit"
              seats={seatsFor3d}
              currency="MXN"
              stage={normalizedVenueMap?.venue?.stage}
              aisles={normalizedVenueMap?.venue?.aisles}
              obstacles={normalizedVenueMap?.venue?.obstacles}
              stairs={normalizedVenueMap?.venue?.stairs}
              exits={normalizedVenueMap?.venue?.exits}
              furniture={normalizedVenueMap?.venue?.furniture}
              focusPoints={normalizedVenueMap?.venue?.focusPoints}
              levels={normalizedVenueMap?.venue?.levels}
              mapData={normalizedVenueMap}
            />
          </div>
        )}
        <p className={styles.hint}>
          Publica inventario antes de vender. Los estados en vivo dependen del endpoint 3D del evento.
        </p>
      </Card>
    </div>
  );
}
