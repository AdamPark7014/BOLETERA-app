'use client';

import Link from 'next/link';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  StatusDot,
} from '@boletera/ui';
import type {
  BanorteConfig,
  BanorteValidateResult,
  IntegrationCatalogItem,
  IntegrationKind,
  WebhookHealthSnapshot,
} from '@/lib/queries/integrations';
import {
  banorteCredentialSlots,
  categoryLabel,
  emailCredentialSlots,
  healthMeta,
  METHOD_LABELS,
  resolveHealth,
} from '../_lib/health';
import styles from '../integrations.module.scss';

type SetupDrawerProps = {
  item: IntegrationCatalogItem | null;
  banorte: BanorteConfig | undefined;
  webhooks: WebhookHealthSnapshot | undefined;
  validation: BanorteValidateResult | null;
  validating: boolean;
  onClose: () => void;
  onValidateBanorte: () => void;
  onCopy: (label: string, value: string) => void;
};

export function SetupDrawer({
  item,
  banorte,
  webhooks,
  validation,
  validating,
  onClose,
  onValidateBanorte,
  onCopy,
}: SetupDrawerProps) {
  if (!item) {
    return (
      <Drawer open={false} onClose={onClose} title="Setup de integración">
        {null}
      </Drawer>
    );
  }

  const health = healthMeta(resolveHealth(item.id, banorte, webhooks));
  const slots =
    item.id === 'banorte'
      ? banorteCredentialSlots(banorte)
      : item.id === 'email'
        ? emailCredentialSlots()
        : [];

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.name}
      description={`${categoryLabel(item.category)} · ${item.docsHint}`}
      size="md"
      footer={
        item.id === 'banorte' ? (
          <div className={styles.modalFooter}>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button
              type="button"
              loading={validating}
              loadingLabel="Validando…"
              onClick={onValidateBanorte}
            >
              Health check
            </Button>
          </div>
        ) : (
          <div className={styles.modalFooter}>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        )
      }
    >
      <div className={styles.drawerBody}>
        <div className={styles.drawerHealth}>
          <StatusDot tone={health.statusTone} aria-hidden />
          <Badge tone={health.tone} variant="soft" size="sm" dot>
            {health.label}
          </Badge>
        </div>

        <p className={styles.summary}>{item.summary}</p>

        <section aria-label="Pasos de setup">
          <h3 className={styles.sectionTitle}>Setup</h3>
          <ol className={styles.steps}>
            {item.setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {item.id === 'banorte' ? (
          <BanortePanel
            banorte={banorte}
            validation={validation}
            slots={slots}
            onCopy={onCopy}
          />
        ) : null}

        {item.id === 'email' ? (
          <section aria-label="Credenciales email">
            <h3 className={styles.sectionTitle}>Credenciales (solo nombres)</h3>
            <p className={styles.muted}>
              No hay GET de salud SMTP. Los valores viven en el worker y nunca se listan aquí.
            </p>
            <CredentialList slots={slots} />
          </section>
        ) : null}

        {item.id === 'webhooks' ? (
          <WebhooksPanel webhooks={webhooks} onCopy={onCopy} />
        ) : null}

        {item.id === 'banorte' ? (
          <p className={styles.muted}>
            Configuración avanzada en{' '}
            <Link href="/settings/payments" className={styles.inlineLink}>
              Pagos Banorte
            </Link>
            .
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

function CredentialList({
  slots,
}: {
  slots: ReturnType<typeof banorteCredentialSlots>;
}) {
  if (slots.length === 0) {
    return (
      <EmptyState
        title="Sin slots"
        description="No hay credenciales asociadas."
        illustration="inbox"
        size="sm"
      />
    );
  }

  return (
    <ul className={styles.credentialList}>
      {slots.map((slot) => (
        <li key={slot.id}>
          <div>
            <strong>{slot.label}</strong>
            <span className={styles.muted}>{slot.hint}</span>
          </div>
          <div className={styles.credentialValue}>
            <code>{slot.masked}</code>
            <Badge
              tone={slot.configured ? 'success' : 'warning'}
              variant="outline"
              size="sm"
            >
              {slot.configured ? 'OK' : 'Pendiente'}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BanortePanel({
  banorte,
  validation,
  slots,
  onCopy,
}: {
  banorte: BanorteConfig | undefined;
  validation: BanorteValidateResult | null;
  slots: ReturnType<typeof banorteCredentialSlots>;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <>
      <section aria-label="Métodos Banorte">
        <h3 className={styles.sectionTitle}>Métodos</h3>
        <div className={styles.chipRow}>
          {(banorte?.methods ?? []).map((method) => (
            <Badge key={method} tone="neutral" variant="outline" size="sm">
              {METHOD_LABELS[method] ?? method}
            </Badge>
          ))}
        </div>
        <p className={styles.muted}>{banorte?.settlement}</p>
      </section>

      <section aria-label="Credenciales Banorte">
        <h3 className={styles.sectionTitle}>Credenciales enmascaradas</h3>
        <CredentialList slots={slots} />
      </section>

      {banorte?.ipn?.webhookUrl ? (
        <section aria-label="URL IPN">
          <h3 className={styles.sectionTitle}>URL IPN</h3>
          <div className={styles.copyRow}>
            <code>{banorte.ipn.webhookUrl}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onCopy('URL IPN', banorte.ipn!.webhookUrl)}
            >
              Copiar
            </Button>
          </div>
        </section>
      ) : null}

      {validation ? (
        <section aria-label="Última validación">
          <h3 className={styles.sectionTitle}>Último health check</h3>
          <dl className={styles.metaList}>
            <div>
              <dt>Listo</dt>
              <dd>{validation.ready ? 'Sí' : 'No'}</dd>
            </div>
            <div>
              <dt>Modo</dt>
              <dd>{validation.demo ? 'Demo' : 'Live'}</dd>
            </div>
            <div>
              <dt>Faltantes</dt>
              <dd>
                {validation.missing.length > 0
                  ? validation.missing.join(', ')
                  : 'Ninguno'}
              </dd>
            </div>
            <div>
              <dt>Avisos</dt>
              <dd>
                {validation.warnings.length > 0
                  ? validation.warnings.join(', ')
                  : 'Ninguno'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </>
  );
}

function WebhooksPanel({
  webhooks,
  onCopy,
}: {
  webhooks: WebhookHealthSnapshot | undefined;
  onCopy: (label: string, value: string) => void;
}) {
  if (!webhooks) {
    return (
      <EmptyState
        title="Sin salud de webhooks"
        description="Carga /payments/config para ver el estado del IPN Banorte."
        illustration="inbox"
        size="sm"
      />
    );
  }

  const health = healthMeta(webhooks.health);

  return (
    <section aria-label="Salud de webhooks">
      <h3 className={styles.sectionTitle}>IPN Banorte</h3>
      <div className={styles.drawerHealth}>
        <StatusDot tone={health.statusTone} aria-hidden />
        <Badge tone={health.tone} variant="soft" size="sm" dot>
          {health.label}
        </Badge>
        <span className={styles.muted}>{webhooks.mode}</span>
      </div>
      <p className={styles.muted}>{webhooks.note}</p>

      <dl className={styles.metaList}>
        <div>
          <dt>Secreto firmado</dt>
          <dd>{webhooks.webhookSecretConfigured ? 'Configurado' : 'Faltante'}</dd>
        </div>
        <div>
          <dt>Headers</dt>
          <dd>
            {webhooks.signatureHeaders.length > 0
              ? webhooks.signatureHeaders.join(', ')
              : '—'}
          </dd>
        </div>
      </dl>

      {webhooks.webhookUrl ? (
        <div className={styles.copyRow}>
          <code>{webhooks.webhookUrl}</code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCopy('Webhook URL', webhooks.webhookUrl!)}
          >
            Copiar
          </Button>
        </div>
      ) : null}

      <p className={styles.muted}>
        Webhooks salientes genéricos (order.*) aún no tienen API de conexiones; el catálogo
        documenta el conector Banorte IPN que sí está cableado.
      </p>
    </section>
  );
}

export type { IntegrationKind };
