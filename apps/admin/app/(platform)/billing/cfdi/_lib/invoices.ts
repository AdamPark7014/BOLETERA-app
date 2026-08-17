import type { BadgeTone } from '@boletera/ui';
import type { CfdiInvoice } from '@/lib/queries';
import { toCents, type Cents } from './format';

export type InvoiceFilter = 'ALL' | 'OK' | 'ERROR' | 'PENDING';

export type InvoiceStatusMeta = {
  label: string;
  tone: BadgeTone;
  kind: 'ok' | 'error' | 'pending' | 'other';
};

export function classifyStatus(status: string): InvoiceStatusMeta['kind'] {
  const key = status.toLowerCase();
  if (key.includes('error') || key.includes('cancel') || key.includes('reject')) {
    return 'error';
  }
  if (key.includes('pending') || key.includes('draft')) {
    return 'pending';
  }
  if (
    key.includes('stamp') ||
    key.includes('issue') ||
    key === 'timbrado' ||
    key === 'ok'
  ) {
    return 'ok';
  }
  return 'other';
}

export function invoiceStatusMeta(invoice: CfdiInvoice): InvoiceStatusMeta {
  const kind = classifyStatus(invoice.status);
  if (kind === 'error') {
    return { label: invoice.status, tone: 'danger', kind };
  }
  if (kind === 'pending' || !invoice.uuid) {
    return {
      label: invoice.uuid ? invoice.status : 'Pendiente',
      tone: 'warning',
      kind: 'pending',
    };
  }
  if (kind === 'ok') {
    return { label: invoice.status || 'Timbrado', tone: 'success', kind };
  }
  return { label: invoice.status, tone: 'neutral', kind };
}

export function matchesInvoiceFilter(
  invoice: CfdiInvoice,
  filter: InvoiceFilter,
): boolean {
  if (filter === 'ALL') return true;
  const meta = invoiceStatusMeta(invoice);
  if (filter === 'ERROR') return meta.kind === 'error';
  if (filter === 'PENDING') return meta.kind === 'pending' || !invoice.uuid;
  return meta.kind === 'ok' && Boolean(invoice.uuid);
}

export function invoiceMatchesQuery(invoice: CfdiInvoice, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return (
    (invoice.uuid?.toLowerCase().includes(query) ?? false) ||
    invoice.receptorRfc.toLowerCase().includes(query) ||
    `${invoice.serie}-${invoice.folio}`.toLowerCase().includes(query) ||
    (invoice.orderId?.toLowerCase().includes(query) ?? false)
  );
}

export type CfdiTotals = {
  stampedCount: number;
  pendingCount: number;
  errorCount: number;
  stampedCents: Cents;
};

export function summarizeInvoices(invoices: readonly CfdiInvoice[]): CfdiTotals {
  let stampedCount = 0;
  let pendingCount = 0;
  let errorCount = 0;
  let stampedCents = 0;

  for (const invoice of invoices) {
    const meta = invoiceStatusMeta(invoice);
    if (meta.kind === 'error') {
      errorCount += 1;
      continue;
    }
    if (meta.kind === 'pending' || !invoice.uuid) {
      pendingCount += 1;
      continue;
    }
    stampedCount += 1;
    stampedCents += toCents(invoice.total);
  }

  return { stampedCount, pendingCount, errorCount, stampedCents };
}

export const FILTER_OPTIONS: ReadonlyArray<{ value: InvoiceFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OK', label: 'Timbrados' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'ERROR', label: 'Errores' },
];
