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
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  KpiCard,
  SkeletonCard,
} from '@boletera/ui';
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

type SaleStep = 'evento' | 'boletos' | 'pago' | 'ticket';

type PendingAuth = null | 'COMP' | 'DISCOUNT';

const SALE_STEPS: Array<{ id: SaleStep; label: string }> = [
  { id: 'evento', label: 'Evento' },
  { id: 'boletos', label: 'Boletos' },
  { id: 'pago', label: 'Pago' },
  { id: 'ticket', label: 'Ticket' },
];

function stageToSaleStep(stage: Stage): SaleStep {
  if (stage === 'EVENT' || stage === 'ZONE') return 'evento';
  if (stage === 'TICKETS') return 'boletos';
  if (stage === 'TENDER') return 'pago';
  return 'ticket';
}

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
  const [chargedTotal, setChargedTotal] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth>(null);
  const [managerPin, setManagerPin] = useState('');
  const [compReason, setCompReason] = useState('house');
  const [promoCode, setPromoCode] = useState('');
  const [discountUnlocked, setDiscountUnlocked] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [offline, setOffline] = useState(false);

  const holdRef = useRef<string[]>([]);
  const qtyBuffer = useRef({ value: '', at: 0 });
  const filterRef = useRef<HTMLInputElement>(null);

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
  const cash = computeCash(estimate, cashReceived);
  const quickCash = useMemo(() => quickCashOptions(estimate), [estimate]);

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
      router.push('/');
      return;
    }
    router.push('/');
  }, [stage, offers.length, goTickets, router]);

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
  const reset = useCallback(() => {
    clearSaleDraft();
    setStage(urlEventId ? 'TICKETS' : 'EVENT');
    setQty(1);
    setSelectedSeats([]);
    setCashReceived('');
    setReceipt(null);
    setChargedTotal(null);
    setManagerPin('');
    setPromoCode('');
    setDiscountUnlocked(false);
    setMethod(compMode ? 'COMP' : 'CASH');
    qtyBuffer.current = { value: '', at: 0 };
  }, [urlEventId, compMode]);

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
        isComp: method === 'COMP',
        compReason: method === 'COMP' ? compReason : undefined,
        managerPin: method === 'COMP' ? managerPin : undefined,
        discountCode: discountUnlocked && promoCode ? promoCode : undefined,
        clientSaleId,
      });

      setHoldIds([]);
      setHoldExpiresAt(null);
      const realTotal = round2(Number(result.total));
      setChargedTotal(realTotal);

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
      clearSaleDraft();
      setStage('DONE');
      if (Math.abs(realTotal - estimate) > 0.009 && method === 'CASH') {
        showToast(`El total final fue ${money(realTotal)} (cargos incluidos) — revisa el cambio`);
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
          showToast('Sin red: venta guardada en la cola local');
          reset();
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
    compReason,
    discountUnlocked,
    promoCode,
    cashReceived,
    estimate,
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

  const hotkeys = useMemo<Hotkey[]>(() => {
    if (pendingAuth) return [];
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
          keys: 'Esc',
          label: 'Salir',
          whileTyping: true,
          match: (e) => e.key === 'Escape',
          run: () => router.push('/'),
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
          label: 'Ir a cobro',
          whileTyping: true,
          match: (e) => e.key === 'Enter',
          run: () => {
            if (ticketCount < 1) {
              showToast('Selecciona al menos un lugar');
              return;
            }
            setStage('TENDER');
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
        run: reset,
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

  const stageTitles: Record<Stage, string> = {
    EVENT: 'Elige evento',
    ZONE: 'Elige zona',
    TICKETS: 'Cantidad',
    TENDER: 'Cobro',
    DONE: 'Venta completada',
  };

  const saleStep = stageToSaleStep(stage);
  const saleStepIndex = SALE_STEPS.findIndex((s) => s.id === saleStep);

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

  return (
    <PosShell
      title={stage === 'DONE' ? 'Venta completada' : event?.title || stageTitles[stage]}
      eyebrow={`Venta · ${stageTitles[stage]}`}
      backHref="/"
      hotkeys={hotkeys}
      escapeGoesBack={false}
      hotkeysEnabled={!pendingAuth}
      size={stage === 'TICKETS' && seatMode ? 'wide' : 'md'}
    >
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      {offline && (
        <p className={styles.offlineBanner} role="status">
          <strong>Sin red.</strong> La venta se guardará en la cola local y se enviará al volver la
          conexión. El cupo se descuenta del último inventario sincronizado.
        </p>
      )}

      {stage !== 'DONE' && (
        <nav className={styles.stepper} aria-label="Progreso de la venta">
          <ol className={styles.steps}>
            {SALE_STEPS.map((s, i) => {
              const done = i < saleStepIndex;
              const active = i === saleStepIndex;
              return (
                <li
                  key={s.id}
                  className={
                    active ? styles.stepOn : done ? styles.stepDone : styles.step
                  }
                  aria-current={active ? 'step' : undefined}
                >
                  <span className={styles.stepMarker} aria-hidden="true">
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={styles.stepLabel}>{s.label}</span>
                  {i < SALE_STEPS.length - 1 ? (
                    <span className={styles.stepConnector} aria-hidden="true" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {holdExpiresAt && ttlLeft > 0 && (
        <div className={styles.holdBanner} role="status">
          <Badge tone="warning" variant="soft" dot>
            Apartado · {Math.floor(ttlLeft / 60)}:{String(ttlLeft % 60).padStart(2, '0')}
          </Badge>
          <Button type="button" variant="outline" size="sm" onClick={() => void releaseHolds()}>
            Liberar
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {stage === 'EVENT' && (
        <section className={styles.panel}>
          <Input
            ref={filterRef}
            type="search"
            label="Buscar evento"
            placeholder="Escribe para filtrar…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            inputSize="lg"
            className={styles.filterInput}
          />
          {eventsLoading ? (
            <ul className={styles.pickList} aria-busy="true" aria-label="Cargando eventos">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i}>
                  <SkeletonCard lines={2} className={styles.skeletonRow} />
                </li>
              ))}
            </ul>
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              illustration={filter.trim() ? 'search' : 'seats'}
              title={filter.trim() ? 'Sin coincidencias' : 'Sin eventos en venta'}
              description={
                filter.trim()
                  ? 'Prueba otro título, recinto o fecha.'
                  : 'No hay funciones programadas en este momento.'
              }
              size="md"
              className={styles.emptyState}
            />
          ) : (
            <ul className={styles.pickList}>
              {filteredEvents.map((row, i) => {
                const price = Number(row.offers?.[0]?.basePrice ?? 0);
                return (
                  <li key={row.id}>
                    <button type="button" className={styles.pickBtn} onClick={() => selectEvent(row)}>
                      <kbd>{i + 1}</kbd>
                      <span className={styles.pickMain}>
                        <strong>{row.title}</strong>
                        <small>
                          {row.venue?.name ?? 'Sin recinto'} ·{' '}
                          {new Date(row.startsAt).toLocaleString('es-MX', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </span>
                      <Badge tone="accent" variant="soft" className={styles.priceBadge}>
                        {price > 0 ? `desde ${money(price)}` : '—'}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {stage === 'ZONE' && (
        <section className={styles.panel}>
          {offers.length === 0 ? (
            <EmptyState
              illustration="seats"
              title="Sin zonas disponibles"
              description="Este evento no tiene ofertas activas en este momento."
              size="md"
              className={styles.emptyState}
            />
          ) : (
            <ul className={styles.offerGrid}>
              {offers.map((o, i) => {
                const lowStock = o.remainingQuantity != null && o.remainingQuantity < 25;
                return (
                  <li key={o.id}>
                    <button type="button" className={styles.offerCard} onClick={() => selectOffer(o.id)}>
                      <span className={styles.offerHotkey}>
                        <kbd>{i + 1}</kbd>
                      </span>
                      {o.remainingQuantity != null ? (
                        <Badge
                          tone={lowStock ? 'warning' : 'success'}
                          variant="soft"
                          className={styles.qtyBadge}
                        >
                          {o.remainingQuantity} disp.
                        </Badge>
                      ) : null}
                      <strong className={styles.offerName}>{o.name || o.zone || 'General'}</strong>
                      <span className={styles.offerPrice}>{money(Number(o.basePrice))}</span>
                      <span className={styles.offerHint}>por boleto</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {stage === 'TICKETS' && (
        <section className={seatMode ? styles.seatLayout : styles.panel}>
          <div className={styles.qtyPane}>
            <Card variant="outline" padding="md" className={styles.zoneCard}>
              <p className={styles.zoneLine}>
                {offer ? (
                  <>
                    <Badge tone="accent" variant="soft">{offer.name || offer.zone || 'General'}</Badge>
                    <span>{money(unitPrice)} c/u</span>
                  </>
                ) : (
                  'Sin zona'
                )}
              </p>
            </Card>

            {!seatMode ? (
              <>
                <div className={styles.qtyBig}>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className={styles.qtyBtn}
                    aria-label="Menos"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                  >
                    −
                  </Button>
                  <strong className={styles.qtyValue}>{qty}</strong>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className={styles.qtyBtn}
                    aria-label="Más"
                    onClick={() => setQty((q) => Math.min(999, q + 1))}
                  >
                    +
                  </Button>
                </div>
                <ul className={styles.qtyPresets}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <li key={n}>
                      <button
                        type="button"
                        className={qty === n ? styles.presetOn : styles.preset}
                        onClick={() => setQty(n)}
                      >
                        {n}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Card variant="outline" padding="md" className={styles.seatSummary}>
                <Badge tone="info" variant="soft" dot>
                  {selectedSeats.length} lugares en el mapa
                </Badge>
              </Card>
            )}

            <KpiCard
              label="Total estimado"
              value={<span className={styles.kpiValue}>{money(estimate)}</span>}
              unit="MXN"
              tone="accent"
              hint={`${ticketCount} boleto${ticketCount === 1 ? '' : 's'}`}
              className={styles.totalKpi}
            />

            <Button
              type="button"
              size="lg"
              fullWidth
              disabled={ticketCount < 1}
              onClick={() => setStage('TENDER')}
            >
              Continuar a cobro · Enter
            </Button>

            {hasMap && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                fullWidth
                onClick={() => {
                  setPickSeats((v) => !v);
                  setSelectedSeats([]);
                  void releaseHolds();
                }}
              >
                {pickSeats ? 'Usar mejor disponible · M' : 'Elegir lugares en el mapa · M'}
              </Button>
            )}
            {hasMap && !pickSeats && (
              <Button type="button" variant="ghost" size="md" fullWidth onClick={() => void holdBestAvailable()}>
                Apartar {qty} juntos ahora
              </Button>
            )}
            {seatMode && selectedSeats.length > 0 && (
              <Button type="button" variant="ghost" size="md" fullWidth onClick={() => void reserveSelection()}>
                Apartar selección ({selectedSeats.length})
              </Button>
            )}
          </div>

          {seatMode && (
            <div className={styles.mapPane}>
              <Card variant="outline" padding="none" className={styles.mapCard}>
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
              </Card>
            </div>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {stage === 'TENDER' && (
        <section className={styles.tenderGrid}>
          <div className={styles.tenderMain}>
            <KpiCard
              label="Total a cobrar"
              value={<span className={styles.kpiValue}>{money(estimate)}</span>}
              unit="MXN"
              tone="accent"
              hint={`${ticketCount} boleto${ticketCount === 1 ? '' : 's'} · ${offer?.name || offer?.zone || 'General'}`}
              className={styles.amountKpi}
            />

            <div className={styles.methods}>
              {(
                [
                  { id: 'CASH' as const, label: 'Efectivo', hot: 'E' },
                  { id: 'CARD' as const, label: 'Tarjeta', hot: 'T' },
                  { id: 'COMP' as const, label: 'Cortesía', hot: 'C' },
                ]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={method === m.id ? styles.methodOn : styles.method}
                  onClick={() => {
                    setMethod(m.id);
                    if (m.id === 'COMP') setPendingAuth('COMP');
                  }}
                >
                  {m.label}
                  <kbd>{m.hot}</kbd>
                </button>
              ))}
            </div>

            {method === 'CASH' && (
              <Card variant="outline" padding="lg" className={styles.cashPanel}>
                <div className={styles.cashRow}>
                  <Input
                    inputMode="decimal"
                    label="Recibido"
                    value={cashReceived}
                    placeholder={String(estimate.toFixed(2))}
                    onChange={(e) => setCashReceived(e.target.value.replace(/[^\d.]/g, ''))}
                    inputSize="lg"
                    className={styles.cashInput}
                    leading={<span className={styles.currencyMark}>$</span>}
                  />
                  <div className={cash.sufficient ? styles.changeBox : styles.changeBoxBad}>
                    <span>{cash.sufficient ? 'Cambio' : 'Falta'}</span>
                    <strong>{money(cash.sufficient ? cash.change : cash.missing)}</strong>
                  </div>
                </div>

                {cash.change > 0 && (
                  <p className={styles.breakdown}>
                    Entregar: <strong>{changeBreakdownLabel(cash.change)}</strong>
                  </p>
                )}

                <p className={styles.quickCashLabel}>Montos rápidos</p>
                <ul className={styles.quickCash}>
                  {quickCash.map((amount, i) => (
                    <li key={amount}>
                      <button
                        type="button"
                        className={Number(cashReceived) === amount ? styles.billOn : styles.bill}
                        onClick={() => setCashReceived(String(amount))}
                      >
                        <span className={styles.billAmount}>
                          {amount === estimate ? 'Exacto' : billLabel(amount)}
                        </span>
                        <kbd>F{i + 1}</kbd>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {method === 'COMP' && (
              <Card variant="outline" padding="lg" className={styles.compBox}>
                <label className={styles.compSelect}>
                  <small>Motivo de la cortesía</small>
                  <select value={compReason} onChange={(e) => setCompReason(e.target.value)}>
                    <option value="house">Casa</option>
                    <option value="press">Prensa</option>
                    <option value="artist">Artista</option>
                    <option value="staff">Personal</option>
                  </select>
                </label>
                <Badge tone={managerPin ? 'success' : 'warning'} variant="soft" dot>
                  {managerPin ? 'Autorizada por gerencia' : 'Requiere PIN de gerente'}
                </Badge>
              </Card>
            )}

            {discountUnlocked && (
              <Input
                label="Código de descuento (autorizado)"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                inputSize="lg"
              />
            )}

            <Button
              type="button"
              size="lg"
              fullWidth
              className={styles.chargeBtn}
              disabled={loading || (method === 'CASH' && !cash.sufficient)}
              loading={loading}
              loadingLabel="Procesando…"
              onClick={() => void sell()}
            >
              Cobrar {money(estimate)} · Enter
            </Button>
          </div>

          <aside className={styles.tenderSide}>
            <Card variant="ghost" padding="md" className={styles.sideCard}>
              <Button type="button" variant="ghost" size="md" fullWidth onClick={() => setBuyerOpen((v) => !v)}>
                {buyerOpen ? 'Ocultar datos del comprador' : 'Datos del comprador (opcional)'}
              </Button>
              {buyerOpen && (
                <div className={styles.buyerFields}>
                  <Input
                    label="Nombre"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    inputSize="md"
                  />
                  <Input
                    type="email"
                    label="Email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    inputSize="md"
                  />
                </div>
              )}
              {!discountUnlocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  fullWidth
                  onClick={() => setPendingAuth('DISCOUNT')}
                >
                  Aplicar descuento · D (PIN)
                </Button>
              )}
              <p className={styles.sideNote}>
                El precio lo fija el catálogo del evento. La ventanilla no puede editarlo: los
                descuentos y las cortesías pasan por PIN de gerente y quedan auditados.
              </p>
            </Card>
          </aside>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {stage === 'DONE' && (
        <section className={styles.donePane}>
          <nav className={styles.stepper} aria-label="Venta completada">
            <ol className={styles.steps}>
              {SALE_STEPS.map((s, i) => (
                <li
                  key={s.id}
                  className={i === SALE_STEPS.length - 1 ? styles.stepOn : styles.stepDone}
                  aria-current={i === SALE_STEPS.length - 1 ? 'step' : undefined}
                >
                  <span className={styles.stepMarker} aria-hidden="true">
                    ✓
                  </span>
                  <span className={styles.stepLabel}>{s.label}</span>
                  {i < SALE_STEPS.length - 1 ? (
                    <span className={styles.stepConnector} aria-hidden="true" />
                  ) : null}
                </li>
              ))}
            </ol>
          </nav>

          <Card variant="outline" padding="lg" className={styles.successCard}>
            <div className={styles.successIcon} aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M14 25l7 7 13-14"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {method === 'CASH' && chargedTotal != null ? (
              <div className={styles.changeHero}>
                <Badge tone="success" variant="soft">
                  Venta completada
                </Badge>
                <span className={styles.changeLabel}>Cambio a devolver</span>
                <strong className={styles.changeAmount}>
                  {money(computeCash(chargedTotal, cashReceived).change)}
                </strong>
                <small>
                  {changeBreakdownLabel(computeCash(chargedTotal, cashReceived).change) ||
                    'Sin cambio'}
                </small>
              </div>
            ) : (
              <div className={styles.changeHero}>
                <Badge tone="success" variant="soft">
                  Venta completada
                </Badge>
                <span className={styles.changeLabel}>Cobrado</span>
                <strong className={styles.changeAmount}>{money(chargedTotal ?? estimate)}</strong>
                <small>{method === 'COMP' ? 'Cortesía autorizada' : 'Pago con tarjeta'}</small>
              </div>
            )}
          </Card>

          <p className={styles.doneMeta}>
            {receipt ? `${receipt.receiptNumber} · ${receipt.quantity} boletos` : 'Recibo enviado a impresión'}
          </p>

          <div className={styles.doneActions}>
            <Button type="button" size="lg" fullWidth onClick={reset}>
              Nueva venta · Enter
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              fullWidth
              onClick={() => receipt && void printReceipt(receipt)}
            >
              Reimprimir · P
            </Button>
          </div>
        </section>
      )}

      {cardWaiting && (
        <div className={styles.cardWait} role="alertdialog" aria-live="assertive">
          <Card variant="elevated" padding="lg" className={styles.cardWaitInner}>
            <span className={styles.cardPulse} aria-hidden />
            <strong>Terminal de tarjeta</strong>
            <p>Acerque, inserte o deslice la tarjeta…</p>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setCardWaiting(false);
                setLoading(false);
              }}
            >
              Cancelar · Esc
            </Button>
          </Card>
        </div>
      )}

      <ManagerPinDialog
        open={pendingAuth === 'COMP'}
        title="Autorizar cortesía"
        detail={`${ticketCount} boleto(s) sin cargo · motivo: ${compReason}. Queda registrado a nombre del gerente que autoriza.`}
        confirmLabel="Autorizar cortesía"
        onCancel={() => {
          setPendingAuth(null);
          if (!managerPin) setMethod('CASH');
        }}
        onConfirm={(pin) => {
          setManagerPin(pin);
          setPendingAuth(null);
          showToast('Cortesía autorizada — pulsa Enter para emitir');
        }}
      />

      <ManagerPinDialog
        open={pendingAuth === 'DISCOUNT'}
        title="Autorizar descuento"
        detail="Los códigos de descuento en ventanilla requieren autorización de gerencia."
        confirmLabel="Desbloquear descuento"
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
