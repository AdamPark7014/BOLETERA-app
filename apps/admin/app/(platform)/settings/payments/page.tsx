'use client';

import { useEffect, useState } from 'react';
import { adminApi, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../../_styles/platform.module.scss';
import styles from './payments.module.scss';

type BanorteIpn = {
  webhookUrl: string;
  returnUrlBase: string;
  cancelUrl: string;
  webhookSecretConfigured: boolean;
  signatureHeaders: string[];
  registerHint?: string;
};

type BanorteConfig = {
  gateway: string;
  demo: boolean;
  mode: 'demo' | 'live';
  productionReady: boolean;
  methods: string[];
  settlement: string;
  buyerNote: string;
  accountClabeMasked: string | null;
  validation: {
    ready: boolean;
    demo: boolean;
    missing: string[];
    warnings: string[];
  };
  ipn?: BanorteIpn;
};

type ValidateResult = {
  ready: boolean;
  demo: boolean;
  missing: string[];
  warnings: string[];
  checkedAt?: string;
  ipn?: BanorteIpn;
};

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

  return (
    <div className={styles.wrap}>
      <header className={platform.pageHeader}>
        <div>
          <h1>Pagos Banorte</h1>
          <p>Estado de Payworks, SPEI, IPN y liquidación a cuenta empresarial</p>
        </div>
        <button
          type="button"
          className={platform.primaryBtn}
          disabled={busy}
          onClick={() => void runValidate()}
        >
          {busy ? 'Validando…' : 'Validar setup'}
        </button>
      </header>

      {demoInProduction && (
        <section className={styles.incident} role="alert" aria-labelledby="demo-incident">
          <span className={styles.incidentTag}>Incidente</span>
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
      )}

      {error && <p className={styles.error}>{error}</p>}

      {!cfg && !error && <p className={styles.muted}>Cargando…</p>}

      {cfg && (
        <>
          <section className={platform.panel}>
            <div className={styles.statusRow}>
              <span className={`${styles.pill} ${cfg.demo ? styles.pillWarn : styles.pillOk}`}>
                {cfg.demo ? 'Modo demo' : 'Modo live'}
              </span>
              <span
                className={`${styles.pill} ${cfg.productionReady ? styles.pillOk : styles.pillWarn}`}
              >
                {cfg.productionReady ? 'Listo para producción' : 'Credenciales incompletas'}
              </span>
              {ipn && (
                <span
                  className={`${styles.pill} ${
                    ipn.webhookSecretConfigured ? styles.pillOk : styles.pillWarn
                  }`}
                >
                  {ipn.webhookSecretConfigured ? 'IPN secret OK' : 'IPN secret faltante'}
                </span>
              )}
            </div>
            <p className={styles.settlement}>{cfg.settlement}</p>
            <p className={styles.note}>{cfg.buyerNote}</p>
            {cfg.accountClabeMasked && (
              <p className={styles.meta}>
                CLABE enmascarada: <code>{cfg.accountClabeMasked}</code>
              </p>
            )}
            <p className={styles.meta}>Métodos: {cfg.methods.join(' · ')}</p>
            {validation?.checkedAt && (
              <p className={styles.meta}>
                Última validación: {new Date(validation.checkedAt).toLocaleString('es-MX')}
              </p>
            )}
          </section>

          {ipn && (
            <section className={platform.panel}>
              <h2 className={platform.panelTitle}>IPN / Payworks</h2>
              <p className={styles.note}>
                {ipn.registerHint ||
                  'Registra esta URL en el portal Banorte para confirmar CARD/SPEI/OXXO.'}
              </p>
              <div className={styles.copyRow}>
                <div>
                  <strong className={styles.copyLabel}>Webhook IPN</strong>
                  <code className={styles.copyValue}>{ipn.webhookUrl}</code>
                </div>
                <button
                  type="button"
                  className={platform.ghostBtn}
                  onClick={() => void copyText('Webhook', ipn.webhookUrl)}
                >
                  Copiar
                </button>
              </div>
              <div className={styles.copyRow}>
                <div>
                  <strong className={styles.copyLabel}>Return URL base</strong>
                  <code className={styles.copyValue}>{ipn.returnUrlBase}</code>
                </div>
                <button
                  type="button"
                  className={platform.ghostBtn}
                  onClick={() => void copyText('Return URL', ipn.returnUrlBase)}
                >
                  Copiar
                </button>
              </div>
              <p className={styles.meta}>
                Firmas esperadas: {ipn.signatureHeaders.join(' · ')}
              </p>
              <p className={styles.hint}>
                En producción define <code>API_PUBLIC_URL</code> (origen HTTPS del API) y{' '}
                <code>BANORTE_WEBHOOK_SECRET</code>. Sin secret el IPN se rechaza.
              </p>
            </section>
          )}

          {checklist && (checklist.missing.length > 0 || checklist.warnings.length > 0) && (
            <section className={platform.panel}>
              <h2 className={platform.panelTitle}>Checklist de producción</h2>
              {checklist.missing.length > 0 && (
                <div className={styles.listBlock}>
                  <strong>Faltantes (bloquean live)</strong>
                  <ul>
                    {checklist.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {checklist.warnings.length > 0 && (
                <div className={styles.listBlock}>
                  <strong>Advertencias</strong>
                  <ul>
                    {checklist.warnings.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className={styles.hint}>
                Configura las variables en el servidor (ver <code>.env.example</code>). Sin{' '}
                <code>BANORTE_MERCHANT_ID</code> el API opera en demo y rechaza cobros si{' '}
                <code>NODE_ENV=production</code>.
              </p>
            </section>
          )}

          {checklist && checklist.missing.length === 0 && checklist.warnings.length === 0 && (
            <section className={platform.panel}>
              <h2 className={platform.panelTitle}>Checklist de producción</h2>
              <p className={styles.note}>Sin faltantes ni advertencias en la validación actual.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
