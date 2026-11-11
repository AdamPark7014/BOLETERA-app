'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.registerProvider = registerProvider;
exports.getProvider = getProvider;
exports.initDefaultProviders = initDefaultProviders;
exports.listProviders = listProviders;
const banorte_provider_1 = require('./providers/banorte.provider');
const cash_provider_1 = require('./providers/cash.provider');
const providers = new Map();
function registerProvider(provider) {
  providers.set(provider.id, provider);
}
function getProvider(id) {
  const p = providers.get(id);
  if (!p) throw new Error(`Payment provider not registered: ${id}`);
  return p;
}
/** Pasarela principal: Banorte directo a cuenta empresarial (sin Stripe). */
function initDefaultProviders() {
  registerProvider(new banorte_provider_1.BanorteProvider());
  registerProvider(new cash_provider_1.CashProvider());
}
function listProviders() {
  return Array.from(providers.keys());
}
//# sourceMappingURL=registry.js.map
