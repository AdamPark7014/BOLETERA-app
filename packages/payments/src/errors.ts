/**
 * Structured payment errors and safe retry — never invent a second charge on retry.
 * Callers should inspect `code` to decide whether a retry is safe.
 */

export const PAYMENT_ERROR_CODES = [
  'IDEMPOTENCY_CONFLICT',
  'AWAITING_CONFIRMATION',
  'ALREADY_CAPTURED',
  'ALREADY_REFUNDED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
  'INVALID_SIGNATURE',
  'PROVIDER_ERROR',
  'NOT_CONFIGURED',
  'INVALID_AMOUNT',
  'RETRY_NOT_SAFE',
  'MISSING_IDEMPOTENCY_KEY',
] as const;

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PaymentErrorCode,
    message: string,
    options?: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PaymentError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }

  static isPaymentError(value: unknown): value is PaymentError {
    return value instanceof PaymentError;
  }
}

export type SafeRetryOperation = 'query' | 'get_status' | 'create_intent';

export type SafeRetryOptions = {
  /** Max attempts including the first. Default: 3. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 200. */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default: 5_000. */
  maxDelayMs?: number;
  /**
   * Operation kind. `create_intent` is ONLY allowed when `idempotencyKey` is set;
   * otherwise the helper refuses to run (never double-charge).
   */
  operation: SafeRetryOperation;
  /** Required when operation is `create_intent`. */
  idempotencyKey?: string;
  /** Optional predicate — return false to stop retrying immediately. */
  isRetryable?: (error: unknown, attempt: number) => boolean;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsRetryable(error: unknown): boolean {
  if (PaymentError.isPaymentError(error)) {
    return error.retryable;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('network') ||
      msg.includes('503') ||
      msg.includes('429')
    );
  }
  return false;
}

/**
 * Retry helper with exponential backoff.
 *
 * ONLY safe for idempotent GETs / status queries.
 * Never use for createIntent unless an idempotency key is provided —
 * without one this throws `MISSING_IDEMPOTENCY_KEY` / `RETRY_NOT_SAFE`.
 */
export async function withSafeRetry<T>(
  fn: () => Promise<T>,
  options: SafeRetryOptions,
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    operation,
    idempotencyKey,
    isRetryable = defaultIsRetryable,
    sleep = defaultSleep,
  } = options;

  if (operation === 'create_intent' && !idempotencyKey) {
    throw new PaymentError(
      'MISSING_IDEMPOTENCY_KEY',
      'createIntent retries require an idempotencyKey — refusing to risk a double charge',
      { retryable: false },
    );
  }

  if (operation !== 'query' && operation !== 'get_status' && operation !== 'create_intent') {
    throw new PaymentError(
      'RETRY_NOT_SAFE',
      `Operation not eligible for safe retry: ${String(operation)}`,
      { retryable: false },
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && isRetryable(error, attempt);
      if (!canRetry) throw error;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  throw lastError;
}
