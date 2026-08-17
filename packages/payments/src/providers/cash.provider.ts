import type { SalesChannelType } from '../types';
import type {
  PaymentCaptureResult,
  PaymentContext,
  PaymentIntentResult,
  PaymentProvider,
  RefundResult,
} from '../types';
import { IdempotencyGuard } from '../security/idempotency';

const cashIntentIdempotency = new IdempotencyGuard<PaymentIntentResult>();

export class CashProvider implements PaymentProvider {
  readonly id = 'cash' as const;
  readonly supportedChannels: SalesChannelType[] = ['TAQUILLA', 'ADMIN'];

  async createIntent(ctx: PaymentContext): Promise<PaymentIntentResult> {
    const build = async (): Promise<PaymentIntentResult> => {
      const intentId = `cash_${ctx.orderId}`;
      return {
        intentId,
        status: 'completed',
        metadata: { channel: ctx.channel },
      };
    };

    if (ctx.idempotencyKey) {
      const { value } = await cashIntentIdempotency.getOrCreate(ctx.idempotencyKey, build);
      return value;
    }
    return build();
  }

  /** Safe to retry — same externalId, no second charge. */
  async capture(intentId: string): Promise<PaymentCaptureResult> {
    return { success: true, externalId: intentId, paidAt: new Date() };
  }

  /** Safe to retry — deterministic refundId (no Date.now inventing duplicates). */
  async refund(paymentId: string, _amount: number): Promise<RefundResult> {
    return { success: true, refundId: `cash_ref_${paymentId}` };
  }
}
