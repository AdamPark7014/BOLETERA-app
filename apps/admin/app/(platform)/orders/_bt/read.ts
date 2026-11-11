/**
 * Lectura tolerante de listas del API para órdenes, reembolsos y reservaciones.
 *
 * `GET /admin/orders` y `GET /payments/refunds` devuelven un sobre paginado
 * (`{ data, nextCursor, hasMore, limit }`), no un arreglo. La lista vieja
 * hacía `orders.filter(...)` sobre el sobre y reventaba con
 * «orders.filter is not a function». Aquí se acepta arreglo o sobre con
 * `data`, `items` u `orders`, y se conserva el total si viene.
 */

import { asRecord, readNumber, readString } from '../../events/_ticket/read';

export type ListPage = {
  items: unknown[];
  /** Total que reporta el API, si lo reporta. */
  total: number | null;
  hasMore: boolean;
};

export function readListPage(payload: unknown): ListPage {
  if (Array.isArray(payload)) return { items: payload, total: payload.length, hasMore: false };
  const box = asRecord(payload);
  const list = [box.data, box.items, box.orders, box.rows].find(Array.isArray) as
    | unknown[]
    | undefined;
  const items = list ?? [];
  const total = readNumber(box.total) ?? readNumber(box.totalCount) ?? readNumber(box.count);
  return {
    items,
    total,
    hasMore: box.hasMore === true || readString(box.nextCursor) != null,
  };
}

export type OrderListRow = {
  id: string;
  publicId: string;
  status: string;
  channel: string;
  /** El listado trae `expectedAmount`; el detalle, `totalAmount`. */
  amount: number;
  currency: string;
  buyerName: string | null;
  buyerEmail: string | null;
  createdAt: string | null;
  eventTitle: string;
  paymentGateway: string | null;
  paymentStatus: string | null;
};

export function readOrderRow(raw: unknown): OrderListRow | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  if (!id) return null;
  const payment = asRecord(row.payment);
  return {
    id,
    publicId: readString(row.publicId) ?? id,
    status: readString(row.status) ?? '—',
    channel: readString(row.channel) ?? '—',
    amount: readNumber(row.totalAmount) ?? readNumber(row.expectedAmount) ?? 0,
    currency: (readString(row.currency) ?? readString(row.expectedCurrency) ?? 'MXN').toUpperCase(),
    buyerName: readString(row.buyerName),
    buyerEmail: readString(row.buyerEmail),
    createdAt: readString(row.createdAt),
    eventTitle: readString(asRecord(row.event).title) ?? 'Sin evento',
    paymentGateway: readString(payment.gateway),
    paymentStatus: readString(payment.status),
  };
}

export function readOrderRows(payload: unknown): {
  rows: OrderListRow[];
  total: number | null;
  hasMore: boolean;
} {
  const page = readListPage(payload);
  return {
    rows: page.items.flatMap((item) => {
      const row = readOrderRow(item);
      return row ? [row] : [];
    }),
    total: page.total,
    hasMore: page.hasMore,
  };
}

const CHANNEL: Record<string, string> = {
  WEB: 'Web',
  TAQUILLA: 'Taquilla',
  API: 'API',
  MOBILE: 'Móvil',
  PHONE: 'Teléfono',
  ADMIN: 'Admin',
  PROMOTER: 'Promotor',
  COURTESY: 'Cortesía',
  CORPORATE: 'Corporativo',
  RESALE: 'Reventa',
  POS: 'Punto de venta',
  INVITATION: 'Invitación',
  AFFILIATE: 'Afiliado',
  VIP: 'VIP',
};

export function channelWord(value: string): string {
  return CHANNEL[value.toUpperCase()] ?? value;
}

const REFUND_REASON: Record<string, string> = {
  CUSTOMER_REQUEST: 'Solicitud del cliente',
  EVENT_CANCELLED: 'Evento cancelado',
  PAYMENT_ERROR: 'Error de cobro',
  TICKET_NOT_RECEIVED: 'No recibió los boletos',
  DUPLICATE: 'Cobro duplicado',
  CUSTOMER_CHANGED_MIND: 'Cambio de opinión',
  FRAUD: 'Fraude',
};

export const REFUND_REASON_OPTIONS = Object.entries(REFUND_REASON).map(([value, label]) => ({
  value,
  label,
}));

export function refundReasonWord(value: string): string {
  return REFUND_REASON[value] ?? value;
}

const TICKET_STATUS: Record<string, string> = {
  VALID: 'Válido',
  ISSUED: 'Emitido',
  USED: 'Usado',
  SCANNED: 'Escaneado',
  TRANSFERRED: 'Transferido',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
  VOID: 'Anulado',
};

export function ticketStatusWord(value: string): string {
  return TICKET_STATUS[value] ?? value;
}
