import { asRecord, readNumber, readString } from '../../events/_ticket/read';

export type RefundPolicy = {
  settlementBusinessDays: number;
  bankBusinessDays: number;
  transferDeadlineDays: number;
  settlementSaved: boolean;
  bankSaved: boolean;
  transferSaved: boolean;
};

export type RefundRow = {
  id: string;
  amount: number;
  reason: string;
  status: string;
  notes: string | null;
  requestedBy: string | null;
  processedBy: string | null;
  publicId: string;
  eventTitle: string | null;
};

export type TransferRow = {
  id: string;
  status: string;
  folio: string;
  keyEpoch: number;
  eventTitle: string | null;
};

const REASON_LABEL: Record<string, string> = {
  CUSTOMER_REQUEST: 'Pedido del comprador',
  PAYMENT_ERROR: 'Error de pago',
  DUPLICATE: 'Duplicado',
  FRAUD: 'Fraude',
  EVENT_CANCELLED: 'Evento cancelado',
  TICKET_NOT_RECEIVED: 'Boleto no recibido',
  CUSTOMER_CHANGED_MIND: 'El comprador cambió de opinión',
};

const REFUND_STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  COMPLETED: 'Completo',
  FAILED: 'Fallido',
  DISPUTED: 'En disputa',
};

const TRANSFER_STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Caducada',
};

export function reasonLabel(value: string): string {
  return REASON_LABEL[value] ?? value;
}

export function refundStatusLabel(value: string): string {
  return REFUND_STATUS[value] ?? value;
}

export function transferStatusLabel(value: string): string {
  return TRANSFER_STATUS[value] ?? value;
}

export function businessDaysLabel(days: number): string {
  const text = days.toLocaleString('es-MX');
  return days === 1 ? `${text} día hábil` : `${text} días hábiles`;
}

export function calendarDaysLabel(days: number): string {
  const text = days.toLocaleString('es-MX');
  return days === 1 ? `${text} día` : `${text} días`;
}

export function readRefundPolicy(raw: unknown): RefundPolicy | null {
  const row = asRecord(raw);
  const settlementBusinessDays = readNumber(row.settlementBusinessDays);
  const bankBusinessDays = readNumber(row.bankBusinessDays);
  const transferDeadlineDays = readNumber(row.transferDeadlineDays);
  if (settlementBusinessDays == null || bankBusinessDays == null || transferDeadlineDays == null) {
    return null;
  }
  return {
    settlementBusinessDays,
    bankBusinessDays,
    transferDeadlineDays,
    settlementSaved: row.settlementSaved === true,
    bankSaved: row.bankSaved === true,
    transferSaved: row.transferSaved === true,
  };
}

export function readRefunds(raw: unknown): { rows: RefundRow[]; hasMore: boolean } | null {
  const body = asRecord(raw);
  if (!Array.isArray(body.data)) return null;
  const rows: RefundRow[] = [];
  for (const item of body.data) {
    const row = asRecord(item);
    const id = readString(row.id);
    const amount = readNumber(row.amount);
    const reason = readString(row.reason);
    const status = readString(row.status);
    if (!id || amount == null || !reason || !status) continue;
    const order = asRecord(row.order);
    const event = asRecord(order.event);
    rows.push({
      id,
      amount,
      reason,
      status,
      notes: readString(row.notes),
      requestedBy: readString(row.requestedBy),
      processedBy: readString(row.processedBy),
      publicId: readString(order.publicId) ?? id,
      eventTitle: readString(event.title),
    });
  }
  return { rows, hasMore: body.hasMore === true };
}

export function readTransfers(raw: unknown): TransferRow[] | null {
  const body = asRecord(raw);
  if (!Array.isArray(body.data)) return null;
  const rows: TransferRow[] = [];
  for (const item of body.data) {
    const row = asRecord(item);
    const id = readString(row.id);
    const status = readString(row.status);
    const ticket = asRecord(row.ticket);
    const folio = readString(ticket.code);
    const keyEpoch = readNumber(ticket.keyEpoch);
    if (!id || !status || !folio || keyEpoch == null) continue;
    const event = asRecord(ticket.event);
    rows.push({
      id,
      status,
      folio,
      keyEpoch,
      eventTitle: readString(event.title),
    });
  }
  return rows;
}
