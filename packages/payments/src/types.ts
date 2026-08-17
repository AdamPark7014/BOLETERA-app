export type SalesChannelType = 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN';

export type PaymentProviderId =
  | 'stripe'
  | 'banorte'
  | 'cash'
  | 'oxxo'
  | 'clip'
  | 'spei';

export type BanortePaymentMethod = 'CARD' | 'SPEI' | 'OXXO' | 'CASH';

export interface PaymentContext {
  amount: number;
  currency: string;
  orderId: string;
  channel: SalesChannelType;
  buyerEmail: string;
  buyerName: string;
  paymentMethod?: BanortePaymentMethod;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface PaymentIntentResult {
  intentId: string;
  externalId?: string;
  clientSecret?: string;
  redirectUrl?: string;
  reference?: string;
  status: 'pending' | 'requires_action' | 'completed';
  metadata?: Record<string, unknown>;
}

export interface PaymentCaptureResult {
  success: boolean;
  externalId: string;
  paidAt?: Date;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  error?: string;
}

/**
 * Estado de una transacción según el proveedor.
 *
 * Incluye el importe liquidado porque sin él la conciliación es imposible:
 * el sistema solo conocía el importe *esperado* (Order.totalAmount) y nunca
 * el realmente cobrado, de modo que un cobro parcial o en otra moneda emitía
 * boletos igual (F1-05).
 */
export interface PaymentStatusResult {
  status: 'completed' | 'failed' | 'pending';
  /** Importe liquidado por el banco, cuando la respuesta lo declara. */
  amount?: number;
  /** ISO-4217 alfabético (MXN/USD) ya normalizado desde el numérico 484/840. */
  currency?: string;
  /** Código crudo del proveedor: se audita para poder ampliar los catálogos. */
  rawCode?: string;
}

export interface WebhookResult {
  orderId?: string;
  intentId?: string;
  status: 'completed' | 'failed' | 'pending';
  /** Importe liquidado declarado en el IPN (IMPORTE / amount / monto). */
  amount?: number;
  /** ISO-4217 alfabético normalizado desde MONEDA (484 → MXN, 840 → USD). */
  currency?: string;
  /** Código o estatus crudo recibido, para auditoría. */
  rawCode?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly supportedChannels: SalesChannelType[];
  createIntent(ctx: PaymentContext): Promise<PaymentIntentResult>;
  capture(intentId: string, externalId?: string): Promise<PaymentCaptureResult>;
  refund(paymentId: string, amount: number): Promise<RefundResult>;
  handleWebhook?(payload: unknown, signature?: string): Promise<WebhookResult>;
}
