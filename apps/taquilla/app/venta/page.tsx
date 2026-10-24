'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiJson, getTaquillaToken } from '@/lib/auth';
import { PosSeatMap, type PosMapData } from '@/components/PosSeatMap';
import { PosShell } from '@/components/PosShell';
import { ManagerPinDialog } from '@/components/ManagerPinDialog';
import { enqueueSale } from '@/lib/offline-queue';
import { anyDigitPressed, digitPressed, fKeyPressed, type Hotkey } from '@/lib/hotkeys';
import {
  billLabel,
  changeBreakdownLabel,
  computeCash,
  money,
  quickCashOptions,
  round2,
} from '@/lib/cash';
import {
  clearSaleDraft,
  createBestAvailableHold,
  createPosHold,
  ensurePosSession,
  fetchReceipt,
  getCashierId,
  getSaleDraft,
  posCheckout,
  printReceipt,
  releasePosHolds,
  reserveLocalQuota,
  resolveOrgId,
  saveLastReceipt,
  saveSaleDraft,
  syncInventoryCache,
  type OfflinePosPayload,
  type PosReceipt,
} from '@/lib/pos';
import { Field, Money, TicketButton, formatTicketAmount } from '@boletera/ui';
import styles from './venta.module.scss';

type Offer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

type EventRow = {
  id: string;
  title: string;
  startsAt: string;
  venue?: { name: string };
  offers?: Offer[];
};

/**
 * Etapas del cobro. Una venta de 2 generales en efectivo pasa por
 * EVENT → TICKETS → TENDER → DONE sin tocar el ratón.
 */
type Stage = 'EVENT' | 'ZONE' | 'TICKETS' | 'TENDER' | 'DONE';

type PendingAuth = null | 'COMP' | 'DISCOUNT';

const QTY_TYPING_WINDOW_MS = 900;

function VentaFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const urlEventId = params.get('eventId') ?? '';
  const urlOfferId = params.get('offerId') ?? '';
  const compMode = params.get('comp') === '1';

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [eventId, setEventId] = useState(urlEventId);
  const [offerId, setOfferId] = useState(urlOfferId);
  const [stage, setStage] = useState<Stage>(urlEventId ? 'TICKETS' : 'EVENT');
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'COMP'>(compMode ? 'COMP' : 'CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [mapData, setMapData] = useState<PosMapData | null>(null);
  const [pickSeats, setPickSeats] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [holdIds, setHoldIds] = useState<string[]>([]);
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [ttlLeft, setTtlLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cardWaiting, setCardWaiting] = useState(false);
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth>(null);
  const [managerPin, setManagerPin] = useState('');
  const [compReason, setCompReason] = useState('house');
  const [promoCode, setPromoCode] = useState('');
  const [discountUnlocked, setDiscountUnlocked] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [offline, setOffline] = useState(false);
  const [quote, setQuote] = useState<{
    subtotal: number;
    fees: number;
    taxes: number;
    discount: number;
    total: number;
  } | null>(null);
  const [chargedLine, setChargedLine] = useState<string | null>(null);
  const [releaseAsk, setReleaseAsk] = useState(false);

  const holdRef = useRef<string[]>([]);
  const qtyBuffer = useRef({ value: '', at: 0 });
  const filterRef = useRef<HTMLInputElement>(null);
  const chargeRef = useRef<HTMLButtonElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  // --- sesión / red -------------------------------------------------------
  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  // --- catálogo -----------------------------------------------------------
  useEffect(() => {
    setEventsLoading(true);
    apiJson<EventRow[]>('/discovery/events')
      .then((data) => {
        const now = Date.now();
        const sorted = [...data].sort(
          (a, b) => +new Date(a.startsAt) - +new Date(b.startsAt),
        );
        // Primero lo que se vende hoy: un evento de dentro de tres meses no
        // debería robarle la tecla "1" al de esta noche.
        const soon = sorted.filter((e) => +new Date(e.startsAt) >= now - 12 * 3600 * 1000);
        setEvents(soon.length ? soon : sorted);
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, []);

  const event = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);

  const offers = useMemo(
    () => (event?.offers ?? []).filter((o) => o.isAvailable !== false),
    [event],
  );

  const offer = useMemo(
    () => offers.find((o) => o.id === offerId) ?? offers[0] ?? null,
    [offers, offerId],
  );

  // La zona la fija el catálogo, nunca la URL: el precio no puede venir de un
  // parámetro que el propio cajero puede editar en la barra de direcciones.
  useEffect(() => {
    if (!offers.length) return;
    if (!offers.some((o) => o.id === offerId)) setOfferId(offers[0].id);
  }, [offers, offerId]);

  useEffect(() => {
    if (!eventId) return;
    setMapData(null);
    apiJson<PosMapData>(`/inventory/${encodeURIComponent(eventId)}/map`)
      .then(setMapData)
      .catch(() => setMapData(null));
    void syncInventoryCache(eventId);
  }, [eventId]);

  const hasMap = Boolean(mapData?.sections?.length);
  const seatMode = hasMap && pickSeats;

  // --- holds --------------------------------------------------------------
  useEffect(() => {
    holdRef.current = holdIds;
  }, [holdIds]);

  useEffect(
    () => () => {
      if (holdRef.current.length) void releasePosHolds(holdRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!holdExpiresAt) {
      setTtlLeft(0);
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((holdExpiresAt - Date.now()) / 1000));
      setTtlLeft(left);
      if (left === 0) {
        setHoldIds([]);
        setHoldExpiresAt(null);
        showToast('La reserva expiró — vuelve a apartar los lugares');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt, showToast]);

  const releaseHolds = useCallback(async () => {
    const ids = holdRef.current;
    setHoldIds([]);
    setHoldExpiresAt(null);
    if (ids.length) await releasePosHolds(ids);
  }, []);

  // --- importes -----------------------------------------------------------
  const unitPrice = offer ? Number(offer.basePrice) : 0;
  const ticketCount = seatMode ? selectedSeats.length : qty;
  const estimate = round2(method === 'COMP' ? 0 : ticketCount * unitPrice);
  const inSale = stage === 'TICKETS' || stage === 'TENDER';
  const due = !inSale || method === 'COMP' ? 0 : round2(quote?.total ?? estimate);
  const cash = computeCash(due, cashReceived);
  const quickCash = useMemo(() => quickCashOptions(due), [due]);

  useEffect(() => {
    if (!inSale || !eventId || !offer || ticketCount < 1 || method === 'COMP') {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      apiJson<Record<string, unknown>>(
        '/pricing/calculate',
        {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            offerId: offer.id,
            quantity: ticketCount,
            ...(discountUnlocked && promoCode ? { promotionCode: promoCode } : {}),
          }),
        },
        { reauth: false },
      )
        .then((raw) => {
          if (cancelled) return;
          const num = (key: string) => {
            const value = Number(raw[key]);
            return Number.isFinite(value) ? value : 0;
          };
          const total = num('total');
          if (total <= 0 && num('subtotal') <= 0) {
            setQuote(null);
            return;
          }
          setQuote({
            subtotal: num('subtotal'),
            fees: num('fees'),
            taxes: num('taxes'),
            discount: num('discount'),
            total,
          });
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inSale, eventId, offer, ticketCount, method, discountUnlocked, promoCode]);

  // --- borrador -----------------------------------------------------------
  useEffect(() => {
    if (stage === 'DONE' || !eventId || !offerId) return;
    saveSaleDraft({
      eventId,
      eventTitle: event?.title,
      offerId,
      qty,
      seatIds: selectedSeats,
      method,
      cashReceived,
      stage,
      savedAt: new Date().toISOString(),
    });
  }, [stage, eventId, offerId, qty, selectedSeats, method, cashReceived, event?.title]);

  // Recupera una venta a medias tras un recargue accidental de la PWA.
  useEffect(() => {
    if (urlEventId) return;
    const draft = getSaleDraft();
    if (!draft) return;
    setEventId(draft.eventId);
    setOfferId(draft.offerId);
    setQty(draft.qty);
    setSelectedSeats(draft.seatIds ?? []);
    setMethod(draft.method);
    setCashReceived(draft.cashReceived ?? '');
    setStage(draft.stage === 'DONE' ? 'TICKETS' : (draft.stage as Stage));
    showToast('Venta recuperada del borrador local');
  }, [urlEventId, showToast]);

  // --- navegación entre etapas -------------------------------------------
  const goTickets = useCallback(() => {
    setStage('TICKETS');
    qtyBuffer.current = { value: '', at: 0 };
  }, []);

  const selectEvent = useCallback(
    (row: EventRow) => {
      setEventId(row.id);
      const list = (row.offers ?? []).filter((o) => o.isAvailable !== false);
      setOfferId(list[0]?.id ?? '');
      setSelectedSeats([]);
      void releaseHolds();
      // Con una sola zona no hay nada que elegir: un paso menos por venta.
      if (list.length > 1) setStage('ZONE');
      else goTickets();
    },
    [goTickets, releaseHolds],
  );

  const selectOffer = useCallback(
    (id: string) => {
      setOfferId(id);
      setSelectedSeats([]);
      void releaseHolds();
      goTickets();
    },
    [goTickets, releaseHolds],
  );

  const back = useCallback(() => {
    if (releaseAsk) {
      setReleaseAsk(false);
      return;
    }
    if ((stage === 'TICKETS' || stage === 'TENDER') && holdRef.current.length) {
      setReleaseAsk(true);
      return;
    }
    if (stage === 'TENDER') {
      setCashReceived('');
      goTickets();
      return;
    }
    if (stage === 'TICKETS') {
      if (offers.length > 1) setStage('ZONE');
      else setStage('EVENT');
      return;
    }
    if (stage === 'ZONE') {
      setStage('EVENT');
      return;
    }
    if (stage === 'DONE') {
      setStage('EVENT');
      return;
    }
    setFilter('');
    filterRef.current?.focus();
  }, [stage, offers.length, goTickets, releaseAsk]);

  const filteredEvents = useMemo(() => {
    if (!filter.trim()) return events.slice(0, 9);
    const needle = filter.trim().toLowerCase();
    return events
      .filter(
        (e) =>
          e.title.toLowerCase().includes(needle) ||
          (e.venue?.name ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 9);
  }, [events, filter]);

  // --- cobro --------------------------------------------------------------
  const reset = useCallback(
    (line?: string) => {
      clearSaleDraft();
      setStage('EVENT');
      setQty(1);
      setSelectedSeats([]);
      setCashReceived('');
    setReceipt(null);
      setManagerPin('');
      setPromoCode('');
      setDiscountUnlocked(false);
      setReleaseAsk(false);
      setMethod(compMode ? 'COMP' : 'CASH');
      setQuote(null);
      if (line) setChargedLine(line);
      qtyBuffer.current = { value: '', at: 0 };
      queueMicrotask(() => filterRef.current?.focus());
    },
    [compMode],
  );

  const sell = useCallback(async () => {
    if (loading) return;
    if (!eventId || !offer) {
      showToast('Selecciona evento y zona');
      return;
    }
    if (ticketCount < 1) {
      showToast('Indica la cantidad');
      return;
    }
    if (method === 'CASH' && !cash.sufficient) {
      showToast(`Faltan ${money(cash.missing)}`);
      return;
    }
    if (method === 'COMP' && !managerPin) {
      setPendingAuth('COMP');
      return;
    }

    setLoading(true);
    if (method === 'CARD') setCardWaiting(true);
    const clientSaleId = crypto.randomUUID();

    try {
      const { terminalId, sessionId } = await ensurePosSession(resolveOrgId(), getCashierId());

      let holds = holdRef.current;
      if (seatMode && !holds.length && selectedSeats.length) {
        const hold = await createPosHold({
          sessionId,
          eventId,
          offerId: offer.id,
          seatIds: selectedSeats,
        });
        holds = hold.holdIds;
        setHoldIds(holds);
        setHoldExpiresAt(new Date(hold.expiresAt).getTime());
      }

      if (method === 'CARD') {
        // Hueco del pinpad: el flujo real lo cierra el integrador de Banorte.
        await new Promise((r) => setTimeout(r, 800));
      }

      const result = await posCheckout({
        terminalId,
        sessionId,
        eventId,
        offerId: offer.id,
        quantity: seatMode ? undefined : qty,
        seatIds: seatMode ? selectedSeats : undefined,
        holdIds: holds.length ? holds : undefined,
        paymentMethod: method,
        cashierId: getCashierId(),
        buyerName: buyerName.trim() || undefined,
        buyerEmail: buyerEmail.trim() || undefined,
        buyerPhone: buyerPhone.trim() || undefined,
        isComp: method === 'COMP',
        compReason: method === 'COMP' ? compReason : undefined,
        managerPin: method === 'COMP' ? managerPin : undefined,
        discountCode: discountUnlocked && promoCode ? promoCode : undefined,
        clientSaleId,
      });

      setHoldIds([]);
      setHoldExpiresAt(null);
      const realTotal = round2(Number(result.total));
      const finalCash = computeCash(realTotal, cashReceived);
      const rec = await fetchReceipt(result.orderId, terminalId).catch(() => null);
      if (rec) {
        const enriched: PosReceipt =
          method === 'CASH'
            ? { ...rec, cashReceived: finalCash.received, changeGiven: finalCash.change }
            : rec;
        setReceipt(enriched);
        saveLastReceipt(enriched);
        void printReceipt(enriched);
      }
      const folio = rec?.receiptNumber || result.publicId;
      const change = method === 'CASH' ? finalCash.change : 0;
      reset(folio ? `Cobrado · ${folio}` : 'Cobrado');
      if (change > 0) showToast(`Cambio ${money(change)}`);
      else if (Math.abs(realTotal - due) > 0.009 && method === 'CASH') {
        showToast(`El total final fue ${money(realTotal)}. Revisa el cambio.`);
      }
    } catch (err) {
      if (!navigator.onLine) {
        const needed = seatMode ? selectedSeats.length : qty;
        if (!reserveLocalQuota(eventId, needed || 1)) {
          showToast('Sin cupo local para vender sin red — sincroniza inventario');
          return;
        }
        try {
          const { terminalId, sessionId } = await ensurePosSession(
            resolveOrgId(),
            getCashierId(),
          );
          const payload: OfflinePosPayload = {
            type: 'pos',
            terminalId,
            sessionId,
            clientSaleId,
            checkoutData: {
              eventId,
              offerId: offer.id,
              quantity: seatMode ? undefined : qty,
              seatIds: seatMode ? selectedSeats : undefined,
              // Una cortesía sin red no se puede autorizar: se registra como
              // efectivo a 0 y queda para revisión al sincronizar.
              paymentMethod: method === 'COMP' ? 'CASH' : method,
              cashierId: getCashierId(),
              buyerName: buyerName.trim() || undefined,
              buyerEmail: buyerEmail.trim() || undefined,
              clientSaleId,
            },
          };
          await enqueueSale(payload);
          clearSaleDraft();
          showToast('No se guardó en el servidor. Quedó en la cola.');
          reset('En cola');
        } catch {
          showToast('No se pudo registrar la venta ni en local');
        }
      } else {
        showToast(err instanceof Error ? err.message : 'No se pudo cobrar');
      }
    } finally {
      setLoading(false);
      setCardWaiting(false);
    }
  }, [
    loading,
    eventId,
    offer,
    ticketCount,
    method,
    cash.sufficient,
    cash.missing,
    managerPin,
    seatMode,
    selectedSeats,
    qty,
    buyerName,
    buyerEmail,
    buyerPhone,
    compReason,
    discountUnlocked,
    promoCode,
    cashReceived,
    due,
    showToast,
    reset,
  ]);

  // --- teclado ------------------------------------------------------------
  const pushQtyDigit = useCallback((digit: number) => {
    const now = Date.now();
    const prev = now - qtyBuffer.current.at < QTY_TYPING_WINDOW_MS ? qtyBuffer.current.value : '';
    const next = `${prev}${digit}`.replace(/^0+/, '').slice(0, 3);
    qtyBuffer.current = { value: next, at: now };
    setQty(Math.min(999, Math.max(1, Number(next) || 1)));
  }, []);

  const pushCashDigit = useCallback((digit: number) => {
    setCashReceived((v) => (v === '0' ? String(digit) : `${v}${digit}`).slice(0, 9));
  }, []);

  const releaseLast = useCallback(async () => {
    const ids = holdRef.current;
    const last = ids[ids.length - 1];
    setReleaseAsk(false);
    if (!last) return;
    await releasePosHolds([last]);
    setHoldIds(ids.slice(0, -1));
    if (ids.length === 1) setHoldExpiresAt(null);
  }, []);

  const hotkeys = useMemo<Hotkey[]>(() => {
    if (pendingAuth) return [];
    if (releaseAsk) {
      return [
        {
          keys: 'Enter',
          label: 'Soltar apartado',
          whileTyping: true,
          match: (e) => e.key === 'Enter',
          run: () => void releaseLast(),
        },
        {
          keys: 'Esc',
          label: 'Cobrar',
          whileTyping: true,
          match: (e) => e.key === 'Escape',
          run: () => setReleaseAsk(false),
        },
      ];
    }
    if (stage === 'EVENT') {
      return [
        {
          keys: '1-9',
          label: 'Elegir evento',
          // Con el filtro vacío los números eligen; en cuanto se escribe algo,
          // los números vuelven a ser texto (hay eventos con año en el título).
          whileTyping: true,
          match: (e) => !filter.trim() && digitPressed(e) != null && filteredEvents.length > 0,
          run: (e) => {
            const n = digitPressed(e);
            const row = n ? filteredEvents[n - 1] : undefined;
            if (row) selectEvent(row);
          },
        },
        { keys: 'Texto', label: 'Filtrar', displayOnly: true },
        {
          keys: 'Enter',
          label: 'Elegir el primero',
          whileTyping: true,
          match: (e) => e.key === 'Enter',
          run: () => filteredEvents[0] && selectEvent(filteredEvents[0]),
        },
        {
          keys: '/',
          label: 'Buscar',
          whileTyping: true,
          match: (e) => e.key === '/' && !e.metaKey && !e.ctrlKey,
          run: () => filterRef.current?.focus(),
        },
        {
          keys: 'Esc',
          label: 'Soltar',
          whileTyping: true,
          match: (e) => e.key === 'Escape',
          run: back,
        },
      ];
    }
    if (stage === 'ZONE') {
      return [
        {
          keys: '1-9',
          label: 'Elegir zona',
          whileTyping: true,
          match: (e) => digitPressed(e) != null,
          run: (e) => {
            const n = digitPressed(e);
            const target = n ? offers[n - 1] : undefined;
            if (target) selectOffer(target.id);
          },
        },
        {
          keys: 'Enter',
          label: 'Primera zona',
          whileTyping: true,
          match: (e) => e.key === 'Enter',
          run: () => offers[0] && selectOffer(offers[0].id),
        },
        { keys: 'Esc', label: 'Volver', whileTyping: true, match: (e) => e.key === 'Escape', run: back },
      ];
    }
    if (stage === 'TICKETS') {
      return [
        {
          keys: '0-9',
          label: 'Cantidad',
          match: (e) => anyDigitPressed(e) != null && !seatMode,
          run: (e) => {
            const d = anyDigitPressed(e);
            if (d != null) pushQtyDigit(d);
          },
        },
        {
          keys: '+ / -',
          label: 'Ajustar',
          whileTyping: true,
          match: (e) => e.key === '+' || e.key === '-',
          run: (e) => setQty((q) => Math.max(1, Math.min(999, q + (e.key === '+' ? 1 : -1)))),
        },
        {
          keys: 'Enter',
          label: 'Cobrar',
          whileTyping: true,
          match: (e) => e.key === 'Enter',
          run: () => {
            if (ticketCount < 1) {
              showToast('Indica la cantidad');
              return;
            }
            setStage('TENDER');
            queueMicrotask(() => chargeRef.current?.focus());
          },
        },
        ...(hasMap
          ? [
              {
                keys: 'M',
                label: pickSeats ? 'Mejor disponible' : 'Elegir en mapa',
                match: (e: KeyboardEvent) => e.key.toLowerCase() === 'm',
                run: () => {
                  setPickSeats((v) => !v);
                  setSelectedSeats([]);
                  void releaseHolds();
                },
              } satisfies Hotkey,
            ]
          : []),
        { keys: 'Esc', label: 'Volver', whileTyping: true, match: (e) => e.key === 'Escape', run: back },
      ];
    }
    if (stage === 'TENDER') {
      return [
        {
          keys: 'E',
          label: 'Efectivo',
          match: (e) => e.key.toLowerCase() === 'e',
          run: () => setMethod('CASH'),
        },
        {
          keys: 'T',
          label: 'Tarjeta',
          match: (e) => e.key.toLowerCase() === 't',
          run: () => setMethod('CARD'),
        },
        {
          keys: 'C',
          label: 'Cortesía',
          match: (e) => e.key.toLowerCase() === 'c',
          run: () => {
            setMethod('COMP');
            setPendingAuth('COMP');
          },
        },
        {
          keys: 'F1-F6',
          label: 'Billete rápido',
          whileTyping: true,
          match: (e) => {
            const n = fKeyPressed(e);
            return method === 'CASH' && n != null && n <= quickCash.length;
          },
          run: (e) => {
            const n = fKeyPressed(e);
            if (n) setCashReceived(String(quickCash[n - 1]));
          },
        },
        // Sin `whileTyping`: si el foco está en un campo de texto (nombre,
        // email, código de descuento) los dígitos deben escribirse ahí, no
        // sumarse al efectivo recibido.
        {
          keys: '0-9',
          label: 'Recibido',
          match: (e) => method === 'CASH' && anyDigitPressed(e) != null,
          run: (e) => {
            const d = anyDigitPressed(e);
            if (d != null) pushCashDigit(d);
          },
        },
        {
          keys: '⌫',
          label: 'Borrar',
          hidden: true,
          match: (e) => method === 'CASH' && e.key === 'Backspace',
          run: () => setCashReceived((v) => v.slice(0, -1)),
        },
        {
          keys: 'Enter',
          label: 'Cobrar e imprimir',
          whileTyping: true,
          match: (e) => e.key === 'Enter',
          run: () => void sell(),
        },
        {
          keys: 'D',
          label: 'Descuento (PIN)',
          hidden: discountUnlocked,
          match: (e) => e.key.toLowerCase() === 'd' && !discountUnlocked,
          run: () => setPendingAuth('DISCOUNT'),
        },
        {
          keys: 'Esc',
          label: 'Volver',
          whileTyping: true,
          match: (e) => e.key === 'Escape',
          run: () => {
            if (cardWaiting) {
              setCardWaiting(false);
              setLoading(false);
              showToast('Pago con tarjeta cancelado');
              return;
            }
            back();
          },
        },
      ];
    }
    return [
      {
        keys: 'Enter',
        label: 'Nueva venta',
        whileTyping: true,
        match: (e) => e.key === 'Enter' || e.key.toLowerCase() === 'n',
        run: () => reset(),
      },
      {
        keys: 'P',
        label: 'Reimprimir',
        match: (e) => e.key.toLowerCase() === 'p',
        run: () => receipt && void printReceipt(receipt),
      },
      {
        keys: 'Esc',
        label: 'Inicio',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/'),
      },
    ];
  }, [
    pendingAuth,
    releaseAsk,
    releaseLast,
    stage,
    filter,
    filteredEvents,
    offers,
    seatMode,
    hasMap,
    pickSeats,
    ticketCount,
    method,
    quickCash,
    cardWaiting,
    discountUnlocked,
    receipt,
    selectEvent,
    selectOffer,
    pushQtyDigit,
    pushCashDigit,
    releaseHolds,
    sell,
    back,
    reset,
    router,
    showToast,
  ]);

  useEffect(() => {
    if (stage === 'EVENT') filterRef.current?.focus();
  }, [stage]);

  async function reserveSelection() {
    if (!offer || !selectedSeats.length) return;
    try {
      const { sessionId } = await ensurePosSession(resolveOrgId(), getCashierId());
      const hold = await createPosHold({
        sessionId,
        eventId,
        offerId: offer.id,
        seatIds: selectedSeats,
      });
      setHoldIds(hold.holdIds);
      setHoldExpiresAt(new Date(hold.expiresAt).getTime());
      showToast(`${hold.holdIds.length} lugares apartados`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudieron apartar');
    }
  }

  async function holdBestAvailable() {
    if (!offer) return;
    try {
      const { sessionId } = await ensurePosSession(resolveOrgId(), getCashierId());
      const hold = await createBestAvailableHold({
        sessionId,
        eventId,
        offerId: offer.id,
        quantity: qty,
        contiguous: true,
      });
      setHoldIds(hold.holdIds);
      setHoldExpiresAt(new Date(hold.expiresAt).getTime());
      showToast(`${hold.holdIds.length} lugares juntos apartados`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sin lugares juntos disponibles');
    }
  }

  const feePct =
    quote && quote.subtotal > 0 ? Math.round((quote.fees / quote.subtotal) * 100) : null;
  const taxPct =
    quote && quote.subtotal > 0 ? Math.round((quote.taxes / quote.subtotal) * 100) : null;
  const canCharge =
    inSale &&
    ticketCount >= 1 &&
    !loading &&
    (method !== 'CASH' || cash.sufficient) &&
    (method !== 'COMP' || Boolean(managerPin));
  const functionLine = event
    ? `${new Date(event.startsAt).toLocaleString('es-MX', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })} · ${event.title}${event.venue?.name ? ` · ${event.venue.name}` : ''}`
    : null;

  return (
    <PosShell
      title={stage === 'ZONE' ? 'Zona' : stage === 'EVENT' || stage === 'DONE' ? 'Función' : 'Venta'}
      eyebrow={functionLine && stage !== 'EVENT' && stage !== 'DONE' ? functionLine : undefined}
      backHref="/venta"
      hotkeys={hotkeys}
      escapeGoesBack={false}
      hotkeysEnabled={!pendingAuth}
      size="wide"
    >
      {toast ? (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      ) : null}
      {offline ? (
        <p className={styles.note} role="status">
          Sin red. La venta queda en cola y el folio dirá «En cola».
        </p>
      ) : null}

      <div className={styles.counter}>
        <div className={styles.main}>
          {chargedLine && (stage === 'EVENT' || stage === 'DONE') ? (
            <p className={styles.folio}>{chargedLine}</p>
          ) : null}

          {(stage === 'EVENT' || stage === 'DONE') && (
            <section>
              <Field
                ref={filterRef}
                kind="search"
                label="Función"
                hint="Nombre o recinto"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {eventsLoading ? (
                <p className={styles.note}>Cargando funciones.</p>
              ) : filteredEvents.length === 0 ? (
                <p className={styles.note}>
                  {filter.trim() ? 'Nada con ese criterio.' : 'No hay funciones publicadas.'}
                </p>
              ) : (
                <ul className={styles.list}>
                  {filteredEvents.map((row, i) => {
                    const price = Number(row.offers?.[0]?.basePrice ?? 0);
                    const when = new Date(row.startsAt);
                    return (
                      <li key={row.id}>
                        <button type="button" className={styles.row} onClick={() => selectEvent(row)}>
                          <span className={styles.when}>
                            {when.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={styles.rowMain}>
                            <strong>{row.title}</strong>
                            <small>{row.venue?.name ?? 'Sin recinto'}</small>
                          </span>
                          <span className={styles.rowPrice}>
                            {price > 0 ? `Desde ${formatTicketAmount(price)}` : '—'}
                          </span>
                          <kbd>{i + 1}</kbd>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {stage === 'ZONE' && (
            <section>
              {offers.length === 0 ? (
                <p className={styles.note}>Esta función no tiene cupo de taquilla.</p>
              ) : (
                <ul className={offers.length <= 5 ? styles.segment : styles.list}>
                  {offers.map((o, i) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className={o.id === offerId ? styles.rowOn : styles.row}
                        disabled={o.isAvailable === false}
                        onClick={() => selectOffer(o.id)}
                      >
                        <span className={styles.rowMain}>
                          <strong>
                            {o.name || o.zone || 'General'} · {formatTicketAmount(Number(o.basePrice))}
                          </strong>
                          <small>
                            {o.remainingQuantity != null ? `${o.remainingQuantity} libres` : 'En venta'}
                          </small>
                        </span>
                        <kbd>{i + 1}</kbd>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(stage === 'TICKETS' || stage === 'TENDER') && (
            <section className={styles.sale}>
              <p className={styles.zoneLine}>
                {offer ? `${offer.name || offer.zone || 'General'} · ${formatTicketAmount(unitPrice)}` : 'Sin zona'}
                {offer?.remainingQuantity != null ? ` · ${offer.remainingQuantity} libres` : ''}
              </p>

              {!seatMode ? (
                <div className={styles.qty}>
                  <span className={styles.qtyLabel}>Cantidad</span>
                  <div className={styles.qtyRow}>
                    <button type="button" className={styles.step} onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">
                      −
                    </button>
                    <strong>{qty}</strong>
                    <button type="button" className={styles.step} onClick={() => setQty((q) => Math.min(999, q + 1))} aria-label="Más">
                      +
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.mapPane}>
                  {holdExpiresAt && ttlLeft > 0 ? (
                    <p className={styles.note}>
                      {holdIds.length} apartados · {Math.floor(ttlLeft / 60)}:
                      {String(ttlLeft % 60).padStart(2, '0')}
                    </p>
                  ) : null}
                  <PosSeatMap
                    eventId={eventId}
                    mapData={mapData}
                    selected={selectedSeats}
                    onToggle={(id) => {
                      setSelectedSeats((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      );
                      void releaseHolds();
                    }}
                    offers={offers.map((o) => ({
                      id: o.id,
                      zone: o.zone || '',
                      name: o.name,
                      basePrice: o.basePrice,
                    }))}
                  />
                </div>
              )}

              {hasMap ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setPickSeats((v) => !v);
                    setSelectedSeats([]);
                    void releaseHolds();
                  }}
                >
                  {pickSeats ? 'Cantidad' : 'Plano'}
                </button>
              ) : null}
              {hasMap && !pickSeats ? (
                <button type="button" className={styles.secondary} onClick={() => void holdBestAvailable()}>
                  Mejor disponible
                </button>
              ) : null}
              {seatMode && selectedSeats.length > 0 ? (
                <button type="button" className={styles.secondary} onClick={() => void reserveSelection()}>
                  Apartar {selectedSeats.length}
                </button>
              ) : null}

              <button type="button" className={styles.disclosure} onClick={() => setBuyerOpen((v) => !v)}>
                Nombre en el boleto
                {buyerName ? <small>{buyerName}</small> : null}
              </button>
              {buyerOpen ? (
                <div className={styles.buyer}>
                  <Field label="Nombre" hint="Nombre en el boleto" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                  <Field label="Correo" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
                  <Field
                    label="Teléfono"
                    inputMode="tel"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              ) : null}
            </section>
          )}
        </div>

        <aside className={styles.charge}>
          <div className={styles.chargeBody}>
            {method === 'COMP' ? <p className={styles.note}>Cortesía</p> : null}
            <div className={styles.methods} role="group" aria-label="Método">
              {(
                [
                  { id: 'CASH' as const, label: 'Efectivo', hot: 'E' },
                  { id: 'CARD' as const, label: 'Tarjeta', hot: 'T' },
                ]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={method === m.id ? styles.methodOn : styles.method}
                  onClick={() => setMethod(m.id)}
                >
                  {m.label}
                  <kbd>{m.hot}</kbd>
                </button>
              ))}
            </div>

            {method === 'CASH' && inSale ? (
              <>
                <Field
                  label="Recibido"
                  kind="money"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value.replace(/[^\d.]/g, ''))}
                />
                <ul className={styles.bills}>
                  {quickCash.map((amount, i) => (
                    <li key={`${amount}-${i}`}>
                      <button
                        type="button"
                        className={styles.bill}
                        onClick={() => setCashReceived(String(amount))}
                      >
                        {amount === due ? 'Exacto' : billLabel(amount)}
                        <kbd>F{i + 1}</kbd>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className={styles.change}>
                  {cash.sufficient
                    ? `Cambio ${formatTicketAmount(cash.change)}${cash.change > 0 ? ` · ${changeBreakdownLabel(cash.change)}` : ''}`
                    : `Faltan ${formatTicketAmount(cash.missing)}`}
                </p>
              </>
            ) : null}

            {method === 'CARD' && inSale ? (
              <p className={styles.note}>{cardWaiting ? 'Esperando terminal' : 'Tarjeta'}</p>
            ) : null}

            {method === 'COMP' && inSale ? (
              <Field label="Motivo" value={compReason} onChange={(e) => setCompReason(e.target.value)} />
            ) : null}

            {discountUnlocked ? (
              <Field
                label="Código"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              />
            ) : null}

            <Money
              label="A cobrar"
              amount={due}
              currency
              defaultOpen
              lines={[
                { label: 'Precio', amount: inSale ? (quote?.subtotal ?? (method === 'COMP' ? 0 : estimate)) : 0 },
                { label: feePct != null ? `Cargo · ${feePct}%` : 'Cargo', amount: inSale ? (quote?.fees ?? 0) : 0 },
                { label: taxPct != null ? `IVA · ${taxPct}%` : 'IVA', amount: inSale ? (quote?.taxes ?? 0) : 0 },
                { label: 'Descuento', amount: inSale && quote?.discount ? -quote.discount : 0 },
              ]}
            />
            {releaseAsk ? <p className={styles.note}>Soltar el último apartado</p> : null}
          </div>
          <TicketButton
            ref={chargeRef}
            fullWidth
            disabled={releaseAsk ? false : !canCharge}
            onClick={() => {
              if (releaseAsk) void releaseLast();
              else void sell();
            }}
          >
            {releaseAsk ? 'Soltar apartado' : `Cobrar ${formatTicketAmount(due)}`}
          </TicketButton>
        </aside>
      </div>

      {cardWaiting ? (
        <p className={styles.note} role="status">
          Esperando terminal. Esc cancela el cobro con tarjeta.
        </p>
      ) : null}

      <ManagerPinDialog
        open={pendingAuth === 'COMP'}
        title="PIN de gerente"
        detail="Cortesía. El motivo queda en el turno."
        confirmLabel="Autorizar"
        onCancel={() => {
          setPendingAuth(null);
          if (!managerPin) setMethod('CASH');
        }}
        onConfirm={(pin) => {
          setManagerPin(pin);
          setPendingAuth(null);
          showToast('Autorizada');
        }}
      />

      <ManagerPinDialog
        open={pendingAuth === 'DISCOUNT'}
        title="PIN de gerente"
        detail="El código se aplica al cobrar."
        confirmLabel="Autorizar"
        onCancel={() => setPendingAuth(null)}
        onConfirm={() => {
          setDiscountUnlocked(true);
          setPendingAuth(null);
        }}
      />
    </PosShell>
  );
}

export default function VentaPage() {
  return (
    <Suspense>
      <VentaFlow />
    </Suspense>
  );
}
