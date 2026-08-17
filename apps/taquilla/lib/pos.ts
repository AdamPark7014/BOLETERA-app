import {
  apiFetch,
  apiJson,
  getCashierId as getAuthCashierId,
  getOrgId,
  getTaquillaUser,
} from './auth';
import { availableByOffer, fetchAvailability } from './inventory';
import { buildEscPosReceipt, printEscPos, printViaSerial } from './thermal';

const TERMINAL_KEY = 'boletera_terminal_id';
const SESSION_KEY = 'boletera_pos_session';
const CASHIER_KEY = 'boletera_cashier_id';
const OPENING_CASH_KEY = 'boletera_opening_cash';
const LAST_RECEIPT_KEY = 'boletera_last_receipt';
const LOCAL_QUOTA_KEY = 'boletera_offline_quota';
const FAILED_SYNC_KEY = 'boletera_failed_sync';
const SALE_DRAFT_KEY = 'boletera_sale_draft';

export type PosReceipt = {
  receiptNumber: string;
  orderId?: string;
  publicId?: string;
  timestamp: string;
  terminalId: string;
  eventName: string;
  quantity: number;
  subtotal: number;
  fees: number;
  taxes: number;
  total: number;
  paymentMethod: string;
  ticketCodes: { barcode: string; seatInfo: string }[];
  /** Añadidos en cliente para el ticket de efectivo. */
  cashReceived?: number;
  changeGiven?: number;
};

export type OfflinePosPayload = {
  type: 'pos';
  terminalId: string;
  sessionId: string;
  clientSaleId: string;
  checkoutData: {
    eventId: string;
    offerId: string;
    quantity?: number;
    seatIds?: string[];
    paymentMethod: 'CASH' | 'CARD' | 'COMP';
    cashierId?: string;
    buyerName?: string;
    buyerEmail?: string;
    buyerPhone?: string;
    clientSaleId?: string;
    isComp?: boolean;
    compReason?: string;
  };
};

export type SessionSummary = {
  totalTransactions: number;
  totalRevenue: number;
  byMethod: Record<string, number>;
  cashSales: number;
  cardSales: number;
  compCount?: number;
  openingCash: number;
  cashDrops?: Array<{ amount: number; note?: string; at?: string }>;
  dropsTotal?: number;
  expectedCash: number;
  startTime: string;
  endTime: string;
  recentSales: Array<{
    orderId: string;
    publicId: string;
    eventTitle: string;
    total: number;
    paymentMethod: string;
    quantity: number;
    createdAt: string;
    isComp?: boolean;
  }>;
};

export type ZReport = {
  id: string;
  createdAt?: string;
  closedAt?: string;
  cashierId?: string;
  totalRevenue?: number;
  variance?: number;
  [key: string]: unknown;
};

export function getTerminalId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TERMINAL_KEY);
}

export function getSessionId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_KEY);
}

export function getCashierId() {
  if (typeof window === 'undefined') return 'cashier-1';
  return localStorage.getItem(CASHIER_KEY) || getAuthCashierId() || 'cashier-1';
}

export function setCashierId(id: string) {
  localStorage.setItem(CASHIER_KEY, id);
}

export function getOpeningCash(): number {
  if (typeof window === 'undefined') return 0;
  const v = Number(localStorage.getItem(OPENING_CASH_KEY) || '0');
  return Number.isFinite(v) ? v : 0;
}

export function setOpeningCash(amount: number) {
  localStorage.setItem(OPENING_CASH_KEY, String(amount));
}

export function saveLastReceipt(receipt: PosReceipt) {
  localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receipt));
}

export function getLastReceipt(): PosReceipt | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(LAST_RECEIPT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PosReceipt;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Borrador de venta: si la pestaña se recarga (o el navegador mata la PWA) con
// una venta a medias y fila esperando, se recupera donde estaba.
// ---------------------------------------------------------------------------

export type SaleDraft = {
  eventId: string;
  eventTitle?: string;
  offerId: string;
  qty: number;
  seatIds: string[];
  method: 'CASH' | 'CARD' | 'COMP';
  cashReceived: string;
  stage: string;
  savedAt: string;
};

export function saveSaleDraft(draft: SaleDraft) {
  try {
    localStorage.setItem(SALE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* cuota llena: el borrador es una comodidad, no puede tumbar la venta */
  }
}

export function getSaleDraft(): SaleDraft | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SALE_DRAFT_KEY);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as SaleDraft;
    // Un borrador de hace horas es ruido, no contexto.
    if (Date.now() - new Date(draft.savedAt).getTime() > 30 * 60 * 1000) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearSaleDraft() {
  localStorage.removeItem(SALE_DRAFT_KEY);
}

// ---------------------------------------------------------------------------
// Turno
// ---------------------------------------------------------------------------

export async function ensurePosSession(
  organizationId: string,
  cashierId: string,
  openingCash = 0,
) {
  let terminalId = getTerminalId();
  if (!terminalId) {
    const terminal = await apiJson<{ id: string }>('/taquilla/terminal/init-org', {
      method: 'POST',
      body: JSON.stringify({
        organizationId,
        locationName: 'Mostrador principal',
        terminalName: `POS-${typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 12) : 'term'}`,
      }),
    });
    terminalId = terminal.id;
    localStorage.setItem(TERMINAL_KEY, terminalId);
  }

  let sessionId = getSessionId();
  if (!sessionId) {
    const session = await apiJson<{ sessionId: string; openingCash?: number }>(
      '/taquilla/session/start',
      {
        method: 'POST',
        body: JSON.stringify({ terminalId, cashierId, openingCash }),
      },
    );
    sessionId = session.sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
    setOpeningCash(Number(session.openingCash ?? openingCash));
  }

  setCashierId(cashierId);
  return { terminalId: terminalId, sessionId: sessionId };
}

export async function openShift(opts: {
  organizationId: string;
  cashierId: string;
  openingCash: number;
  forceNew?: boolean;
}) {
  if (opts.forceNew) localStorage.removeItem(SESSION_KEY);
  setOpeningCash(opts.openingCash);
  return ensurePosSession(opts.organizationId, opts.cashierId, opts.openingCash);
}

// ---------------------------------------------------------------------------
// Holds — canal TAQUILLA por las rutas de personal (F1-13)
// ---------------------------------------------------------------------------

type StaffHoldResponse = {
  holds: Array<{ id: string }>;
  expiresAt: string;
  ttlSeconds?: number;
};

function normalizeHold(res: StaffHoldResponse) {
  return {
    holdIds: (res.holds ?? []).map((h) => h.id),
    expiresAt: res.expiresAt,
    ttlSeconds: res.ttlSeconds ?? 0,
  };
}

/**
 * Hold de taquilla. Se usa `/inventory/staff/holds`: el canal y el `cashierId`
 * los pone el servidor a partir del JWT. Las cabeceras `x-channel` /
 * `x-cashier-id` ya no existen — las rutas públicas responden 403 si llegan.
 */
export async function createPosHold(params: {
  sessionId: string;
  eventId: string;
  offerId?: string;
  seatIds?: string[];
  quantity?: number;
}) {
  const res = await apiJson<StaffHoldResponse>('/inventory/staff/holds', {
    method: 'POST',
    body: JSON.stringify({
      eventId: params.eventId,
      offerId: params.offerId,
      seatIds: params.seatIds,
      quantity: params.quantity,
      sessionId: params.sessionId,
    }),
  });
  return normalizeHold(res);
}

/** Mejor disponible para venta GA rápida: el servidor elige las butacas. */
export async function createBestAvailableHold(params: {
  sessionId: string;
  eventId: string;
  offerId: string;
  quantity: number;
  contiguous?: boolean;
}) {
  const res = await apiJson<StaffHoldResponse>('/inventory/staff/holds/best-available', {
    method: 'POST',
    body: JSON.stringify({
      eventId: params.eventId,
      offerId: params.offerId,
      quantity: params.quantity,
      sessionId: params.sessionId,
      contiguous: params.contiguous ?? true,
    }),
  });
  return normalizeHold(res);
}

/** Liberación administrativa, uno por uno: `DELETE /inventory/staff/holds/:id`. */
export async function releasePosHolds(holdIds: string[]) {
  if (!holdIds.length) return;
  await Promise.all(
    holdIds.map((id) =>
      apiFetch(`/inventory/staff/holds/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
        () => undefined,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Cobro
// ---------------------------------------------------------------------------

export type CheckoutResult = {
  orderId: string;
  publicId: string;
  total: number;
  subtotal?: number;
  fees?: number;
  taxes?: number;
  quantity?: number;
  processingTime: string;
  status: string;
  isComp?: boolean;
  holdExpiresAt?: string;
};

export async function posCheckout(params: {
  terminalId: string;
  sessionId: string;
  eventId: string;
  offerId: string;
  quantity?: number;
  seatIds?: string[];
  holdIds?: string[];
  paymentMethod: 'CASH' | 'CARD' | 'COMP';
  cashierId?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  isComp?: boolean;
  compReason?: string;
  managerPin?: string;
  discountCode?: string;
  clientSaleId?: string;
}) {
  const clientSaleId = params.clientSaleId || crypto.randomUUID();
  return apiJson<CheckoutResult>('/taquilla/checkout', {
    method: 'POST',
    body: JSON.stringify({
      terminalId: params.terminalId,
      sessionId: params.sessionId,
      checkoutData: {
        eventId: params.eventId,
        offerId: params.offerId,
        quantity: params.quantity,
        seatIds: params.seatIds,
        holdIds: params.holdIds,
        paymentMethod: params.paymentMethod,
        cashierId: params.cashierId ?? getCashierId(),
        buyerName: params.buyerName,
        buyerEmail: params.buyerEmail,
        buyerPhone: params.buyerPhone,
        isComp: params.isComp || params.paymentMethod === 'COMP',
        compReason: params.compReason,
        managerPin: params.managerPin,
        discountCode: params.discountCode,
        clientSaleId,
      },
    }),
  });
}

export async function fetchReceipt(orderId: string, terminalId: string) {
  const rec = await apiJson<PosReceipt>(
    `/taquilla/receipt/${encodeURIComponent(orderId)}?terminalId=${encodeURIComponent(terminalId)}`,
  );
  return { ...rec, orderId };
}

export async function printReceipt(receipt: PosReceipt) {
  const lines = [
    receipt.receiptNumber,
    new Date(receipt.timestamp).toLocaleString('es-MX'),
    '',
    receipt.eventName,
    `Boletos: ${receipt.quantity}`,
    '',
    `Subtotal: $${receipt.subtotal.toFixed(2)}`,
    `Cargos: $${receipt.fees.toFixed(2)}`,
    `IVA: $${receipt.taxes.toFixed(2)}`,
    `TOTAL: $${receipt.total.toFixed(2)}`,
    `Pago: ${receipt.paymentMethod}`,
    ...(receipt.cashReceived != null
      ? [
          `Recibido: $${receipt.cashReceived.toFixed(2)}`,
          `Cambio: $${(receipt.changeGiven ?? 0).toFixed(2)}`,
        ]
      : []),
    '',
    ...receipt.ticketCodes.map((t) => `${t.seatInfo} · ${t.barcode}`),
    '',
    'Gracias por su compra',
  ];
  const payload = buildEscPosReceipt(lines);
  const serialOk = await printViaSerial(payload);
  if (!serialOk) printEscPos(payload);
}

// ---------------------------------------------------------------------------
// Caja y corte
// ---------------------------------------------------------------------------

export function fetchSessionSummary(sessionId: string) {
  return apiJson<SessionSummary>(
    `/taquilla/session/summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
}

export function endSession(sessionId: string, closingCashCounted: number, managerPin?: string) {
  return apiJson<Record<string, unknown>>('/taquilla/session/end', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      cashierId: getCashierId(),
      closingCashCounted,
      managerPin,
    }),
  });
}

export function addCashDrop(amount: number, note?: string) {
  const sessionId = getSessionId();
  if (!sessionId) return Promise.reject(new Error('Sin turno abierto'));
  return apiJson<SessionSummary>('/taquilla/session/cash-drop', {
    method: 'POST',
    body: JSON.stringify({ sessionId, amount, note, cashierId: getCashierId() }),
  });
}

export function listZReports(organizationId: string) {
  return apiJson<ZReport[]>(
    `/taquilla/z-reports?organizationId=${encodeURIComponent(organizationId)}`,
  );
}

/**
 * Traspaso de turno. Se cierra CON EL TOKEN DEL CAJERO SALIENTE (es quien
 * responde del efectivo contado) y devuelve la sesión del entrante. Quien entra
 * debe iniciar sesión con SUS credenciales: si se reutilizara el token del
 * saliente, todas las ventas del turno nuevo quedarían firmadas por la persona
 * equivocada.
 */
export async function handoffShift(opts: {
  toCashierId: string;
  closingCashCounted: number;
  openingCash?: number;
  managerPin?: string;
}) {
  const sessionId = getSessionId();
  if (!sessionId) throw new Error('Sin turno abierto');
  const data = await apiJson<{
    closed: Record<string, unknown>;
    next: { sessionId: string; openingCash?: number };
  }>('/taquilla/session/handoff', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      fromCashierId: getCashierId(),
      toCashierId: opts.toCashierId,
      closingCashCounted: opts.closingCashCounted,
      openingCash: opts.openingCash,
      managerPin: opts.managerPin,
    }),
  });
  if (data.next?.sessionId) {
    localStorage.setItem(SESSION_KEY, data.next.sessionId);
    setCashierId(opts.toCashierId);
    if (data.next.openingCash != null) setOpeningCash(Number(data.next.openingCash));
  }
  return data;
}

/**
 * Conserva el turno recién abierto por el traspaso mientras se cierra la sesión
 * de autenticación del cajero saliente. Sin esto, `clearTaquillaSession()`
 * borraría el `sessionId` que el API acaba de crear y el cajero entrante
 * abriría un SEGUNDO turno al identificarse: dos cortes Z para el mismo dinero.
 */
export function preserveHandoffSession(next: { sessionId: string; openingCash?: number }) {
  const terminalId = getTerminalId();
  return () => {
    localStorage.setItem(SESSION_KEY, next.sessionId);
    if (terminalId) localStorage.setItem(TERMINAL_KEY, terminalId);
    if (next.openingCash != null) setOpeningCash(Number(next.openingCash));
  };
}

// ---------------------------------------------------------------------------
// Operaciones sensibles
// ---------------------------------------------------------------------------

/** PIN de gerente contra el API (throttled a 8/min): nunca se compara en cliente. */
export async function verifyManagerPin(pin: string): Promise<boolean> {
  const organizationId = resolveOrgId();
  try {
    const data = await apiJson<{ valid?: boolean; ok?: boolean }>(
      '/taquilla/manager-pin/verify',
      { method: 'POST', body: JSON.stringify({ organizationId, pin }) },
    );
    return data.valid !== false && data.ok !== false;
  } catch {
    return false;
  }
}

export function voidOrder(orderId: string, reason: string, managerPin?: string) {
  return apiJson<{ orderId: string; publicId: string; status: string }>('/taquilla/void', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      sessionId: getSessionId(),
      cashierId: getCashierId(),
      reason,
      managerPin,
    }),
  });
}

export function exchangeOrder(params: {
  orderId: string;
  newOfferId?: string;
  newSeatIds?: string[];
  quantity?: number;
  paymentMethod: 'CASH' | 'CARD';
  managerPin?: string;
}) {
  return ensurePosSession(resolveOrgId(), getCashierId()).then(({ terminalId, sessionId }) =>
    apiJson<{ delta?: number }>('/taquilla/exchange', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        terminalId,
        sessionId,
        cashierId: getCashierId(),
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Búsqueda / will-call
// ---------------------------------------------------------------------------

export function scanTicket(barcode: string) {
  const terminalId = getTerminalId() || 'unknown';
  return apiJson<Record<string, unknown>>('/taquilla/scan', {
    method: 'POST',
    body: JSON.stringify({ terminalId, barcode }),
  });
}

export function willcallLookup(q: string) {
  return apiJson<unknown>('/taquilla/willcall/lookup', {
    method: 'POST',
    body: JSON.stringify({ q, organizationId: resolveOrgId() }),
  });
}

export function willcallFulfill(orderId: string) {
  return apiJson<unknown>('/taquilla/willcall/fulfill', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      cashierId: getCashierId(),
      terminalId: getTerminalId(),
    }),
  });
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export async function syncOfflineSales(transactions: OfflinePosPayload[]) {
  const terminalId = getTerminalId();
  if (!terminalId || !transactions.length) return { synced: 0 };
  return apiJson<{ synced: number; failed?: number }>(
    `/taquilla/offline/sync/${encodeURIComponent(terminalId)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        transactions: transactions.map((t) => ({
          sessionId: t.sessionId,
          clientSaleId: t.clientSaleId,
          checkoutData: { ...t.checkoutData, clientSaleId: t.clientSaleId },
        })),
      }),
    },
  );
}

/**
 * Cupo local para vender sin red.
 *
 * `POST /taquilla/sync-inventory` devuelve ahora el agregado nuevo (sin
 * `tickets[]`): el cupo sale de `totals.AVAILABLE` por oferta. Antes se contaba
 * `data.tickets`, que ya no existe → el cupo quedaba en 0 y la terminal
 * rechazaba TODA venta offline.
 */
export async function syncInventoryCache(eventId: string) {
  const terminalId = getTerminalId();
  try {
    if (terminalId) {
      await apiFetch('/taquilla/sync-inventory', {
        method: 'POST',
        body: JSON.stringify({ terminalId, eventId }),
      });
    }
    const snapshot = await fetchAvailability(eventId);
    const quotas = getLocalQuotas();
    quotas[eventId] = snapshot.totals.AVAILABLE ?? 0;
    localStorage.setItem(LOCAL_QUOTA_KEY, JSON.stringify(quotas));
    const byOffer = availableByOffer(snapshot);
    localStorage.setItem(`${LOCAL_QUOTA_KEY}:${eventId}`, JSON.stringify(byOffer));
    return snapshot;
  } catch {
    return null;
  }
}

export function getLocalQuotas(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LOCAL_QUOTA_KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function reserveLocalQuota(eventId: string, qty: number): boolean {
  const quotas = getLocalQuotas();
  const avail = quotas[eventId] ?? 0;
  if (avail < qty) return false;
  quotas[eventId] = avail - qty;
  localStorage.setItem(LOCAL_QUOTA_KEY, JSON.stringify(quotas));
  return true;
}

export function pushFailedSync(item: { clientSaleId: string; error: string }) {
  const list = getFailedSync();
  list.push({ ...item, at: new Date().toISOString() });
  localStorage.setItem(FAILED_SYNC_KEY, JSON.stringify(list.slice(-20)));
}

export function getFailedSync(): Array<{ clientSaleId: string; error: string; at: string }> {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(FAILED_SYNC_KEY) || '[]') as Array<{
      clientSaleId: string;
      error: string;
      at: string;
    }>;
  } catch {
    return [];
  }
}

export function clearFailedSync() {
  localStorage.removeItem(FAILED_SYNC_KEY);
}

export function resolveOrgId() {
  return getOrgId() || getTaquillaUser()?.organizationId || 'org-demo';
}
