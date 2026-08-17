import type { OrderRow } from '@/lib/queries/orders';
import type { BadgeTone } from '@boletera/ui/src/components/Badge';

/** Minimal order shape used by list filters / exceptions. */
export type OrderRowLike = Pick<
  OrderRow,
  'id' | 'publicId' | 'status' | 'channel' | 'buyerName' | 'buyerEmail' | 'createdAt' | 'event'
>;

export type OrderStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'FAILED';

export type SalesChannel =
  | 'WEB'
  | 'TAQUILLA'
  | 'POS'
  | 'API'
  | 'ADMIN'
  | 'RESALE';

export type OrderTicket = {
  id: string;
  code: string;
  status: string;
  section: string | null;
  row: string | null;
  seatNumber: string | null;
};

export type OrderItemDetail = {
  id: string;
  quantity: number;
  unitPrice: string | number;
  subtotal: string | number;
  tickets: OrderTicket[];
};

export type OrderRefund = {
  id: string;
  amount: string | number;
  status: string;
  reason?: string;
  notes: string | null;
  requestedBy?: string;
  processedBy?: string | null;
  requestedAt: string;
  processedAt?: string | null;
};

export type OrderPayment = {
  id?: string;
  gateway: string;
  status: string;
  externalId?: string;
  amount?: string | number;
  currency?: string;
  method?: string;
  lastFourDigits?: string | null;
  brand?: string | null;
  errorMessage?: string | null;
  processedAt?: string | null;
  createdAt?: string;
};

export type OrderFraudFlag = {
  id: string;
  type: string;
  severity: string;
  score: number;
  reason: string;
  status: string;
  orderId?: string | null;
  createdAt?: string;
  resolvedAt?: string | null;
  resolution?: string | null;
};

/** Shape returned by GET /admin/orders/:id (Prisma include). */
export type OrderDetailView = OrderRow & {
  event: { id?: string; title: string; slug?: string };
  buyerPhone?: string | null;
  billingAddress?: string | null;
  subtotal?: string | number;
  fees?: string | number;
  discountAmount?: string | number;
  taxAmount?: string | number;
  commissionAmount?: string | number;
  paymentMethod?: string;
  cashierId?: string | null;
  expiresAt?: string;
  completedAt?: string | null;
  refundedAt?: string | null;
  updatedAt?: string;
  payment: OrderPayment | null;
  refunds: OrderRefund[];
  items: OrderItemDetail[];
  fraudFlags?: OrderFraudFlag[];
};

export type StatusMeta = {
  label: string;
  tone: BadgeTone;
};

export type MetricsRangeKey = '7d' | '30d' | '90d';

export type OrderExceptionKind =
  | 'failed'
  | 'stale_pending'
  | 'pending_refund'
  | 'partial_refund';

export type OrderException = {
  orderId: string;
  publicId: string;
  kind: OrderExceptionKind;
  label: string;
  createdAt: string;
};
