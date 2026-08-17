/**
 * Credenciales Banorte — liquidación directa a tu cuenta empresarial.
 * Contrata afiliación e-commerce / Payworks con tu ejecutivo Banorte.
 * Sin BANORTE_MERCHANT_ID el gateway opera en modo demo (solo desarrollo).
 *
 * Webhook secret soft-allow:
 * - Outside production: missing BANORTE_WEBHOOK_SECRET is allowed for local demos
 *   (verifyBanorteWebhookSignature returns true when secret is empty).
 * - Production (NODE_ENV=production): missing secret ALWAYS fails verification.
 *   Never deploy without BANORTE_WEBHOOK_SECRET.
 */
export type BanorteConfig = {
  merchantId: string;
  affiliation: string;
  terminal: string;
  user: string;
  password: string;
  /** CLABE o cuenta de depósito Banorte del promotor */
  accountClabe: string;
  payworksUrl: string;
  webhookSecret: string;
  returnUrl: string;
  cancelUrl: string;
  isDemo: boolean;
};

/**
 * Demo-only SPEI CLABE placeholder.
 * NEVER use when `!cfg.isDemo` — production SPEI requires BANORTE_ACCOUNT_CLABE.
 */
export const DEMO_SPEI_CLABE = '012180001234567890' as const;

export function validateBanorteProductionConfig(): {
  ready: boolean;
  demo: boolean;
  missing: string[];
  warnings: string[];
} {
  const cfg = getBanorteConfig();
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProd = process.env.NODE_ENV === 'production';

  if (!cfg.merchantId) missing.push('BANORTE_MERCHANT_ID');
  if (!cfg.affiliation) missing.push('BANORTE_AFFILIATION');
  if (!cfg.user) missing.push('BANORTE_USER');
  if (!cfg.password) missing.push('BANORTE_API_SECRET');
  if (!cfg.webhookSecret) {
    // Soft-allow missing secret outside production for demos ONLY.
    // Production MUST set BANORTE_WEBHOOK_SECRET — never soft-allow there.
    if (isProd) missing.push('BANORTE_WEBHOOK_SECRET');
    else warnings.push('BANORTE_WEBHOOK_SECRET (requerido en producción; soft-allow solo en demo/dev)');
  }
  if (!cfg.accountClabe) warnings.push('BANORTE_ACCOUNT_CLABE (requerido para SPEI)');

  return {
    ready: missing.length === 0,
    demo: cfg.isDemo,
    missing,
    warnings,
  };
}

export function getBanorteConfig(): BanorteConfig {
  const merchantId = process.env.BANORTE_MERCHANT_ID ?? '';
  return {
    merchantId,
    affiliation: process.env.BANORTE_AFFILIATION ?? merchantId,
    terminal: process.env.BANORTE_TERMINAL ?? '1',
    user: process.env.BANORTE_USER ?? '',
    password: process.env.BANORTE_API_SECRET ?? process.env.BANORTE_PASSWORD ?? '',
    accountClabe: process.env.BANORTE_ACCOUNT_CLABE ?? '',
    payworksUrl:
      process.env.BANORTE_PAYWORKS_URL ??
      'https://eps.banorte.com/secure3d/Solucion3DSecure.htm',
    webhookSecret: process.env.BANORTE_WEBHOOK_SECRET ?? '',
    returnUrl: process.env.BANORTE_RETURN_URL ?? 'http://localhost:3000',
    cancelUrl: process.env.BANORTE_CANCEL_URL ?? 'http://localhost:3000',
    isDemo: !merchantId,
  };
}

/** Public API origin for Banorte IPN registration (no trailing slash). */
export function getApiPublicBaseUrl(): string {
  const raw =
    process.env.API_PUBLIC_URL ||
    process.env.BANORTE_API_PUBLIC_URL ||
    `http://127.0.0.1:${process.env.API_PORT || 4000}`;
  return raw.replace(/\/$/, '');
}

export function getBanorteIpnEndpoints() {
  const cfg = getBanorteConfig();
  const apiBase = getApiPublicBaseUrl();
  return {
    webhookUrl: `${apiBase}/api/v1/payments/webhooks/banorte`,
    returnUrlBase: cfg.returnUrl.replace(/\/$/, ''),
    cancelUrl: cfg.cancelUrl,
    webhookSecretConfigured: Boolean(cfg.webhookSecret),
    signatureHeaders: ['x-banorte-signature', 'x-signature'] as const,
  };
}
