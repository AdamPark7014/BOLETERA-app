'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  KpiCard,
  PageHeader,
  Section,
  type BadgeTone,
} from '@boletera/ui';
import { adminApi, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  buildCredentialRows,
  envLabel,
  envTone,
  methodEnabled,
  methodHint,
  methodLabel,
  type BanorteConfig,
  type ValidateResult,
} from './payments-utils';
import styles from './payments.module.scss';

function badgeTone(ok: boolean, warn = false): BadgeTone {
  if (ok) return 'success';
  if (warn) return 'warning';
  return 'danger';
}

export default function PaymentsSettingsPage() {
  const [cfg, setCfg] = useState<BanorteConfig | null>(null);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function loadPublic() {
    const token = getStoredToken();
    if (!token) return;
    try {
      setError('');
      const publicCfg = await adminApi<BanorteConfig>('/payments/config', token);
      setCfg(publicCfg);
    } catch {
      setError('No se pudo cargar el estado de Banorte');
    }
  }

  useEffect(() => {
    void loadPublic();
  }, []);

  async function runValidate() {
    const token = getStoredToken();
    if (!token) return;
    setBusy(true);
    try {
      const result = await adminApi<ValidateResult>('/payments/config/validate', token);
      setValidation(result);
      if (cfg) {
        setCfg({
          ...cfg,
          validation: {
            ready: result.ready,
            demo: result.demo,
            missing: result.missing,
            warnings: result.warnings,
          },
          ipn: result.ipn ?? cfg.ipn,
          productionReady: result.ready && !result.demo,
        });
      }
      toast.success(
        result.ready && !result.demo
          ? 'Setup Banorte listo para producción'
          : result.demo
            ? 'Modo demo — faltan credenciales live'
            : 'Hay variables faltantes o advertencias',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo validar');
    } finally {
      setBusy(false);
    }
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('No se pudo copiar');
    }
  }

  const checklist = validation ?? cfg?.validation;
  const ipn = validation?.ipn ?? cfg?.ipn;

  const credentialRows = useMemo(() => {
    if (!cfg || !checklist) return [];
    return buildCredentialRows(cfg, checklist);
  }, [cfg, checklist]);

  /**
   * Modo demo fuera de local es un incidente, no un ajuste pendiente: el
   * checkout acepta pagos que nunca llegan a Banorte. Se detecta por el host
   * porque el admin no conoce el `NODE_ENV` del API; con eso basta para que
   * nadie descubra el problema por el estado de cuenta.
   */
  const runningOffLocalhost =
    typeof window !== 'undefined' &&
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const demoInProduction = Boolean(cfg?.demo) && runningOffLocalhost;

  const configuredCount = credentialRows.filter((row) => row.configured).length;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Configuración"
        title="Pagos Banorte"
        description="Estado de Payworks, SPEI, IPN y liquidación a cuenta empresarial."
        actions={
          <Button
            type="button"
            loading={busy}
            loadingLabel="Validando…"
            disabled={!cfg}
            onClick={() => void runValidate()}
          >
            Validar setup
          </Button>
        }
      />

      {demoInProduction ? (
        <section className={styles.incident} role="alert" aria-labelledby="demo-incident">
          <Badge tone="danger" variant="solid" size="sm">
            Incidente
          </Badge>
          <h2 id="demo-incident">La pasarela está en modo demo fuera de local</h2>
          <p>
            Este admin no corre en <code>localhost</code>, pero el API responde que Banorte opera en
            demo. Ninguna orden pagada aquí llega a Banorte: los cobros son simulados y no habrá
            liquidación.
          </p>
          <ul>
            <li>
              Define <code>BANORTE_MERCHANT_ID</code> y el resto de credenciales live en el servidor
              del API.
            </li>
            <li>
              Define <code>BANORTE_WEBHOOK_SECRET</code>: sin él el IPN se rechaza y las órdenes
              quedan pendientes.
            </li>
            <li>Vuelve a validar el setup y confirma que el modo pasa a live antes de vender.</li>
          </ul>
        </section>
      ) : null}

      {error ? (
        <EmptyState
          title="No se pudo cargar la configuración"
          description={error}
          action={
            <Button type="button" variant="outline" onClick={() => void loadPublic()}>
              Reintentar
            </Button>
          }
        />
      ) : null}

      {!cfg && !error ? (
        <p className={styles.loading} role="status">
          Cargando configuración de pagos…
        </p>
      ) : null}

      {cfg ? (
        <>
          <Section columns={4} gap="sm" aria-label="Indicadores de la pasarela">
            <KpiCard
              label="Entorno"
              value={cfg.demo ? 'Demo' : 'Live'}
              hint={envLabel(cfg)}
              tone={envTone(cfg)}
            />
            <KpiCard
              label="Producción"
              value={cfg.productionReady ? 'Lista' : 'Incompleta'}
              hint={
                cfg.productionReady
                  ? 'Credenciales validadas'
                  : 'Faltan variables en el servidor'
              }
              tone={cfg.productionReady ? 'success' : 'warning'}
            />
            <KpiCard
              label="IPN secret"
              value={ipn?.webhookSecretConfigured ? 'Configurado' : 'Faltante'}
              hint="BANORTE_WEBHOOK_SECRET"
              tone={ipn?.webhookSecretConfigured ? 'success' : 'warning'}
            />
            <KpiCard
              label="Credenciales"
              value={`${configuredCount}/${credentialRows.length}`}
              hint="Slots configurados en el API"
              tone={
                configuredCount === credentialRows.length
                  ? 'success'
                  : configuredCount > 0
                    ? 'warning'
                    : 'danger'
              }
            />
          </Section>

          <Section
            title="Estado del gateway"
            description="Liquidación, métodos habilitados y última validación."
          >
            <div className={styles.statusBadges}>
              <Badge tone={cfg.demo ? 'warning' : 'success'} variant="soft" dot>
                {cfg.demo ? 'Modo demo' : 'Modo live'}
              </Badge>
              <Badge
                tone={badgeTone(cfg.productionReady, !cfg.demo && !cfg.productionReady)}
                variant="soft"
                dot
              >
                {cfg.productionReady ? 'Listo para producción' : 'Credenciales incompletas'}
              </Badge>
              {ipn ? (
                <Badge
                  tone={ipn.webhookSecretConfigured ? 'success' : 'warning'}
                  variant="soft"
                  dot
                >
                  {ipn.webhookSecretConfigured ? 'IPN secret OK' : 'IPN secret faltante'}
                </Badge>
              ) : null}
            </div>

            <div className={styles.summaryCard}>
              <p className={styles.settlement}>{cfg.settlement}</p>
              <p className={styles.note}>{cfg.buyerNote}</p>
              {cfg.accountClabeMasked ? (
                <p className={styles.meta}>
                  CLABE enmascarada: <code>{cfg.accountClabeMasked}</code>
                </p>
              ) : null}
              <p className={styles.meta}>Métodos: {cfg.methods.map(methodLabel).join(' · ')}</p>
              {validation?.checkedAt ? (
                <p className={styles.meta}>
                  Última validación:{' '}
                  {new Date(validation.checkedAt).toLocaleString('es-MX')}
                </p>
              ) : null}
            </div>
          </Section>

          {checklist ? (
            <Section
              title="Credenciales del servidor"
              description="Solo se muestra el estado — los secretos nunca salen del API."
              columns={2}
              gap="md"
            >
              {credentialRows.map((row) => (
                <Input
                  key={row.id}
                  label={row.label}
                  value={row.masked}
                  readOnly
                  hint={row.hint}
                  trailing={
                    <Badge
                      tone={row.configured ? 'success' : 'warning'}
                      variant="soft"
                      size="sm"
                      dot={row.configured}
                    >
                      {row.configured ? 'OK' : 'Pendiente'}
                    </Badge>
                  }
                />
              ))}
            </Section>
          ) : null}

          {cfg.methods.length > 0 && checklist ? (
            <Section title="Métodos de pago" columns={3} gap="md">
              {cfg.methods.map((method) => {
                const status = methodEnabled(method, cfg, checklist);
                return (
                  <article key={method} className={styles.methodCard}>
                    <div className={styles.methodHead}>
                      <h3>{methodLabel(method)}</h3>
                      <Badge
                        tone={status.enabled ? 'success' : 'warning'}
                        variant="soft"
                        size="sm"
                        dot={status.enabled}
                      >
                        {status.enabled ? 'Habilitado' : 'Restringido'}
                      </Badge>
                    </div>
                    <p className={styles.methodHint}>{methodHint(method)}</p>
                    <p className={styles.methodReason}>{status.reason}</p>
                  </article>
                );
              })}
            </Section>
          ) : null}

          {ipn ? (
            <Section
              title="IPN / Payworks"
              description={
                ipn.registerHint ||
                'Registra estas URLs en el portal Banorte para confirmar CARD, SPEI y OXXO.'
              }
            >
              <div className={styles.urlFields}>
                <Input
                  label="Webhook IPN"
                  value={ipn.webhookUrl}
                  readOnly
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyText('Webhook', ipn.webhookUrl)}
                    >
                      Copiar
                    </Button>
                  }
                />
                <Input
                  label="Return URL base"
                  value={ipn.returnUrlBase}
                  readOnly
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyText('Return URL', ipn.returnUrlBase)}
                    >
                      Copiar
                    </Button>
                  }
                />
                {ipn.cancelUrl ? (
                  <Input
                    label="Cancel URL"
                    value={ipn.cancelUrl}
                    readOnly
                    trailing={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copyText('Cancel URL', ipn.cancelUrl)}
                      >
                        Copiar
                      </Button>
                    }
                  />
                ) : null}
              </div>
              <p className={styles.meta}>
                Firmas esperadas: {ipn.signatureHeaders.join(' · ')}
              </p>
              <p className={styles.hint}>
                En producción define <code>API_PUBLIC_URL</code> (origen HTTPS del API) y{' '}
                <code>BANORTE_WEBHOOK_SECRET</code>. Sin secret el IPN se rechaza.
              </p>
            </Section>
          ) : null}

          {checklist ? (
            <Section title="Checklist de producción">
              {checklist.missing.length > 0 ? (
                <div className={styles.listBlock}>
                  <strong>Faltantes (bloquean live)</strong>
                  <ul>
                    {checklist.missing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {checklist.warnings.length > 0 ? (
                <div className={styles.listBlock}>
                  <strong>Advertencias</strong>
                  <ul>
                    {checklist.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {checklist.missing.length === 0 && checklist.warnings.length === 0 ? (
                <p className={styles.note}>
                  Sin faltantes ni advertencias en la validación actual.
                </p>
              ) : null}
              <p className={styles.hint}>
                Configura las variables en el servidor (ver <code>.env.example</code>). Sin{' '}
                <code>BANORTE_MERCHANT_ID</code> el API opera en demo y rechaza cobros si{' '}
                <code>NODE_ENV=production</code>.
              </p>
            </Section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
