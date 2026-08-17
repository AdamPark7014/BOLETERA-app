import { formatCurrency, formatPercent } from '@boletera/ui';
import type { OrderRow } from '@/lib/queries/orders';

export type BanorteIpn = {
  webhookUrl: string;
  returnUrlBase: string;
  cancelUrl: string;
  webhookSecretConfigured: boolean;
  signatureHeaders: string[];
  registerHint?: string;
};

export type BanorteValidation = {
  ready: boolean;
  demo: boolean;
  missing: string[];
  warnings: string[];
};

export type BanorteConfig = {
  gateway: string;
  demo: boolean;
  mode: 'demo' | 'live';
  productionReady: boolean;
  methods: string[];
  settlement: string;
  buyerNote: string;
  accountClabeMasked: string | null;
  validation: BanorteValidation;
  ipn?: BanorteIpn;
};

export type ValidateResult = BanorteValidation & {
  checkedAt?: string;
  ipn?: BanorteIpn;
};

export type OrgFeeSnapshot = {
  commissionRate: number;
  feesInclusive: boolean;
  name?: string;
};

export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export type CredentialRow = {
  id: string;
  label: string;
  masked: string;
  configured: boolean;
  hint: string;
};

const METHOD_LABELS: Record<string, string> = {
  CARD: 'Tarjeta (Payworks)',
  SPEI: 'SPEI',
  OXXO: 'OXXO',
};

const METHOD_HINTS: Record<string, string> = {
  CARD: '3-D Secure vía Banorte Payworks',
  SPEI: 'Requiere CLABE de liquidación',
  OXXO: 'Confirmación asíncrona por IPN',
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

export function methodHint(method: string): string {
  return METHOD_HINTS[method] ?? 'Método habilitado en el gateway';
}

export function envTone(cfg: BanorteConfig): HealthTone {
  if (cfg.productionReady) return 'success';
  if (cfg.demo) return 'warning';
  return 'danger';
}

export function envLabel(cfg: BanorteConfig): string {
  if (cfg.productionReady) return 'Producción lista';
  if (cfg.demo) return 'Entorno demo';
  return 'Live incompleto';
}

/** Masks env var names as credential slots — never shows secret values. */
export function buildCredentialRows(
  cfg: BanorteConfig,
  checklist: BanorteValidation,
): CredentialRow[] {
  const missing = new Set(checklist.missing);
  const warnings = new Set(checklist.warnings);
  const merchantOk = !missing.has('BANORTE_MERCHANT_ID') && !cfg.demo;
  const affiliationOk = !missing.has('BANORTE_AFFILIATION');
  const userOk = !missing.has('BANORTE_USER');
  const secretOk = !missing.has('BANORTE_API_SECRET');
  const webhookOk =
    Boolean(cfg.ipn?.webhookSecretConfigured) && !missing.has('BANORTE_WEBHOOK_SECRET');
  const clabeWarned = [...warnings].some((w) => w.includes('BANORTE_ACCOUNT_CLABE'));

  return [
    {
      id: 'merchant',
      label: 'Merchant ID',
      masked: merchantOk ? 'bnrt_••••••••' : '— no configurado',
      configured: merchantOk,
      hint: 'BANORTE_MERCHANT_ID en el servidor',
    },
    {
      id: 'affiliation',
      label: 'Afiliación',
      masked: affiliationOk && merchantOk ? 'aff_••••••••' : '— pendiente',
      configured: affiliationOk && !cfg.demo,
      hint: 'BANORTE_AFFILIATION',
    },
    {
      id: 'user',
      label: 'Usuario Payworks',
      masked: userOk && merchantOk ? 'usr_••••••••' : '— pendiente',
      configured: userOk && !cfg.demo,
      hint: 'BANORTE_USER',
    },
    {
      id: 'api-secret',
      label: 'API secret',
      masked: secretOk && merchantOk ? '••••••••••••••••' : '— pendiente',
      configured: secretOk && !cfg.demo,
      hint: 'BANORTE_API_SECRET · valor nunca expuesto',
    },
    {
      id: 'webhook',
      label: 'Webhook secret',
      masked: webhookOk ? '••••••••••••••••' : '— faltante',
      configured: webhookOk,
      hint: 'BANORTE_WEBHOOK_SECRET · solo estado booleano',
    },
    {
      id: 'clabe',
      label: 'CLABE liquidación',
      masked: cfg.accountClabeMasked ?? (clabeWarned ? '— advertencia' : '— no publicada'),
      configured: Boolean(cfg.accountClabeMasked),
      hint: 'BANORTE_ACCOUNT_CLABE · enmascarada 4+4',
    },
  ];
}

export function parseOrgFees(data: Record<string, unknown> | undefined): OrgFeeSnapshot | null {
  if (!data) return null;
  const rateRaw = data.commissionRate;
  const rate =
    typeof rateRaw === 'number'
      ? rateRaw
      : typeof rateRaw === 'string'
        ? Number(rateRaw)
        : NaN;
  if (Number.isNaN(rate)) return null;
  return {
    commissionRate: rate,
    feesInclusive: Boolean(data.feesInclusive),
    name: typeof data.name === 'string' ? data.name : undefined,
  };
}

export function feeBreakdown(fees: OrgFeeSnapshot, ticketExample = 1000) {
  const commission = ticketExample * fees.commissionRate;
  const net = ticketExample - commission;
  return {
    ticketExample,
    commission,
    net,
    rateLabel: formatPercent(fees.commissionRate),
    ticketLabel: formatCurrency(ticketExample),
    commissionLabel: formatCurrency(commission),
    netLabel: formatCurrency(net),
    inclusive: fees.feesInclusive,
  };
}

export type PaymentHealthSummary = {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  recent: Array<{
    id: string;
    label: string;
    status: string;
    gateway: string;
    amount: string;
    when: string;
    tone: HealthTone;
  }>;
};

function paymentTone(status: string): HealthTone {
  const normalized = status.toUpperCase();
  if (['PAID', 'COMPLETED', 'SUCCEEDED', 'CAPTURED'].includes(normalized)) return 'success';
  if (['PENDING', 'PROCESSING', 'REQUIRES_ACTION'].includes(normalized)) return 'warning';
  if (['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].includes(normalized)) return 'danger';
  return 'neutral';
}

export function summarizePaymentHealth(orders: OrderRow[] | undefined): PaymentHealthSummary {
  const rows = orders ?? [];
  let paid = 0;
  let pending = 0;
  let failed = 0;

  for (const order of rows) {
    const tone = paymentTone(order.payment?.status ?? order.status);
    if (tone === 'success') paid += 1;
    else if (tone === 'warning') pending += 1;
    else if (tone === 'danger') failed += 1;
  }

  const recent = rows.slice(0, 8).map((order) => {
    const status = order.payment?.status ?? order.status;
    return {
      id: order.id,
      label: order.publicId || order.id.slice(0, 8),
      status,
      gateway: order.payment?.gateway ?? '—',
      amount: formatCurrency(Number(order.totalAmount) || 0),
      when: order.createdAt,
      tone: paymentTone(status),
    };
  });

  return {
    total: rows.length,
    paid,
    pending,
    failed,
    recent,
  };
}

export function methodEnabled(
  method: string,
  cfg: BanorteConfig,
  checklist: BanorteValidation,
): { enabled: boolean; reason: string } {
  if (cfg.demo) {
    return { enabled: true, reason: 'Disponible en demo (sin cobro real)' };
  }
  if (method === 'SPEI' && !cfg.accountClabeMasked) {
    return { enabled: false, reason: 'Falta CLABE de liquidación' };
  }
  if (!checklist.ready) {
    return { enabled: false, reason: 'Credenciales incompletas' };
  }
  return { enabled: true, reason: 'Listo en producción' };
}
