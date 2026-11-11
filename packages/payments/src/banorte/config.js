'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.validateBanorteProductionConfig = validateBanorteProductionConfig;
exports.getBanorteConfig = getBanorteConfig;
function validateBanorteProductionConfig() {
  const cfg = getBanorteConfig();
  const missing = [];
  const warnings = [];
  if (!cfg.merchantId) missing.push('BANORTE_MERCHANT_ID');
  if (!cfg.affiliation) missing.push('BANORTE_AFFILIATION');
  if (!cfg.user) missing.push('BANORTE_USER');
  if (!cfg.password) missing.push('BANORTE_API_SECRET');
  if (!cfg.webhookSecret) warnings.push('BANORTE_WEBHOOK_SECRET (recomendado en producción)');
  if (!cfg.accountClabe) warnings.push('BANORTE_ACCOUNT_CLABE (requerido para SPEI)');
  return {
    ready: missing.length === 0,
    demo: cfg.isDemo,
    missing,
    warnings,
  };
}
function getBanorteConfig() {
  const merchantId = process.env.BANORTE_MERCHANT_ID ?? '';
  return {
    merchantId,
    affiliation: process.env.BANORTE_AFFILIATION ?? merchantId,
    terminal: process.env.BANORTE_TERMINAL ?? '1',
    user: process.env.BANORTE_USER ?? '',
    password: process.env.BANORTE_API_SECRET ?? process.env.BANORTE_PASSWORD ?? '',
    accountClabe: process.env.BANORTE_ACCOUNT_CLABE ?? '',
    payworksUrl:
      process.env.BANORTE_PAYWORKS_URL ?? 'https://eps.banorte.com/secure3d/Solucion3DSecure.htm',
    webhookSecret: process.env.BANORTE_WEBHOOK_SECRET ?? '',
    returnUrl: process.env.BANORTE_RETURN_URL ?? 'http://localhost:3000',
    cancelUrl: process.env.BANORTE_CANCEL_URL ?? 'http://localhost:3000',
    isDemo: !merchantId,
  };
}
//# sourceMappingURL=config.js.map
