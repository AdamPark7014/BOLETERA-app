'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  SeatMapViewer,
  type SelectedSeatInfo,
} from '@/components/SeatMapViewer';
import {
  describeInventoryError,
  describeNetworkError,
  type InventoryError,
} from '@/components/seatmap/errors';
import { getGuestSessionId, resetGuestSessionId } from '@/components/seatmap/session';
import { HoldErrorNotice } from '@/components/seatmap/HoldErrorNotice';
import {
  flatSeats,
  normalizeSeatMap,
  resolveOfferForSection,
} from '@boletera/venue-engine';
import type { Venue3DViewerProps } from '@boletera/venue-3d';
import { useCartStore, type CartOfferLine } from '@/lib/cart-store';
import { useWaitingRoom } from '@/components/waiting-room/useWaitingRoom';
import { WaitingRoomGate } from '@/components/waiting-room/WaitingRoomGate';
import { isQueueRejection } from '@/components/waiting-room/queue-client';
import styles from './event.module.scss';

const SECTION_PALETTE = ['#5b9fd4', '#c45c6a', '#c4a35a', '#5a9e78', '#7a8fd4', '#b87a9a'];

function colorForSection(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SECTION_PALETTE[h % SECTION_PALETTE.length];
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Offer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string;
  remainingQuantity?: number;
};

type HoldResponse = {
  holds?: { id: string; seatId?: string | null }[];
  expiresAt?: string;
  seats?: { label?: string; section?: string; row?: string; seatNumber?: string }[];
};

function isInventoryError(value: unknown): value is InventoryError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as InventoryError).message === 'string'
  );
}

export function EventPurchaseClient({
  eventId,
  eventTitle,
  slug,
  startsAt,
  venueName,
  venueCity,
  mapData,
  offers,
  minPrice = 0,
  minPriceAllIn,
  currency = 'MXN',
  focusZone = null,
}: {
  eventId: string;
  eventTitle?: string;
  slug?: string;
  startsAt?: string;
  venueName?: string;
  venueCity?: string;
  mapData: unknown;
  offers: Offer[];
  minPrice?: number;
  /** Precio final al comprador (cargos e IVA incluidos). */
  minPriceAllIn?: number;
  currency?: string;
  focusZone?: string | null;
}) {
  const router = useRouter();
  const addToCart = useCartStore((s) => s.addItem);
  /**
   * Sala de espera. Va por delante de todo lo demás: si el evento la tiene
   * activa, el API responde 403 a cualquier hold sin pase, así que dejar elegir
   * butacas antes de tener turno sería enseñar una compra que no existe.
   */
  const room = useWaitingRoom(eventId);
  const { getPass: getQueuePass, onQueueRejected, releaseSpot } = room;
  const normalized = useMemo(() => normalizeSeatMap(mapData), [mapData]);
  const seats2d = useMemo(() => flatSeats(normalized), [normalized]);
  const hasSeatMap = seats2d.length > 0;

  const [seats3dStatus, setSeats3dStatus] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [view3d, setView3d] = useState(false);
  const [Venue3DViewer, setVenue3DViewer] = useState<ComponentType<Venue3DViewerProps> | null>(
    null,
  );
  const [viewer3dError, setViewer3dError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [buyMode, setBuyMode] = useState<'map' | 'best' | 'ga'>(hasSeatMap ? 'map' : 'ga');
  const [qty, setQty] = useState(2);
  /** Último error de reserva ya traducido a algo accionable. */
  const [holdError, setHoldError] = useState<InventoryError | null>(null);
  /** Butacas que perdimos en un 409: el mapa las señala. */
  const [conflictSeatIds, setConflictSeatIds] = useState<string[]>([]);
  /** Cambiarlo obliga al visor a resincronizar el inventario. */
  const [resyncToken, setResyncToken] = useState(0);

  const focusedOffer = useMemo(() => {
    if (focusZone) {
      const needle = focusZone.toLowerCase();
      return (
        offers.find(
          (o) =>
            o.zone.toLowerCase() === needle ||
            (o.name && o.name.toLowerCase().includes(needle)),
        ) ?? null
      );
    }
    // Prefer an offer that matches published sections (skip stale orphan zones).
    for (const sec of normalized.sections) {
      const match = resolveOfferForSection(offers, sec.slug, sec.name);
      if (match && (match.zone === sec.slug || match.name === sec.name || match.zone === sec.name)) {
        return match;
      }
      const bySlug = offers.find((o) => o.zone.toLowerCase() === sec.slug.toLowerCase());
      if (bySlug) return bySlug;
    }
    return offers[0] ?? null;
  }, [focusZone, offers, normalized.sections]);

  const seatsForFocusedOffer = useMemo(() => {
    if (!focusedOffer) return [];
    return seats2d.filter((seat) => {
      const sec = normalized.sections.find((s) => s.id === seat.sectionId);
      const offer = resolveOfferForSection(offers, sec?.slug ?? '', seat.sectionName);
      return offer?.id === focusedOffer.id;
    });
  }, [focusedOffer, seats2d, normalized.sections, offers]);

  // True GA only when there is no seat map, or the focused zone is GA and has no seats.
  const isGaOffer = useMemo(() => {
    if (!hasSeatMap) return true;
    if (!focusedOffer || !focusZone) return false;
    if (seatsForFocusedOffer.length > 0) return false;
    const label = `${focusedOffer.zone} ${focusedOffer.name ?? ''}`.toLowerCase();
    return /\bga\b|general|pista/.test(label);
  }, [hasSeatMap, focusedOffer, focusZone, seatsForFocusedOffer.length]);

  useEffect(() => {
    if (!hasSeatMap) {
      setBuyMode('ga');
      return;
    }
    if (isGaOffer) setBuyMode('ga');
    else setBuyMode((m) => (m === 'ga' ? 'map' : m));
  }, [hasSeatMap, isGaOffer]);

  useEffect(() => {
    if (!view3d || Venue3DViewer || viewer3dError) return;
    let cancelled = false;
    import('@boletera/venue-3d')
      .then((m) => {
        if (cancelled) return;
        setVenue3DViewer(() => m.Venue3DViewer);
      })
      .catch(() => {
        if (cancelled) return;
        setViewer3dError('No se pudo cargar la vista 3D');
        setView3d(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view3d, Venue3DViewer, viewer3dError]);

  useEffect(() => {
    fetch(`${API}/3d/events/${eventId}/interactive`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.statusBySeat && typeof data.statusBySeat === 'object') {
          setSeats3dStatus(data.statusBySeat as Record<string, string>);
          return;
        }
        if (!data.venue) return;
        const status: Record<string, string> = {};
        for (const section of data.venue as { seats?: { id: string; status?: string }[] }[]) {
          for (const s of section.seats ?? []) {
            if (s.status) status[s.id] = s.status;
          }
        }
        setSeats3dStatus(status);
      })
      .catch(() => {});
  }, [eventId]);

  const seatsFor3d = useMemo(() => {
    return seats2d.map((seat) => {
      const sec = normalized.sections.find((s) => s.id === seat.sectionId);
      const offer = resolveOfferForSection(offers, sec?.slug ?? '', seat.sectionName);
      return {
        id: seat.id,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        z: seat.position?.y ?? seat.elevation ?? 0,
        rotation: seat.rotation ?? 0,
        row: seat.row,
        elevation: seat.elevation,
        position: seat.position,
        rotation3d: seat.rotation3d,
        coord3d: seat.coord3d,
        visibility: seat.visibility,
        section: seat.sectionName,
        color: seat.sectionColor || colorForSection(seat.sectionName || sec?.slug || 'zona'),
        price: offer ? Number(offer.basePrice) : undefined,
        levelId: seat.levelId,
        status:
          seat.visibility?.blocked
            ? ('blocked' as const)
            : (seats3dStatus[seat.id] as 'available' | 'held' | 'sold' | 'blocked') || 'available',
      };
    });
  }, [seats2d, normalized.sections, offers, seats3dStatus]);

  const selectedInfo: SelectedSeatInfo[] = useMemo(() => {
    return selected
      .map((id) => {
        const seat = seats2d.find((s) => s.id === id);
        if (!seat) return null;
        const sec = normalized.sections.find((s) => s.id === seat.sectionId);
        const offer = resolveOfferForSection(offers, sec?.slug ?? '', seat.sectionName);
        return {
          seatId: id,
          label: seat.label,
          sectionName: seat.sectionName,
          sectionSlug: sec?.slug ?? '',
          price: offer ? Number(offer.basePrice) : 0,
          offerId: offer?.id ?? '',
        };
      })
      .filter((x): x is SelectedSeatInfo => Boolean(x));
  }, [selected, seats2d, normalized.sections, offers]);

  const estimate = selectedInfo.reduce((s, i) => s + i.price, 0);
  const bestEstimate = focusedOffer ? Number(focusedOffer.basePrice) * qty : 0;

  function toggleSeat(seatId: string) {
    setSelected((prev) => {
      if (prev.includes(seatId)) return prev.filter((id) => id !== seatId);
      if (prev.length >= 8) return prev;
      return [...prev, seatId];
    });
  }

  function groupLines(
    infos: SelectedSeatInfo[],
    holdBySeat: Map<string, string>,
  ): CartOfferLine[] {
    const byOffer = new Map<string, CartOfferLine>();
    for (const info of infos) {
      const holdId = holdBySeat.get(info.seatId);
      if (!holdId || !info.offerId) continue;
      const existing = byOffer.get(info.offerId);
      const label = info.sectionName ? `${info.sectionName} · ${info.label}` : info.label;
      if (existing) {
        existing.holdIds.push(holdId);
        existing.seatLabels = [...(existing.seatLabels ?? []), label];
        existing.quantity += 1;
        existing.lineTotal = (existing.lineTotal ?? 0) + info.price;
      } else {
        const offer = offers.find((o) => o.id === info.offerId);
        byOffer.set(info.offerId, {
          offerId: info.offerId,
          offerName: offer?.name || offer?.zone,
          holdIds: [holdId],
          seatLabels: [label],
          quantity: 1,
          lineTotal: info.price,
        });
      }
    }
    return Array.from(byOffer.values());
  }

  /**
   * Reserva con identidad de invitado estable.
   *
   * Tres reglas del contrato nuevo que aquí se respetan explícitamente:
   *  · `sessionId` SIEMPRE (400 si falta y no hay JWT). Antes se generaba un
   *    UUID nuevo por petición, lo que rompía el tope de 10 boletos y hacía
   *    imposible liberar el propio hold (DELETE → 403).
   *  · NUNCA `x-channel` ni `x-cashier-id` en rutas públicas → 403.
   *  · Un 400 por `sessionId` es un bug del cliente: se regenera la sesión y se
   *    reintenta una vez, sin enseñar nada al comprador.
   *  · `queuePass` en todo hold cuando la sala nos admitió. En eventos sin sala
   *    el API lo ignora; en eventos con sala, su ausencia es un 403.
   */
  const postHold = useCallback(
    async (endpoint: string, body: Record<string, unknown>): Promise<HoldResponse> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const sessionId = attempt === 0 ? getGuestSessionId() : resetGuestSessionId();
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `JSON.stringify` descarta `undefined`: sin pase no se manda el campo.
            body: JSON.stringify({ ...body, sessionId, queuePass: getQueuePass() }),
          });
        } catch {
          throw describeNetworkError();
        }
        let payload: unknown = null;
        try {
          payload = await res.json();
        } catch {
          // Algunas respuestas de error llegan sin cuerpo; el status basta.
        }
        if (res.ok) return (payload ?? {}) as HoldResponse;
        // Un 403 de la fila no es un error de inventario: el pase caducó, se
        // perdió o la sala se activó mientras el comprador miraba el mapa.
        // Se le devuelve a la sala explicando qué pasó, en vez de enseñarle
        // «esa reserva pertenece a otra sesión», que no dice nada y asusta.
        if (isQueueRejection(res.status, payload)) {
          onQueueRejected();
          const queueError: InventoryError = {
            kind: 'forbidden',
            message:
              'Este evento tiene sala de espera y tu pase ya no era válido. Te devolvimos a la fila.',
            selfHealing: false,
            staleMap: false,
          };
          throw queueError;
        }
        const error = describeInventoryError(res.status, payload);
        if (error.selfHealing && attempt === 0) continue;
        throw error;
      }
      throw describeInventoryError(500);
    },
    [getQueuePass, onQueueRejected],
  );

  /** Un 409 no puede dejar al comprador mirando un spinner: se marca y se sigue. */
  function handleHoldFailure(raw: unknown) {
    const error = isInventoryError(raw) ? raw : describeNetworkError();
    setHoldError(error);
    if (error.seatId) {
      setConflictSeatIds([error.seatId]);
      setSelected((prev) => prev.filter((id) => id !== error.seatId));
    }
    if (error.staleMap) setResyncToken((t) => t + 1);
  }

  function goCheckout(lines: CartOfferLine[], expiresAt: string) {
    const seatCount = lines.reduce((s, l) => s + l.quantity, 0);
    addToCart({
      eventId,
      eventTitle: eventTitle ?? 'Evento',
      slug,
      startsAt,
      venueName,
      venueCity,
      expiresAt,
      seatCount,
      currency,
      lines,
    });
    // Los lugares ya están apartados y el pase queda guardado: mantener el
    // sitio en la fila sólo alargaría la espera de los que vienen detrás.
    releaseSpot();
    const params = new URLSearchParams({
      eventId,
      holdIds: lines.flatMap((l) => l.holdIds).join(','),
      expiresAt,
    });
    if (lines.length === 1) params.set('offerId', lines[0].offerId);
    router.push(`/checkout?${params}`);
  }

  async function checkoutMap() {
    if (!selected.length) return;
    setLoading(true);
    setHoldError(null);
    setConflictSeatIds([]);
    try {
      const holdData = await postHold(`${API}/inventory/holds`, {
        eventId,
        seatIds: selected,
      });
      const holds: { id: string; seatId?: string | null }[] = holdData.holds ?? [];
      const holdBySeat = new Map<string, string>();
      for (const h of holds) {
        if (h.seatId) holdBySeat.set(h.seatId, h.id);
      }
      // Fallback if seatId missing on hold: zip by selection order
      if (holdBySeat.size === 0 && holds.length === selected.length) {
        selected.forEach((seatId, i) => holdBySeat.set(seatId, holds[i].id));
      }
      const lines = groupLines(selectedInfo, holdBySeat);
      if (!lines.length) {
        throw {
          kind: 'unknown' as const,
          message:
            'No pudimos asociar tus butacas con una zona de venta. Recarga la página y vuelve a elegir.',
          selfHealing: false,
          staleMap: true,
        };
      }
      const expiresAt =
        holdData.expiresAt ?? new Date(Date.now() + 900_000).toISOString();
      goCheckout(lines, expiresAt);
    } catch (e) {
      handleHoldFailure(e);
    } finally {
      setLoading(false);
    }
  }

  async function checkoutBestOrGa() {
    if (!focusedOffer) return;
    setLoading(true);
    setHoldError(null);
    try {
      const endpoint =
        buyMode === 'ga'
          ? `${API}/inventory/holds`
          : `${API}/inventory/holds/best-available`;
      const body =
        buyMode === 'ga'
          ? { eventId, offerId: focusedOffer.id, quantity: qty }
          : { eventId, offerId: focusedOffer.id, quantity: qty, contiguous: true };
      const holdData = await postHold(endpoint, body);
      const holds: { id: string }[] = holdData.holds ?? [];
      const seatLabels: string[] =
        holdData.seats?.map(
          (s: { label?: string; section?: string; row?: string; seatNumber?: string }) =>
            s.label ||
            [s.section, s.row ? `Fila ${s.row}` : null, s.seatNumber].filter(Boolean).join(' · '),
        ) ?? Array.from({ length: holds.length }, (_, i) => `${focusedOffer.name || focusedOffer.zone} · ${i + 1}`);
      const lines: CartOfferLine[] = [
        {
          offerId: focusedOffer.id,
          offerName: focusedOffer.name || focusedOffer.zone,
          holdIds: holds.map((h) => h.id),
          seatLabels,
          quantity: holds.length,
          lineTotal: Number(focusedOffer.basePrice) * holds.length,
        },
      ];
      const expiresAt =
        holdData.expiresAt ?? new Date(Date.now() + 900_000).toISOString();
      goCheckout(lines, expiresAt);
    } catch (e) {
      handleHoldFailure(e);
    } finally {
      setLoading(false);
    }
  }

  const canPayMap = selected.length > 0 && buyMode === 'map';
  const canPayQty = (buyMode === 'best' || buyMode === 'ga') && qty > 0 && Boolean(focusedOffer);

  // --- puerta de la sala de espera -------------------------------------------
  // Todo lo de arriba son hooks y se ejecuta siempre; sólo el render se corta.
  if (room.phase === 'checking') {
    return (
      <div className={styles.buyBox} id="compra">
        <p className={styles.qtyMeta} role="status">
          Comprobando la disponibilidad de este evento…
        </p>
      </div>
    );
  }

  if (room.phase === 'queued' || room.phase === 'left') {
    return (
      <div className={styles.buyBox} id="compra">
        <WaitingRoomGate room={room} eventTitle={eventTitle} />
      </div>
    );
  }

  return (
    <div className={styles.buyBox} id="compra">
      {room.phase === 'admitted' && (
        <p className={styles.qtyMeta} role="status">
          Pasaste la sala de espera: es tu turno para elegir y apartar lugares.
        </p>
      )}
      <div className={styles.toggle}>
        {!isGaOffer && (
          <>
            <button
              type="button"
              onClick={() => setBuyMode('map')}
              className={buyMode === 'map' ? styles.active : ''}
            >
              Elegir en mapa
            </button>
            <button
              type="button"
              onClick={() => setBuyMode('best')}
              className={buyMode === 'best' ? styles.active : ''}
            >
              Mejor disponible
            </button>
          </>
        )}
        {(isGaOffer || buyMode === 'ga') && (
          <button
            type="button"
            onClick={() => setBuyMode('ga')}
            className={buyMode === 'ga' ? styles.active : ''}
          >
            Entrada general
          </button>
        )}
        {buyMode === 'map' && !isGaOffer && (
          <>
            <button
              type="button"
              onClick={() => setView3d(false)}
              className={!view3d ? styles.active : ''}
            >
              2D
            </button>
            <button
              type="button"
              onClick={() => setView3d(true)}
              className={view3d ? styles.active : ''}
              disabled={!seatsFor3d.length || Boolean(viewer3dError)}
              title={viewer3dError ?? undefined}
            >
              3D
            </button>
          </>
        )}
      </div>

      {(buyMode === 'best' || buyMode === 'ga') && focusedOffer && (
        <div className={styles.qtyPanel}>
          <div>
            <p className={styles.qtyTitle}>
              {buyMode === 'ga' ? 'Entrada general' : 'Mejor disponible'}
            </p>
            <p className={styles.qtyMeta}>
              {focusedOffer.name || focusedOffer.zone} · $
              {Number(focusedOffer.basePrice).toLocaleString('es-MX', {
                maximumFractionDigits: 0,
              })}{' '}
              {currency} c/u
            </p>
          </div>
          <label className={styles.qtyStepper}>
            <span>Cantidad</span>
            <div>
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">
                −
              </button>
              <strong>{qty}</strong>
              <button type="button" onClick={() => setQty((q) => Math.min(8, q + 1))} aria-label="Más">
                +
              </button>
            </div>
          </label>
        </div>
      )}

      {buyMode === 'map' && !isGaOffer && (
        seats2d.length === 0 ? (
          <p className={styles.qtyMeta}>
            Este evento aún no tiene mapa de asientos publicado. Usa «Mejor disponible» o vuelve más tarde.
          </p>
        ) : view3d ? (
          Venue3DViewer ? (
            <Venue3DViewer
              mode="orbit"
              height={520}
              currency={currency}
              seats={seatsFor3d}
              selectedIds={selected}
              onToggleSeat={toggleSeat}
              stage={normalized.venue?.stage}
              aisles={normalized.venue?.aisles}
              obstacles={normalized.venue?.obstacles}
              stairs={normalized.venue?.stairs}
              exits={normalized.venue?.exits}
              furniture={normalized.venue?.furniture}
              focusPoints={normalized.venue?.focusPoints}
              levels={normalized.venue?.levels}
              mapData={normalized}
            />
          ) : (
            <p className={styles.qtyMeta}>Cargando vista 3D del venue…</p>
          )
        ) : (
          <SeatMapViewer
            eventId={eventId}
            mapData={normalized}
            selected={selected}
            offers={offers}
            currency={currency}
            focusZone={focusZone}
            onToggle={toggleSeat}
            onClear={() => setSelected([])}
            conflictSeatIds={conflictSeatIds}
            resyncToken={resyncToken}
          />
        )
      )}

      {holdError && (
        <HoldErrorNotice
          error={holdError}
          onRetry={
            holdError.kind === 'hold-limit'
              ? undefined
              : () => (buyMode === 'map' ? void checkoutMap() : void checkoutBestOrGa())
          }
          onDismiss={() => {
            setHoldError(null);
            setConflictSeatIds([]);
          }}
        />
      )}

      <div className={styles.stickyBuy}>
        <div>
          <p className={styles.stickyTitle}>
            {buyMode === 'map'
              ? selected.length
                ? `${selected.length} asiento${selected.length === 1 ? '' : 's'} · listos`
                : 'Selecciona asientos en el mapa'
              : `${qty} boleto${qty === 1 ? '' : 's'} · ${focusedOffer?.name || focusedOffer?.zone || 'zona'}`}
          </p>
          <p className={styles.stickyMeta}>
            {buyMode === 'map'
              ? selected.length
                ? `Total $${estimate.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`
                : `Desde $${(minPriceAllIn ?? minPrice).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`
              : `Total $${bestEstimate.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`}
          </p>
        </div>
        <button
          type="button"
          className={styles.cta}
          disabled={loading || (buyMode === 'map' ? !canPayMap : !canPayQty)}
          onClick={() => (buyMode === 'map' ? checkoutMap() : checkoutBestOrGa())}
        >
          {loading ? 'Reservando…' : 'Continuar al pago'}
        </button>
      </div>
    </div>
  );
}
