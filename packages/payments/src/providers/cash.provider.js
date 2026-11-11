'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.CashProvider = void 0;
class CashProvider {
  id = 'cash';
  supportedChannels = ['TAQUILLA', 'ADMIN'];
  async createIntent(ctx) {
    const intentId = `cash_${ctx.orderId}`;
    return {
      intentId,
      status: 'completed',
      metadata: { channel: ctx.channel },
    };
  }
  async capture(intentId) {
    return { success: true, externalId: intentId, paidAt: new Date() };
  }
  async refund(_paymentId, _amount) {
    return { success: true, refundId: `cash_ref_${Date.now()}` };
  }
}
exports.CashProvider = CashProvider;
//# sourceMappingURL=cash.provider.js.map
