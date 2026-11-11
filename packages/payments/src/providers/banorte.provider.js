'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.BanorteProvider = void 0;
const config_1 = require('../banorte/config');
const payworks_1 = require('../banorte/payworks');
class BanorteProvider {
  id = 'banorte';
  supportedChannels = ['WEB', 'TAQUILLA', 'API'];
  /** Web card/SPEI/OXXO se confirman vía Payworks o IPN; taquilla cobra al momento. */
  requiresAsyncCapture(ctx) {
    const method = ctx.paymentMethod ?? 'CARD';
    if (method === 'CASH') return false;
    return ctx.channel === 'WEB';
  }
  async createIntent(ctx) {
    const cfg = (0, config_1.getBanorteConfig)();
    const intentId = `banorte_${ctx.orderId}_${Date.now()}`;
    const method = (ctx.paymentMethod ?? 'CARD').toUpperCase();
    const publicId = ctx.metadata?.publicId ?? ctx.orderId;
    if (cfg.isDemo) {
      return this.createDemoIntent(intentId, ctx, method, publicId);
    }
    if (method === 'SPEI') {
      if (!cfg.accountClabe) {
        throw new Error('BANORTE_ACCOUNT_CLABE required for SPEI');
      }
      const spei = (0, payworks_1.buildSpeiReference)(publicId, cfg.accountClabe);
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
        },
      };
    }
    const redirectUrl = (0, payworks_1.buildPayworksRedirectUrl)(cfg, {
      orderId: ctx.orderId,
      publicId,
      amount: ctx.amount,
      currency: ctx.currency,
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
      },
    };
  }
  createDemoIntent(intentId, _ctx, method, publicId) {
    const cfg = (0, config_1.getBanorteConfig)();
    if (method === 'SPEI') {
      const spei = (0, payworks_1.buildSpeiReference)(
        publicId,
        cfg.accountClabe || '012180001234567890'
      );
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: spei.reference,
        metadata: { type: 'SPEI', demo: true, ...spei },
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
  async getPaymentStatus(externalId) {
    const cfg = (0, config_1.getBanorteConfig)();
    if (cfg.isDemo) return { status: 'pending' };
    return (0, payworks_1.queryBanorteTransactionStatus)(cfg, externalId);
  }
  async capture(intentId, externalId) {
    const cfg = (0, config_1.getBanorteConfig)();
    if (cfg.isDemo) {
      return { success: true, externalId: externalId ?? intentId, paidAt: new Date() };
    }
    return {
      success: false,
      externalId: externalId ?? intentId,
      error: 'Awaiting Banorte confirmation (Payworks/IPN)',
    };
  }
  async refund(paymentId, amount) {
    const cfg = (0, config_1.getBanorteConfig)();
    if (cfg.isDemo) {
      return { success: true, refundId: `banorte_ref_${paymentId}` };
    }
    return {
      success: false,
      refundId: '',
      error: `Solicitar devolución ${amount} en portal Banorte comercios — pago ${paymentId}`,
    };
  }
  async handleWebhook(payload, signature) {
    const cfg = (0, config_1.getBanorteConfig)();
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!(0, payworks_1.verifyBanorteWebhookSignature)(raw, signature, cfg.webhookSecret)) {
      throw new Error('Invalid Banorte webhook signature');
    }
    const body = typeof payload === 'object' && payload !== null ? payload : JSON.parse(raw);
    const status = (body.status ?? body.ESTATUS ?? body.response ?? '').toLowerCase();
    const orderId = body.orderId ?? body.REFERENCIA ?? body.metadata_orderId;
    const intentId = body.intentId ?? body.transaction_id;
    const approved =
      status === 'approved' ||
      status === 'aprobada' ||
      status === 'success' ||
      status === '00' ||
      body.resultado === 'A';
    if (approved) {
      return { orderId, intentId, status: 'completed' };
    }
    if (status === 'declined' || status === 'rechazada' || status === 'failed') {
      return { orderId, intentId, status: 'failed' };
    }
    return { orderId, intentId, status: 'pending' };
  }
}
exports.BanorteProvider = BanorteProvider;
//# sourceMappingURL=banorte.provider.js.map
