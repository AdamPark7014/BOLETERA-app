import type { BadgeTone, StatusTone } from '@boletera/ui';
import type {
  BanorteConfig,
  IntegrationHealth,
  IntegrationKind,
  WebhookHealthSnapshot,
} from '@/lib/queries/integrations';
import { classifyBanorteHealth, emailIntegrationHealth } from '@/lib/queries/integrations';

export type HealthMeta = {
  id: IntegrationHealth;
  label: string;
  tone: BadgeTone;
  statusTone: StatusTone;
};

const HEALTH_META: Record<IntegrationHealth, HealthMeta> = {
  healthy: {
    id: 'healthy',
    label: 'Sana',
    tone: 'success',
    statusTone: 'success',
  },
  degraded: {
    id: 'degraded',
    label: 'Degradada',
    tone: 'warning',
    statusTone: 'warning',
  },
  misconfigured: {
    id: 'misconfigured',
    label: 'Mal configurada',
    tone: 'danger',
    statusTone: 'danger',
  },
  demo: {
    id: 'demo',
    label: 'Demo',
    tone: 'warning',
    statusTone: 'warning',
  },
  unknown: {
    id: 'unknown',
    label: 'Sin telemetría',
    tone: 'neutral',
    statusTone: 'neutral',
  },
  unavailable: {
    id: 'unavailable',
    label: 'No disponible',
    tone: 'danger',
    statusTone: 'danger',
  },
};

export function healthMeta(health: IntegrationHealth): HealthMeta {
  return HEALTH_META[health];
}

export function categoryLabel(category: string): string {
  switch (category) {
    case 'payments':
      return 'Pagos';
    case 'messaging':
      return 'Mensajería';
    case 'events':
      return 'Eventos';
    default:
      return category;
  }
}

export type CredentialSlot = {
  id: string;
  label: string;
  masked: string;
  configured: boolean;
  hint: string;
};

/** Solo nombres de variables y máscaras — nunca valores reales. */
export function banorteCredentialSlots(cfg: BanorteConfig | undefined): CredentialSlot[] {
  if (!cfg) {
    return [
      {
        id: 'merchant',
        label: 'Merchant ID',
        masked: '—',
        configured: false,
        hint: 'BANORTE_MERCHANT_ID',
      },
    ];
  }

  const missing = new Set(cfg.validation.missing);
  const merchantOk = !missing.has('BANORTE_MERCHANT_ID') && !cfg.demo;
  const affiliationOk = !missing.has('BANORTE_AFFILIATION');
  const userOk = !missing.has('BANORTE_USER');
  const secretOk = !missing.has('BANORTE_API_SECRET');
  const webhookOk =
    Boolean(cfg.ipn?.webhookSecretConfigured) && !missing.has('BANORTE_WEBHOOK_SECRET');

  return [
    {
      id: 'merchant',
      label: 'Merchant ID',
      masked: merchantOk ? 'bnrt_••••••••' : '— no configurado',
      configured: merchantOk,
      hint: 'BANORTE_MERCHANT_ID',
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
      masked: cfg.accountClabeMasked ?? '— no publicada',
      configured: Boolean(cfg.accountClabeMasked),
      hint: 'BANORTE_ACCOUNT_CLABE · enmascarada',
    },
  ];
}

export function emailCredentialSlots(): CredentialSlot[] {
  return [
    {
      id: 'smtp-host',
      label: 'SMTP host',
      masked: 'Configurado en servidor',
      configured: false,
      hint: 'SMTP_HOST — sin endpoint de lectura',
    },
    {
      id: 'smtp-user',
      label: 'SMTP user',
      masked: '••••••••',
      configured: false,
      hint: 'SMTP_USER — valor nunca expuesto en admin',
    },
    {
      id: 'smtp-pass',
      label: 'SMTP password',
      masked: '••••••••••••••••',
      configured: false,
      hint: 'SMTP_PASSWORD — solo en el worker',
    },
    {
      id: 'mail-from',
      label: 'Remitente',
      masked: 'MAIL_FROM',
      configured: false,
      hint: 'MAIL_FROM — verificar en envíos de prueba',
    },
  ];
}

export function resolveHealth(
  kind: IntegrationKind,
  banorte: BanorteConfig | undefined,
  webhooks: WebhookHealthSnapshot | undefined,
): IntegrationHealth {
  if (kind === 'banorte') return classifyBanorteHealth(banorte);
  if (kind === 'email') return emailIntegrationHealth();
  return webhooks?.health ?? 'unknown';
}

export type IntegrationKpis = {
  catalog: number;
  healthy: number;
  needsSetup: number;
  demoOrUnknown: number;
};

export function computeIntegrationKpis(
  banorte: BanorteConfig | undefined,
  webhooks: WebhookHealthSnapshot | undefined,
): IntegrationKpis {
  const statuses: IntegrationHealth[] = [
    classifyBanorteHealth(banorte),
    emailIntegrationHealth(),
    webhooks?.health ?? 'unknown',
  ];

  return {
    catalog: 3,
    healthy: statuses.filter((s) => s === 'healthy').length,
    needsSetup: statuses.filter((s) => s === 'misconfigured' || s === 'degraded').length,
    demoOrUnknown: statuses.filter((s) => s === 'demo' || s === 'unknown').length,
  };
}

export const METHOD_LABELS: Record<string, string> = {
  CARD: 'Tarjeta',
  SPEI: 'SPEI',
  OXXO: 'OXXO',
};
