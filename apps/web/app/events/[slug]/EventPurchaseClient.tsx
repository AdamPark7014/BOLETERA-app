'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { SeatMapViewer, type SelectedSeatInfo } from '@/components/SeatMapViewer';
import {
  describeInventoryError,
  describeNetworkError,
  type InventoryError,
} from '@/components/seatmap/errors';
import { ensureGuestSession, renewGuestSession } from '@/components/seatmap/session';
import { HoldErrorNotice } from '@/components/seatmap/HoldErrorNotice';
import { flatSeats, normalizeSeatMap, resolveOfferForSection } from '@boletera/venue-engine';
import type { Venue3DViewerProps } from '@boletera/venue-3d';
import Link from 'next/link';
import { StageArt, formatTicketAmount } from '@boletera/ui';
import { useCartStore, type CartOfferLine } from '@/lib/cart-store';
import { fetchCartPricing, pricingTotal } from '@/lib/pricing';
import { useWaitingRoom } from '@/components/waiting-room/useWaitingRoom';
import { offerTones } from '@/lib/zone-tones';
import { sortOffersForDisplay } from '@/lib/offer-order';
import { WaitingRoomGate } from '@/components/waiting-room/WaitingRoomGate';
import { isQueueRejection } from '@/components/waiting-room/queue-client';
import styles from './event.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Offer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string;
  allInPrice?: number;
  remainingQuantity?: number;
  isAvailable?: boolean;
  sortOrder?: number | null;
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
  image = null,
  allowResale,
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
  /** Miniatura del evento para la lista de opciones. */
  image?: string | null;
  allowResale?: boolean;
}) {
  const router = useRouter();
  const addToCart = useCartStore((s) => s.addItem);
  const orderedOffers = useMemo(() => sortOffersForDisplay(offers), [offers]);
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
    null
  );
  const [viewer3dError, setViewer3dError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [buyMode, setBuyMode] = useState<'map' | 'best' | 'ga'>(hasSeatMap ? 'map' : 'ga');
  const [qty, setQty] = useState(2);
  /** Último error de reserva ya traducido a algo accionable. */
  const [holdError, setHoldError] = useState<InventoryError | null>(null);
  /** Código de preventa: el campo se abre a pedido o cuando la fase lo exige. */
  const [accessCode, setAccessCode] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  /** Butacas que perdimos en un 409: el mapa las señala. */
  const [conflictSeatIds, setConflictSeatIds] = useState<string[]>([]);
  /** Cambiarlo obliga al visor a resincronizar el inventario. */
  const [resyncToken, setResyncToken] = useState(0);
  const [zonePick, setZonePick] = useState<string | null>(focusZone);
  const [allIn, setAllIn] = useState<number | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [totalMoved, setTotalMoved] = useState(false);
  /** Última cotización: «El total cambió» solo si cambia SIN tocar la selección. */
  const lastQuote = useRef<{ key: string; total: number } | null>(null);

  const focusedOffer = useMemo(() => {
    // Sin zona elegida no se resalta ninguna; con una sola zona no hay nada que elegir.
    if (!zonePick) return offers.length === 1 ? (offers[0] ?? null) : null;
    const needle = zonePick.toLowerCase();
    return (
      offers.find(
        (o) => o.zone.toLowerCase() === needle || (o.name && o.name.toLowerCase().includes(needle))
      ) ?? null
    );
  }, [zonePick, offers]);

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
    if (!focusedOffer || !zonePick) return false;
    if (seatsForFocusedOffer.length > 0) return false;
    const label = `${focusedOffer.zone} ${focusedOffer.name ?? ''}`.toLowerCase();
    return /\bga\b|general|pista/.test(label);
  }, [hasSeatMap, focusedOffer, zonePick, seatsForFocusedOffer.length]);

  useEffect(() => {
    if (!hasSeatMap) {
      setBuyMode('ga');
      return;
    }
    if (isGaOffer) setBuyMode('ga');
    else setBuyMode((m) => (m === 'ga' ? 'map' : m));
  }, [hasSeatMap, isGaOffer]);

  // La vista desde el asiento usa el mismo visor 3D: se carga al elegir butaca.
  const want3d = view3d || (buyMode === 'map' && selected.length > 0);

  useEffect(() => {
    if (!want3d || Venue3DViewer || viewer3dError) return;
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
  }, [want3d, Venue3DViewer, viewer3dError]);

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
        // Color de la zona, como en el plano 2D; el visor lo baja a tono sobrio.
        color: seat.sectionColor || '#17171A',
        price: offer ? Number(offer.basePrice) : undefined,
        levelId: seat.levelId,
        status: seat.visibility?.blocked
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

  const selectionKey =
    buyMode === 'map'
      ? selectedInfo.map((info) => `${info.offerId}:${info.seatId}`).join('|')
      : `${focusedOffer?.id ?? ''}:${qty}`;

  useEffect(() => {
    const items =
      buyMode === 'map'
        ? Array.from(
            selectedInfo.reduce((map, info) => {
              if (!info.offerId) return map;
              map.set(info.offerId, (map.get(info.offerId) ?? 0) + 1);
              return map;
            }, new Map<string, number>())
          ).map(([offerId, quantity]) => ({ offerId, quantity }))
        : focusedOffer
          ? [{ offerId: focusedOffer.id, quantity: qty }]
          : [];
    if (!items.length) {
      setAllIn(0);
      setPricingLoading(false);
      return;
    }
    const controller = new AbortController();
    setPricingLoading(true);
    fetchCartPricing(API, { eventId, items }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data) {
          setAllIn(null);
          return;
        }
        const next = pricingTotal(data);
        // Agregar o quitar una butaca cambia el total y no es una sorpresa: el
        // aviso es para el precio que se mueve con la MISMA selección (precio
        // dinámico). Antes saltaba al elegir la segunda butaca y no se quitaba.
        const previous = lastQuote.current;
        if (previous && previous.key === selectionKey) {
          if (Math.abs(previous.total - next) >= 0.01) setTotalMoved(true);
        } else {
          setTotalMoved(false);
        }
        lastQuote.current = { key: selectionKey, total: next };
        setAllIn(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });
    return () => controller.abort();
  }, [eventId, selectionKey, buyMode, focusedOffer, qty, selectedInfo]);

  function toggleSeat(seatId: string) {
    setSelected((prev) => {
      if (prev.includes(seatId)) return prev.filter((id) => id !== seatId);
      if (prev.length >= 8) return prev;
      return [...prev, seatId];
    });
  }

  function groupLines(infos: SelectedSeatInfo[], holdBySeat: Map<string, string>): CartOfferLine[] {
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
   *  · La identidad la EMITE Y FIRMA el servidor (`POST /inventory/session`).
   *    Antes la inventaba el navegador, asi que el tope por comprador se
   *    imponia sobre un valor que el comprador elegia y bastaba con cambiarlo
   *    en cada peticion para saltarselo.
   *  · Un 400 por `sessionId` (caducada o de una version anterior) se resuelve
   *    pidiendo otra al servidor y reintentando una vez, sin enseñar nada al
   *    comprador.
   *  · `queuePass` en todo hold cuando la sala nos admitió. En eventos sin sala
   *    el API lo ignora; en eventos con sala, su ausencia es un 403.
   */
  const postHold = useCallback(
    async (endpoint: string, body: Record<string, unknown>): Promise<HoldResponse> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const sessionId = attempt === 0 ? await ensureGuestSession() : await renewGuestSession();
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `JSON.stringify` descarta `undefined`: sin pase no se manda el campo.
            body: JSON.stringify({
              ...body,
              sessionId,
              queuePass: getQueuePass(),
              accessCode: accessCode.trim() || undefined,
            }),
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
    [getQueuePass, onQueueRejected, accessCode]
  );

  /** Un 409 no puede dejar al comprador mirando un spinner: se marca y se sigue. */
  function handleHoldFailure(raw: unknown) {
    const error = isInventoryError(raw) ? raw : describeNetworkError();
    setHoldError(error);
    if (error.kind === 'access-code') {
      setCodeOpen(true);
      // Tras pintar el campo, el foco va ahí para escribir sin buscarlo.
      requestAnimationFrame(() => codeInputRef.current?.focus());
    }
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
      const expiresAt = holdData.expiresAt ?? new Date(Date.now() + 900_000).toISOString();
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
        buyMode === 'ga' ? `${API}/inventory/holds` : `${API}/inventory/holds/best-available`;
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
            [s.section, s.row ? `Fila ${s.row}` : null, s.seatNumber].filter(Boolean).join(' · ')
        ) ??
        Array.from(
          { length: holds.length },
          (_, i) => `${focusedOffer.name || focusedOffer.zone} · ${i + 1}`
        );
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
      const expiresAt = holdData.expiresAt ?? new Date(Date.now() + 900_000).toISOString();
      goCheckout(lines, expiresAt);
    } catch (e) {
      handleHoldFailure(e);
    } finally {
      setLoading(false);
    }
  }

  void minPrice;
  void minPriceAllIn;
  const [moreOpen, setMoreOpen] = useState(false);
  const canPayMap = selected.length > 0 && buyMode === 'map';
  const canPayQty = (buyMode === 'best' || buyMode === 'ga') && qty > 0 && Boolean(focusedOffer);
  const canApart = buyMode === 'map' ? canPayMap : canPayQty;
  const offerPrice = (offer: Offer) => Number(offer.allInPrice ?? offer.basePrice);
  const cheapest = orderedOffers
    .filter((o) => o.isAvailable !== false && o.remainingQuantity !== 0)
    .reduce<Offer | null>((min, o) => (!min || offerPrice(o) < offerPrice(min) ? o : min), null);
  const summary =
    buyMode === 'map'
      ? selected.length
        ? `${selected.length} ${selected.length === 1 ? 'boleto' : 'boletos'} · ${selectedInfo
            .map((info) => (info.sectionName ? `${info.sectionName} ${info.label}` : info.label))
            .join(', ')}`
        : null
      : focusedOffer
        ? `${qty} ${qty === 1 ? 'boleto' : 'boletos'} · ${focusedOffer.name || focusedOffer.zone}`
        : null;
  const focusedRemaining = offers.find((o) => o.id === focusedOffer?.id)?.remainingQuantity;
  const tones = offerTones(orderedOffers);
  const payLabel = loading
    ? 'Apartando…'
    : buyMode === 'map' && selected.length === 0
      ? 'Elige tus asientos'
      : !focusedOffer && buyMode !== 'map'
        ? 'Elige una zona'
        : pricingLoading
          ? 'Calculando…'
          : 'Continuar';
  const apart = () => (buyMode === 'map' ? void checkoutMap() : void checkoutBestOrGa());
  const payDisabled = loading || pricingLoading || !canApart || allIn == null || allIn <= 0;
  const showSeatView = buyMode === 'map' && selected.length > 0;

  // --- puerta de la sala de espera -------------------------------------------
  // Todo lo de arriba son hooks y se ejecuta siempre; sólo el render se corta.
  if (room.phase === 'checking') {
    return (
      <div className={styles.buyBox} id="compra">
        <p className={styles.qtyMeta} role="status">
          Un momento…
        </p>
      </div>
    );
  }

  if (room.phase === 'queued' || room.phase === 'left') {
    return (
      <div className={styles.buyBox} id="compra">
        <WaitingRoomGate
          room={room}
          eventTitle={eventTitle}
          image={image}
          startsAt={startsAt}
          venueName={venueName}
          offers={offers}
        />
      </div>
    );
  }

  return (
    <div id="compra" className={styles.buyBody}>
      <div className={styles.filters}>
        <div className={styles.filtersInner}>
          {hasSeatMap && !isGaOffer ? (
            <div className={styles.segment} role="group" aria-label="Cómo elegir">
              <button
                type="button"
                aria-pressed={buyMode === 'map'}
                onClick={() => setBuyMode('map')}
              >
                En el mapa
              </button>
              <button
                type="button"
                aria-pressed={buyMode === 'best'}
                onClick={() => setBuyMode('best')}
              >
                Mejores lugares
              </button>
            </div>
          ) : null}

          {buyMode !== 'map' ? (
            <div className={styles.stepper} role="group" aria-label="Boletos">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Quitar un boleto"
                disabled={qty <= 1}
              >
                −
              </button>
              <span aria-live="polite">
                {qty} {qty === 1 ? 'boleto' : 'boletos'}
              </span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(8, q + 1))}
                aria-label="Agregar un boleto"
                disabled={qty >= 8}
              >
                +
              </button>
            </div>
          ) : null}

          <div className={styles.more}>
            <button
              type="button"
              className={styles.moreButton}
              aria-expanded={moreOpen}
              aria-controls="mas-filtros"
              onClick={() => setMoreOpen((v) => !v)}
            >
              Más filtros
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {moreOpen ? (
              <div className={styles.morePanel} id="mas-filtros">
                {hasSeatMap && !isGaOffer ? (
                  <button
                    type="button"
                    aria-pressed={buyMode === 'ga'}
                    onClick={() => {
                      setBuyMode('ga');
                      setMoreOpen(false);
                    }}
                  >
                    Acceso general
                  </button>
                ) : null}
                {cheapest && offers.length > 1 ? (
                  <button
                    type="button"
                    aria-pressed={Boolean(zonePick) && focusedOffer?.id === cheapest.id}
                    onClick={() => {
                      setZonePick(cheapest.zone);
                      setMoreOpen(false);
                    }}
                  >
                    Precio más bajo
                  </button>
                ) : null}
                {allowResale !== false ? <Link href="/resale">Reventa oficial</Link> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.mapCol}>
          {room.phase === 'admitted' && (
            <p className={styles.turn} role="status">
              Es tu turno.
            </p>
          )}

          <div className={styles.mapCard}>
            {buyMode === 'map' && !isGaOffer && hasSeatMap ? (
              <>
                {view3d ? (
                  <div className={styles.mapTools}>
                    <button
                      type="button"
                      className={styles.tool3d}
                      aria-label="Volver al plano"
                      onClick={() => setView3d(false)}
                    >
                      2D
                    </button>
                  </div>
                ) : null}
                {view3d ? (
                  Venue3DViewer ? (
                    <Venue3DViewer
                      mode="orbit"
                      height={560}
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
                    <p className={styles.loadingMap} role="status">
                      Cargando…
                    </p>
                  )
                ) : (
                  <SeatMapViewer
                    eventId={eventId}
                    mapData={normalized}
                    selected={selected}
                    offers={offers}
                    currency={currency}
                    focusZone={zonePick}
                    onToggle={toggleSeat}
                    onClear={() => setSelected([])}
                    conflictSeatIds={conflictSeatIds}
                    resyncToken={resyncToken}
                    compact
                    controls={
                      <button
                        type="button"
                        className={styles.tool3d}
                        aria-label="Vista 3D"
                        onClick={() => setView3d(true)}
                      >
                        3D
                      </button>
                    }
                  />
                )}
                {viewer3dError ? <p className={styles.muted}>{viewer3dError}</p> : null}
              </>
            ) : (
              <div className={styles.zoneHero}>
                <StageArt seed={focusedOffer?.id ?? eventId} className={styles.cover} />
                <div className={styles.zoneHeroCopy}>
                  <strong className={styles.zoneHeroTitle}>
                    {focusedOffer ? focusedOffer.name || focusedOffer.zone : 'Elige una zona'}
                  </strong>
                  {focusedRemaining != null && focusedRemaining <= 20 ? (
                    <span className={styles.muted}>Últimos lugares</span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {buyMode === 'map' && hasSeatMap && offers.length > 1 ? (
            <ul className={styles.zoneLegend} aria-label="Zonas">
              {orderedOffers.map((offer) => (
                <li key={offer.id}>
                  <i style={{ background: tones.get(offer.id) }} aria-hidden="true" />
                  {offer.name || offer.zone}
                </li>
              ))}
            </ul>
          ) : null}

          {showSeatView ? (
            <div className={styles.seatPanel}>
              <div className={styles.seatView}>
                {Venue3DViewer ? (
                  <Venue3DViewer
                    mode="seat"
                    chrome={false}
                    height={280}
                    currency={currency}
                    seats={seatsFor3d}
                    selectedIds={selected}
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
                  <StageArt seed={eventId} className={styles.cover} />
                )}
                <span className={styles.seatViewTag}>
                  Desde {selectedInfo[selectedInfo.length - 1]?.label ?? 'tu asiento'}
                </span>
              </div>
              <ul className={styles.seatChips} aria-label="Tus asientos">
                {selectedInfo.map((info) => (
                  <li key={info.seatId}>
                    <span>
                      {info.sectionName ? `${info.sectionName} · ` : ''}
                      {info.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Quitar ${info.label}`}
                      onClick={() => toggleSeat(info.seatId)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {holdError ? (
            <HoldErrorNotice
              error={holdError}
              onRetry={holdError.kind === 'hold-limit' ? undefined : apart}
              onChooseAgain={() => {
                setHoldError(null);
                setConflictSeatIds([]);
                setSelected([]);
                setZonePick(null);
              }}
              onDismiss={() => {
                setHoldError(null);
                setConflictSeatIds([]);
              }}
            />
          ) : null}
        </div>

        <aside className={styles.side} aria-label="Zonas y total">
          <h2 className={styles.sideTitle}>Zonas</h2>
          <ul className={styles.options}>
            {orderedOffers.map((offer) => {
              const active = Boolean(zonePick) && focusedOffer?.id === offer.id;
              const out = offer.isAvailable === false || offer.remainingQuantity === 0;
              const few = !out && offer.remainingQuantity != null && offer.remainingQuantity <= 20;
              return (
                <li key={offer.id}>
                  <button
                    type="button"
                    className={styles.option}
                    aria-pressed={active}
                    disabled={out}
                    onClick={() => setZonePick(offer.zone)}
                  >
                    <i
                      className={styles.toneDot}
                      style={{ background: tones.get(offer.id) }}
                      aria-hidden="true"
                    />
                    <span className={styles.optionCopy}>
                      <strong>{offer.name || offer.zone}</strong>
                      {out || few ? <span>{out ? 'Agotada' : 'Últimos lugares'}</span> : null}
                    </span>
                    <span className={styles.optionPrice}>
                      {formatTicketAmount(offerPrice(offer))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={styles.summary}>
            {summary ? <p className={styles.summaryLine}>{summary}</p> : null}
            {allIn != null && allIn > 0 ? (
              <div className={styles.summaryTotal}>
                <span>Total</span>
                <strong aria-live="polite">{formatTicketAmount(allIn)}</strong>
              </div>
            ) : null}
            {totalMoved ? (
              <p className={styles.warn} role="status">
                El precio cambió.
              </p>
            ) : null}
            {allIn == null && canApart && !pricingLoading ? (
              <p className={styles.warn} role="status">
                No pudimos calcular el total. Intenta de nuevo.
              </p>
            ) : null}
            {codeOpen ? (
              <label className={styles.codeField}>
                <span>Código de preventa</span>
                <input
                  ref={codeInputRef}
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                  placeholder="Ej. FANS2026"
                />
              </label>
            ) : (
              <button
                type="button"
                className={styles.codeToggle}
                onClick={() => {
                  setCodeOpen(true);
                  requestAnimationFrame(() => codeInputRef.current?.focus());
                }}
              >
                ¿Tienes código de preventa?
              </button>
            )}
            <button
              type="button"
              className={styles.payButton}
              disabled={payDisabled}
              onClick={apart}
            >
              {payLabel}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
