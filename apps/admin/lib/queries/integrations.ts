'use client';

/**
 * Integraciones — Banorte (config real), email (SMTP servidor) y webhooks IPN.
 * Los secretos nunca viajan en claro: solo flags booleans y valores enmascarados.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

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

export type BanorteValidateResult = BanorteValidation & {
  checkedAt?: string;
  ipn?: BanorteIpn;
};

export type IntegrationKind = 'banorte' | 'email' | 'webhooks';

export type IntegrationHealth =
  | 'healthy'
  | 'degraded'
  | 'misconfigured'
  | 'demo'
  | 'unknown'
  | 'unavailable';

export type IntegrationCatalogItem = {
  id: IntegrationKind;
  name: string;
  category: 'payments' | 'messaging' | 'events';
  summary: string;
  docsHint: string;
  setupSteps: readonly string[];
};

/** Catálogo estático de conectores soportados / documentados. */
export const INTEGRATION_CATALOG: readonly IntegrationCatalogItem[] = [
  {
    id: 'banorte',
    name: 'Banorte Payworks',
    category: 'payments',
    summary: 'Cobro con tarjeta, SPEI y OXXO hacia la cuenta del promotor.',
    docsHint: 'GET /payments/config · GET /payments/config/validate',
    setupSteps: [
      'Configura BANORTE_MERCHANT_ID, BANORTE_AFFILIATION, BANORTE_USER y BANORTE_API_SECRET en el servidor.',
      'Registra la URL IPN en el portal Payworks.',
      'Define BANORTE_WEBHOOK_SECRET para firmas.',
      'Ejecuta el health check desde esta pantalla.',
    ],
  },
  {
    id: 'email',
    name: 'Email transaccional (SMTP)',
    category: 'messaging',
    summary: 'Confirmaciones, PDF de boletos, reembolsos y avisos de payout.',
    docsHint: 'Variables SMTP_* / MAIL_FROM en el worker — sin endpoint de salud público.',
    setupSteps: [
      'Define SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASSWORD en el servidor (valores nunca expuestos aquí).',
      'Configura MAIL_FROM con un remitente verificado.',
      'Verifica el envío reenviando el correo de una orden de prueba.',
    ],
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    category: 'events',
    summary: 'IPN Banorte firmado y endpoints de retorno/cancelación.',
    docsHint: 'POST /payments/webhooks/banorte · secret solo como booleano configurado.',
    setupSteps: [
      'Copia la URL IPN pública (sin secretos).',
      'Regístrala en Banorte Payworks.',
      'Confirma que el webhook secret está marcado como configurado.',
      'Valida firmas con los headers publicados.',
    ],
  },
] as const;

export type WebhookHealthSnapshot = {
  banorteIpnConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookUrl: string | null;
  signatureHeaders: string[];
  mode: 'demo' | 'live' | 'unknown';
  health: IntegrationHealth;
  checkedAt: string;
  note: string;
};

export function useIntegrationCatalog() {
  return useQuery({
    queryKey: queryKeys.integrations.catalog(),
    queryFn: async (): Promise<readonly IntegrationCatalogItem[]> => INTEGRATION_CATALOG,
    staleTime: Infinity,
  });
}

export function useBanorteConfig(enabled = true) {
  return useQuery({
    queryKey: queryKeys.integrations.banorteConfig(),
    queryFn: ({ signal }) =>
      http<BanorteConfig>('/payments/config', { signal, auth: false }),
    enabled,
    staleTime: 60_000,
  });
}

export function useValidateBanorteSetup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => http<BanorteValidateResult>('/payments/config/validate'),
    onSuccess: (result) => {
      client.setQueryData<BanorteConfig>(queryKeys.integrations.banorteConfig(), (current) => {
        if (!current) return current;
        return {
          ...current,
          validation: {
            ready: result.ready,
            demo: result.demo,
            missing: result.missing,
            warnings: result.warnings,
          },
          ipn: result.ipn ?? current.ipn,
          productionReady: result.ready && !result.demo,
          demo: result.demo,
          mode: result.demo ? 'demo' : 'live',
        };
      });
      void client.invalidateQueries({ queryKey: queryKeys.integrations.webhookHealth() });
    },
  });
}

export function useWebhookHealth(enabled = true) {
  const banorte = useBanorteConfig(enabled);

  return useQuery({
    queryKey: [
      ...queryKeys.integrations.webhookHealth(),
      banorte.dataUpdatedAt,
    ],
    queryFn: (): WebhookHealthSnapshot => {
      const cfg = banorte.data;
      const now = new Date().toISOString();
      if (!cfg) {
        return {
          banorteIpnConfigured: false,
          webhookSecretConfigured: false,
          webhookUrl: null,
          signatureHeaders: [],
          mode: 'unknown',
          health: 'unknown',
          checkedAt: now,
          note: 'Sin datos de /payments/config.',
        };
      }

      const secretOk = Boolean(cfg.ipn?.webhookSecretConfigured);
      const url = cfg.ipn?.webhookUrl ?? null;
      let health: IntegrationHealth = 'healthy';
      if (cfg.demo) health = 'demo';
      else if (!secretOk || !cfg.validation.ready) health = 'misconfigured';
      else if (cfg.validation.warnings.length > 0) health = 'degraded';

      return {
        banorteIpnConfigured: Boolean(url),
        webhookSecretConfigured: secretOk,
        webhookUrl: url,
        signatureHeaders: cfg.ipn?.signatureHeaders ?? [],
        mode: cfg.mode,
        health,
        checkedAt: now,
        note: cfg.demo
          ? 'Entorno demo: IPN disponible para pruebas sin liquidación real.'
          : secretOk
            ? 'IPN Banorte con secreto de firma configurado (valor no expuesto).'
            : 'Falta BANORTE_WEBHOOK_SECRET en el servidor.',
      };
    },
    enabled: enabled && !banorte.isPending && Boolean(banorte.data),
    staleTime: 30_000,
  });
}

export function classifyBanorteHealth(cfg: BanorteConfig | undefined): IntegrationHealth {
  if (!cfg) return 'unknown';
  if (cfg.demo) return 'demo';
  if (cfg.productionReady && cfg.ipn?.webhookSecretConfigured) return 'healthy';
  if (!cfg.validation.ready) return 'misconfigured';
  if (cfg.validation.warnings.length > 0 || !cfg.ipn?.webhookSecretConfigured) {
    return 'degraded';
  }
  return 'healthy';
}

/** Email: no hay endpoint de salud; estado honesto. */
export function emailIntegrationHealth(): IntegrationHealth {
  return 'unknown';
}
