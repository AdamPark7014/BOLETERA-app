import type {
  CurrencyCode,
  MoneyAmount,
  PaymentMethodValue,
  SalesChannelValue,
} from '@boletera/shared';
import {
  DEFAULT_CURRENCY,
  PaymentMethod,
  PAYMENT_METHOD_VALUES,
  toCurrencyCode,
  toMinorUnits,
  moneyFromMinor,
} from '@boletera/shared';
import type { PaymentErrorCode } from './errors';

/**
 * Alias of shared `SalesChannelValue` kept for retrocompat with older imports.
 * Prefer importing `SalesChannel` / `SalesChannelValue` from `@boletera/shared`.
 */
export type SalesChannelType = SalesChannelValue;

export type PaymentProviderId =
  | 'stripe'
  | 'banorte'
  | 'cash'
  | 'oxxo'
  | 'clip'
  | 'spei';

/** Banorte-supported subset of shared PaymentMethod values. */
export type BanortePaymentMethod = Extract<
  PaymentMethodValue,
  'CARD' | 'SPEI' | 'OXXO' | 'CASH'
>;

export { PaymentMethod, PAYMENT_METHOD_VALUES };

/** Intent lifecycle statuses — keep pending/requires_action/completed for retrocompat. */
export type PaymentIntentStatus =
  | 'pending'
  | 'requires_action'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'expired';

/** Webhook / IPN normalized statuses. */
export type WebhookStatus =
  | 'completed'
  | 'failed'
  | 'pending'
  | 'declined'
  | 'cancelled'
  | 'expired';

export interface PaymentContext {
  /**
   * Amount in major units (pesos). Converted internally via `toMinorUnits`.
   * Prefer `amountMinor` when the caller already has centavos.
   */
  amount: number;
  /** Preferred: integer minor units (centavos). Takes precedence over `amount`. */
  amountMinor?: number;
  currency: string;
  orderId: string;
  channel: SalesChannelType;
  buyerEmail: string;
  buyerName: string;
  paymentMethod?: BanortePaymentMethod;
  metadata?: Record<string, string>;
  /**
   * When set, createIntent returns the same intent for the same key (no new charge).
   * Required for safe retries of createIntent.
   */
  idempotencyKey?: string;
}

export interface PaymentIntentResult {
  intentId: string;
  externalId?: string;
  clientSecret?: string;
  redirectUrl?: string;
  reference?: string;
  status: PaymentIntentStatus;
  metadata?: Record<string, unknown>;
}

export interface PaymentCaptureResult {
  success: boolean;
  externalId: string;
  paidAt?: Date;
  error?: string;
  /** Structured code — prefer over parsing `error` strings. */
  errorCode?: PaymentErrorCode;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  error?: string;
  errorCode?: PaymentErrorCode;
}

export interface WebhookResult {
  orderId?: string;
  intentId?: string;
  status: WebhookStatus;
  /**
   * Importe y moneda REALMENTE liquidados por el gateway.
   *
   * Sin esto no existe ningún punto del sistema donde se compare lo cobrado con
   * lo debido: el `Payment` se guardaba con el total esperado de la orden, así
   * que un pago parcial liquidaba una orden completa y el descuadre era
   * indetectable por construcción. `undefined` significa "el gateway no lo
   * envió", que es distinto de cero.
   */
  amount?: number;
  currency?: string;
  /** Código de respuesta crudo, para auditar por qué se clasificó así. */
  rawCode?: string;
}

/** Resultado de consultar el estado de un cobro, con lo liquidado si se conoce. */
export interface PaymentStatusResult {
  status: WebhookStatus;
  amount?: number;
  currency?: string;
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

/** Resolve a MoneyAmount from PaymentContext (amountMinor preferred). */
export function resolveContextMoney(ctx: Pick<PaymentContext, 'amount' | 'amountMinor' | 'currency'>): MoneyAmount {
  const currency: CurrencyCode = toCurrencyCode(ctx.currency);
  if (ctx.amountMinor !== undefined) {
    return moneyFromMinor(ctx.amountMinor, currency);
  }
  return moneyFromMinor(toMinorUnits(ctx.amount, currency), currency);
}

export { DEFAULT_CURRENCY };
