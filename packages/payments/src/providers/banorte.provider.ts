import type { SalesChannelType } from '../types';
import type {
  PaymentCaptureResult,
  PaymentContext,
  PaymentIntentResult,
  PaymentProvider,
  PaymentStatusResult,
  RefundResult,
  WebhookResult,
} from '../types';
import { resolveContextMoney } from '../types';
import { PaymentError } from '../errors';
import { DEMO_SPEI_CLABE, getBanorteConfig } from '../banorte/config';
import {
  buildPayworksRedirectUrl,
  buildSpeiReference,
  parseBanorteSettlement,
  parseBanorteStatusText,
  queryBanorteTransactionStatus,
  verifyBanorteWebhookSignature,
} from '../banorte/payworks';
import { IdempotencyGuard } from '../security/idempotency';

/** Process-local intent cache. Export so apps can inspect or replace with Redis. */
export const banorteIntentIdempotency = new IdempotencyGuard<PaymentIntentResult>();

export class BanorteProvider implements PaymentProvider {
  readonly id = 'banorte' as const;
  readonly supportedChannels: SalesChannelType[] = ['WEB', 'TAQUILLA', 'API'];

  /** Web card/SPEI/OXXO se confirman vía Payworks o IPN; taquilla cobra al momento. */
  requiresAsyncCapture(ctx: PaymentContext): boolean {
    const method = ctx.paymentMethod ?? 'CARD';
    if (method === 'CASH') return false;
    return ctx.channel === 'WEB';
  }

  async createIntent(ctx: PaymentContext): Promise<PaymentIntentResult> {
    if (ctx.idempotencyKey) {
      const { value } = await banorteIntentIdempotency.getOrCreate(ctx.idempotencyKey, () =>
        this.createIntentOnce(ctx),
      );
      return value;
    }
    return this.createIntentOnce(ctx);
  }

  private async createIntentOnce(ctx: PaymentContext): Promise<PaymentIntentResult> {
    const cfg = getBanorteConfig();
    const intentId = `banorte_${ctx.orderId}_${Date.now()}`;
    const method = (ctx.paymentMethod ?? 'CARD').toUpperCase();
    const publicId = ctx.metadata?.publicId ?? ctx.orderId;
    const money = resolveContextMoney(ctx);

    if (cfg.isDemo) {
      if (process.env.NODE_ENV === 'production') {
        throw new PaymentError(
          'NOT_CONFIGURED',
          'Banorte no está configurado: define BANORTE_MERCHANT_ID y credenciales Payworks. El modo demo no está permitido en producción.',
          { retryable: false },
        );
      }
      return this.createDemoIntent(intentId, method, publicId);
    }

    if (method === 'SPEI') {
      if (!cfg.accountClabe) {
        throw new PaymentError(
          'NOT_CONFIGURED',
          'BANORTE_ACCOUNT_CLABE required for SPEI',
          { retryable: false },
        );
      }
      const spei = buildSpeiReference(publicId, cfg.accountClabe);
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: spei.reference,
        metadata: {
          type: 'SPEI',
          clabe: spei.clabe,
          concept: spei.concept,
          reference: spei.reference,
          merchantId: cfg.merchantId,
          orderId: ctx.orderId,
          amountMinor: money.amountMinor,
          currency: money.currency,
        },
      };
    }

    if (method === 'OXXO') {
      const oxxoRef = `OXXO${publicId.replace(/[^A-Z0-9]/gi, '').slice(-10)}`;
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: oxxoRef,
        metadata: {
          type: 'OXXO',
          reference: oxxoRef,
          merchantId: cfg.merchantId,
          orderId: ctx.orderId,
          amountMinor: money.amountMinor,
          currency: money.currency,
        },
      };
    }

    const redirectUrl = buildPayworksRedirectUrl(cfg, {
      orderId: ctx.orderId,
      publicId,
      amount: ctx.amount,
      amountMinor: money.amountMinor,
      currency: money.currency,
      buyerEmail: ctx.buyerEmail,
      buyerName: ctx.buyerName,
    });

    return {
      intentId,
      externalId: intentId,
      status: 'requires_action',
      redirectUrl,
      metadata: {
        type: 'CARD',
        merchantId: cfg.merchantId,
        affiliation: cfg.affiliation,
        orderId: ctx.orderId,
        settlement: 'direct_banorte_account',
        amountMinor: money.amountMinor,
        currency: money.currency,
      },
    };
  }

  private createDemoIntent(
    intentId: string,
    method: string,
    publicId: string,
  ): PaymentIntentResult {
    const cfg = getBanorteConfig();
    if (method === 'SPEI') {
      // DEMO_SPEI_CLABE is demo-only — never used when !isDemo (guarded above).
      const clabe = cfg.accountClabe || DEMO_SPEI_CLABE;
      const spei = buildSpeiReference(publicId, clabe);
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: spei.reference,
        metadata: {
          type: 'SPEI',
          demo: true,
          demoClabe: !cfg.accountClabe,
          ...spei,
        },
      };
    }
    if (method === 'OXXO') {
      const ref = `OXXO${publicId.slice(-8)}`;
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: ref,
        metadata: { type: 'OXXO', demo: true, reference: ref },
      };
    }
    return {
      intentId,
      externalId: intentId,
      status: 'requires_action',
      redirectUrl: `${cfg.returnUrl.replace(/\/$/, '')}/orders/${publicId}/pago?result=ok&demo=1`,
      metadata: { type: 'CARD', demo: true },
    };
  }

  async getPaymentStatus(externalId: string): Promise<PaymentStatusResult> {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) return { status: 'pending' };
    return queryBanorteTransactionStatus(cfg, externalId);
  }

  /**
   * Capture is safe to retry: never invents a second charge.
   * Live Banorte settlements confirm via Payworks/IPN — capture reports awaiting.
   */
  async capture(intentId: string, externalId?: string): Promise<PaymentCaptureResult> {
    const cfg = getBanorteConfig();
    const id = externalId ?? intentId;

    if (cfg.isDemo) {
      return { success: true, externalId: id, paidAt: new Date() };
    }

    // Idempotent: querying status never creates a charge. Safe under retry.
    const queried = await queryBanorteTransactionStatus(cfg, id);
    if (queried.status === 'completed') {
      return { success: true, externalId: id, paidAt: new Date() };
    }
    if (queried.status === 'declined' || queried.status === 'failed') {
      return {
        success: false,
        externalId: id,
        error: 'Payment declined by Banorte',
        errorCode: 'DECLINED',
      };
    }
    if (queried.status === 'cancelled') {
      return {
        success: false,
        externalId: id,
        error: 'Payment cancelled',
        errorCode: 'CANCELLED',
      };
    }
    if (queried.status === 'expired') {
      return {
        success: false,
        externalId: id,
        error: 'Payment expired',
        errorCode: 'EXPIRED',
      };
    }

    return {
      success: false,
      externalId: id,
      error: 'Awaiting Banorte confirmation (Payworks/IPN)',
      errorCode: 'AWAITING_CONFIRMATION',
    };
  }

  /**
   * Refund is safe to retry: never invents a second charge or duplicate refund id.
   * Live Banorte refunds are portal-driven; we return a structured, non-invented result.
   */
  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    const cfg = getBanorteConfig();
    // Deterministic refund id so retries do not invent a second refund reference.
    const refundId = `banorte_ref_${paymentId}`;

    if (cfg.isDemo) {
      return { success: true, refundId };
    }

    return {
      success: false,
      refundId: '',
      error: `Solicitar devolución ${amount} en portal Banorte comercios — pago ${paymentId}`,
      errorCode: 'PROVIDER_ERROR',
    };
  }

  async handleWebhook(payload: unknown, signature?: string): Promise<WebhookResult> {
    const cfg = getBanorteConfig();
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!verifyBanorteWebhookSignature(raw, signature, cfg.webhookSecret)) {
      throw new PaymentError('INVALID_SIGNATURE', 'Invalid Banorte webhook signature', {
        retryable: false,
      });
    }

    const body =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, string>)
        : (JSON.parse(raw) as Record<string, string>);

    const statusRaw = body.status ?? body.ESTATUS ?? body.response ?? '';
    const orderId = body.orderId ?? body.REFERENCIA ?? body.metadata_orderId;
    const intentId = body.intentId ?? body.transaction_id;

    // Lo liquidado viaja con TODOS los veredictos, no solo con el aprobado:
    // un rechazo con importe también sirve para auditar el descuadre.
    const settlement = parseBanorteSettlement(body);
    const rawCode = String(body.CODIGO_RESPUESTA ?? body.codigo_respuesta ?? statusRaw ?? '');
    const base = { orderId, intentId, ...settlement, rawCode };

    const approved =
      statusRaw.toLowerCase() === 'approved' ||
      statusRaw.toLowerCase() === 'aprobada' ||
      statusRaw.toLowerCase() === 'success' ||
      statusRaw === '00' ||
      body.resultado === 'A';

    if (approved) {
      return { ...base, status: 'completed' };
    }

    const parsed = parseBanorteStatusText(statusRaw || JSON.stringify(body));
    if (parsed === 'declined') {
      return { ...base, status: 'declined' };
    }
    if (parsed === 'cancelled') {
      return { ...base, status: 'cancelled' };
    }
    if (parsed === 'expired') {
      return { ...base, status: 'expired' };
    }
    if (parsed === 'failed' || statusRaw.toLowerCase() === 'failed') {
      return { ...base, status: 'failed' };
    }
    return { ...base, status: 'pending' };
  }
}
