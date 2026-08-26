import type { BadgeTone } from '@boletera/ui';
import type { CfdiInvoice, CfdiStatus } from '@/lib/platform-api';
import { toCents, type Cents } from './format';

export type InvoiceFilter = 'ALL' | 'OK' | 'ERROR' | 'PENDING';

export type InvoiceStatusMeta = {
  label: string;
  tone: BadgeTone;
  kind: 'ok' | 'error' | 'pending' | 'cancelled' | 'other';
};

const STATUS_LABEL: Record<CfdiStatus, string> = {
  STAMPED: 'Timbrada',
  DRAFT: 'Pendiente',
  CANCELLED: 'Cancelada',
  ERROR: 'Con error',
};

const STATUS_TONE: Record<CfdiStatus, BadgeTone> = {
  STAMPED: 'success',
  DRAFT: 'warning',
  CANCELLED: 'neutral',
  ERROR: 'danger',
};

export function invoiceStatusMeta(invoice: CfdiInvoice): InvoiceStatusMeta {
  const status = invoice.status;
  if (status === 'STAMPED') {
    return { label: STATUS_LABEL.STAMPED, tone: STATUS_TONE.STAMPED, kind: 'ok' };
  }
  if (status === 'DRAFT' || !invoice.uuid) {
    return { label: STATUS_LABEL.DRAFT, tone: STATUS_TONE.DRAFT, kind: 'pending' };
  }
  if (status === 'ERROR') {
    return { label: STATUS_LABEL.ERROR, tone: STATUS_TONE.ERROR, kind: 'error' };
  }
  if (status === 'CANCELLED') {
    return { label: STATUS_LABEL.CANCELLED, tone: STATUS_TONE.CANCELLED, kind: 'cancelled' };
  }
  return { label: status, tone: 'neutral', kind: 'other' };
}

export function matchesInvoiceFilter(
  invoice: CfdiInvoice,
  filter: InvoiceFilter,
): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'ERROR') return invoice.status === 'ERROR';
  if (filter === 'PENDING') return invoice.status === 'DRAFT' || !invoice.uuid;
  return invoice.status === 'STAMPED';
}

export function invoiceMatchesQuery(invoice: CfdiInvoice, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return (
    (invoice.uuid?.toLowerCase().includes(query) ?? false) ||
    invoice.receptorRfc.toLowerCase().includes(query) ||
    invoice.receptorNombre.toLowerCase().includes(query) ||
    `${invoice.serie}-${invoice.folio}`.toLowerCase().includes(query) ||
    (invoice.orderId?.toLowerCase().includes(query) ?? false)
  );
}

export type CfdiTotals = {
  stampedCount: number;
  draftCount: number;
  cancelledCount: number;
  errorCount: number;
  stampedCents: Cents;
};

export function summarizeInvoices(invoices: readonly CfdiInvoice[]): CfdiTotals {
  let stampedCount = 0;
  let draftCount = 0;
  let cancelledCount = 0;
  let errorCount = 0;
  let stampedCents = 0;

  for (const invoice of invoices) {
    switch (invoice.status) {
      case 'STAMPED':
        stampedCount += 1;
        stampedCents += toCents(invoice.total);
        break;
      case 'DRAFT':
        draftCount += 1;
        break;
      case 'CANCELLED':
        cancelledCount += 1;
        break;
      case 'ERROR':
        errorCount += 1;
        break;
      default:
        break;
    }
  }

  return { stampedCount, draftCount, cancelledCount, errorCount, stampedCents };
}

export const FILTER_OPTIONS: ReadonlyArray<{ value: InvoiceFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OK', label: 'Timbrados' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'ERROR', label: 'Errores' },
];

/** Qué significa el estado en términos de operación, no de base de datos. */
export const STATUS_MEANING: Record<CfdiStatus, string> = {
  STAMPED: 'El PAC devolvió UUID: la factura ya es válida ante el SAT.',
  DRAFT: 'Se generó el comprobante pero aún no tiene timbre. Vuelve a timbrarla.',
  CANCELLED: 'Se canceló ante el SAT. Si el cliente sigue necesitando factura, timbra una nueva.',
  ERROR: 'El PAC rechazó el timbrado. Revisa el motivo y corrige antes de reintentar.',
};
