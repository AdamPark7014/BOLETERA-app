import type { AuditEntry } from '@/lib/queries/audit';
import { orderStatusLabel } from '../../dashboard/format';
import { formatMoney, orderAmount, orderCurrency } from './format';

export type CrmActivityItem = {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  detail: string | null;
};

function auditVerb(action: string): string {
  const normalized = action.toUpperCase();
  if (normalized.includes('ORDER')) return 'actualizó pedido';
  if (normalized.includes('REFUND')) return 'procesó reembolso';
  if (normalized.includes('WAITLIST')) return 'tocó lista de espera';
  if (normalized.includes('API_KEY')) return 'gestionó clave partner';
  if (normalized.includes('CAMPAIGN')) return 'ajustó campaña';
  return action.toLowerCase().replaceAll('_', ' ');
}

/** Pedidos recientes + auditoría relevante, del más nuevo al más viejo. */
export function buildCrmActivity(input: {
  orders: ReadonlyArray<{
    id: string;
    buyerName: string;
    buyerEmail: string;
    status: string;
    createdAt: string;
    publicId: string;
    totalAmount?: string;
    currency: string;
    event?: { title: string } | null;
  }>;
  audit: readonly AuditEntry[];
}): CrmActivityItem[] {
  const fromOrders = input.orders
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)
    .map((order) => ({
      id: `order-${order.id}`,
      actor: order.buyerName || order.buyerEmail || 'Cliente',
      action: `registró pedido · ${orderStatusLabel(order.status).toLowerCase()}`,
      target: order.event?.title || order.publicId,
      timestamp: order.createdAt,
      detail: formatMoney(orderAmount(order), orderCurrency(order)),
    }));

  const fromAudit = input.audit
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)
    .map((entry) => ({
      id: `audit-${entry.id}`,
      actor: 'Sistema',
      action: auditVerb(entry.action),
      target: `${entry.entityType} · ${entry.entityId.slice(0, 8)}`,
      timestamp: entry.createdAt,
      detail: null,
    }));

  return [...fromOrders, ...fromAudit]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);
}
