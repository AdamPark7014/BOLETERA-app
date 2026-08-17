import type { OrderRow } from '@/lib/queries/orders';
import type {
  OrderDetailView,
  OrderFraudFlag,
  OrderItemDetail,
  OrderPayment,
  OrderRefund,
  OrderTicket,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = asString(value);
  return s || null;
}

function asAmount(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.toString === 'function') {
    return value.toString();
  }
  return '0';
}

function parseTicket(value: unknown): OrderTicket | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const code = asString(value.code);
  if (!id && !code) return null;
  return {
    id: id || code,
    code: code || id,
    status: asString(value.status, 'UNKNOWN'),
    section: asNullableString(value.section),
    row: asNullableString(value.row),
    seatNumber: asNullableString(value.seatNumber),
  };
}

function parseItem(value: unknown): OrderItemDetail | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  const ticketsRaw = Array.isArray(value.tickets) ? value.tickets : [];
  return {
    id,
    quantity: typeof value.quantity === 'number' ? value.quantity : Number(value.quantity ?? 0),
    unitPrice: asAmount(value.unitPrice),
    subtotal: asAmount(value.subtotal),
    tickets: ticketsRaw.map(parseTicket).filter((t): t is OrderTicket => t !== null),
  };
}

function parseRefund(value: unknown): OrderRefund | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    amount: asAmount(value.amount),
    status: asString(value.status, 'UNKNOWN'),
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    notes: asNullableString(value.notes),
    requestedBy: typeof value.requestedBy === 'string' ? value.requestedBy : undefined,
    processedBy: asNullableString(value.processedBy),
    requestedAt: asString(value.requestedAt),
    processedAt: asNullableString(value.processedAt),
  };
}

function parsePayment(value: unknown): OrderPayment | null {
  if (!isRecord(value)) return null;
  const gateway = asString(value.gateway);
  const status = asString(value.status);
  if (!gateway && !status) return null;
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    gateway: gateway || '—',
    status: status || 'UNKNOWN',
    externalId: typeof value.externalId === 'string' ? value.externalId : undefined,
    amount: value.amount != null ? asAmount(value.amount) : undefined,
    currency: typeof value.currency === 'string' ? value.currency : undefined,
    method: typeof value.method === 'string' ? value.method : undefined,
    lastFourDigits: asNullableString(value.lastFourDigits),
    brand: asNullableString(value.brand),
    errorMessage: asNullableString(value.errorMessage),
    processedAt: asNullableString(value.processedAt),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
  };
}

export function parseOrderDetail(data: unknown): OrderDetailView | null {
  if (!isRecord(data)) return null;

  const id = asString(data.id);
  const publicId = asString(data.publicId);
  if (!id || !publicId) return null;

  const eventRaw = isRecord(data.event) ? data.event : null;
  const eventTitle = eventRaw ? asString(eventRaw.title) : '';
  if (!eventTitle) return null;

  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const refundsRaw = Array.isArray(data.refunds) ? data.refunds : [];
  const fraudRaw = Array.isArray(data.fraudFlags) ? data.fraudFlags : [];

  const base: OrderRow = {
    id,
    publicId,
    status: asString(data.status, 'PENDING'),
    channel: asString(data.channel, 'WEB'),
    totalAmount: asString(data.totalAmount, '0'),
    currency: asString(data.currency, 'MXN'),
    buyerName: asString(data.buyerName),
    buyerEmail: asString(data.buyerEmail),
    createdAt: asString(data.createdAt),
    event: { title: eventTitle },
    payment: parsePayment(data.payment),
  };

  return {
    ...base,
    event: {
      id: eventRaw && typeof eventRaw.id === 'string' ? eventRaw.id : undefined,
      title: eventTitle,
      slug: eventRaw && typeof eventRaw.slug === 'string' ? eventRaw.slug : undefined,
    },
    buyerPhone: asNullableString(data.buyerPhone),
    billingAddress: asNullableString(data.billingAddress),
    subtotal: data.subtotal != null ? asAmount(data.subtotal) : undefined,
    fees: data.fees != null ? asAmount(data.fees) : undefined,
    discountAmount: data.discountAmount != null ? asAmount(data.discountAmount) : undefined,
    taxAmount: data.taxAmount != null ? asAmount(data.taxAmount) : undefined,
    commissionAmount:
      data.commissionAmount != null ? asAmount(data.commissionAmount) : undefined,
    paymentMethod: typeof data.paymentMethod === 'string' ? data.paymentMethod : undefined,
    cashierId: asNullableString(data.cashierId),
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
    completedAt: asNullableString(data.completedAt),
    refundedAt: asNullableString(data.refundedAt),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    payment: parsePayment(data.payment),
    refunds: refundsRaw.map(parseRefund).filter((r): r is OrderRefund => r !== null),
    items: itemsRaw.map(parseItem).filter((i): i is OrderItemDetail => i !== null),
    fraudFlags: fraudRaw
      .map(parseFraudFlag)
      .filter((f): f is OrderFraudFlag => f !== null),
  };
}

export function parseFraudFlag(value: unknown): OrderFraudFlag | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    type: asString(value.type, 'UNKNOWN'),
    severity: asString(value.severity, 'LOW'),
    score: typeof value.score === 'number' ? value.score : Number(value.score ?? 0),
    reason: asString(value.reason),
    status: asString(value.status, 'OPEN'),
    orderId: asNullableString(value.orderId),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    resolvedAt: asNullableString(value.resolvedAt),
    resolution: asNullableString(value.resolution),
  };
}

export function parseFraudFlagList(data: unknown): OrderFraudFlag[] {
  if (!Array.isArray(data)) return [];
  return data.map(parseFraudFlag).filter((f): f is OrderFraudFlag => f !== null);
}
