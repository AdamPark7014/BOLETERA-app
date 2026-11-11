'use client';

import Link from 'next/link';
import { ParameterCard, TicketButton } from '@boletera/ui';
import type {
  BanorteConfig,
  BanorteValidateResult,
  IntegrationCatalogItem,
  WebhookHealthSnapshot,
} from '@/lib/queries/integrations';
import { Param } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import {
  banorteCredentialSlots,
  categoryLabel,
  emailCredentialSlots,
  healthMeta,
  METHOD_LABELS,
  resolveHealth,
  type CredentialSlot,
} from '../_lib/health';

type ConnectorDetailProps = {
  item: IntegrationCatalogItem;
  banorte: BanorteConfig | undefined;
  webhooks: WebhookHealthSnapshot | undefined;
  validation: BanorteValidateResult | null;
  validating: boolean;
  onValidateBanorte: () => void;
  onCopy: (label: string, value: string) => void;
};

/** Detalle del conector, abierto en acordeón. Solo nombres de variables y máscaras: nunca valores. */
export function ConnectorDetail({
  item,
  banorte,
  webhooks,
  validation,
  validating,
  onValidateBanorte,
  onCopy,
}: ConnectorDetailProps) {
  const health = healthMeta(resolveHealth(item.id, banorte, webhooks));
  const slots =
    item.id === 'banorte'
      ? banorteCredentialSlots(banorte)
      : item.id === 'email'
        ? emailCredentialSlots()
        : [];

  return (
    <div className={styles.stack}>
      <Param name={`Estado ${item.name}`}>
        <ParameterCard
          name="Estado"
          value={health.label}
          effect={`${categoryLabel(item.category)} · ${item.docsHint}`}
        />
      </Param>
      <p className={styles.quiet}>{item.summary}</p>

      <p className={styles.rowTitle}>Pasos</p>
      <ol className={styles.rows} style={{ paddingLeft: 0 }}>
        {item.setupSteps.map((step, index) => (
          <li key={step} className={styles.row}>
            <p className={styles.quiet}>
              {index + 1}. {step}
            </p>
          </li>
        ))}
      </ol>

      {item.id === 'banorte' ? (
        <>
          <p className={styles.rowTitle}>Métodos</p>
          <p className={styles.quiet}>
            {(banorte?.methods ?? [])
              .map((method) => METHOD_LABELS[method] ?? method)
              .join(' · ') || '—'}
          </p>
          {banorte?.settlement ? <p className={styles.tertiary}>{banorte.settlement}</p> : null}

          <p className={styles.rowTitle}>Credenciales enmascaradas</p>
          <CredentialRows slots={slots} />

          {banorte?.ipn?.webhookUrl ? (
            <CopyRow label="URL IPN" value={banorte.ipn.webhookUrl} onCopy={onCopy} />
          ) : null}

          {validation ? (
            <>
              <p className={styles.rowTitle}>Última validación</p>
              <div className={styles.rows}>
                <InfoRow label="Listo" value={validation.ready ? 'Sí' : 'No'} />
                <InfoRow label="Modo" value={validation.demo ? 'Demo' : 'En vivo'} />
                <InfoRow
                  label="Faltantes"
                  value={validation.missing.length > 0 ? validation.missing.join(', ') : 'Ninguno'}
                  mono={validation.missing.length > 0}
                />
                <InfoRow
                  label="Avisos"
                  value={
                    validation.warnings.length > 0 ? validation.warnings.join(', ') : 'Ninguno'
                  }
                />
              </div>
            </>
          ) : null}

          <div>
            <TicketButton variant="ghost" disabled={validating} onClick={onValidateBanorte}>
              {validating ? 'Validando' : 'Validar de nuevo'}
            </TicketButton>
          </div>
          <p className={styles.tertiary}>
            Configuración avanzada en{' '}
            <Link href="/settings/payments" style={{ color: 'var(--text)' }}>
              Pagos Banorte
            </Link>
            .
          </p>
        </>
      ) : null}

      {item.id === 'email' ? (
        <>
          <p className={styles.rowTitle}>Credenciales (solo nombres)</p>
          <p className={styles.tertiary}>
            No hay lectura de salud SMTP. Los valores viven en el worker y nunca se listan aquí.
          </p>
          <CredentialRows slots={slots} />
        </>
      ) : null}

      {item.id === 'webhooks' ? <WebhooksDetail webhooks={webhooks} onCopy={onCopy} /> : null}
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.row}>
      <p className={styles.rowMeta}>{label}</p>
      <span />
      <p
        className={mono ? styles.mono : styles.quiet}
        style={{ textAlign: 'right', overflowWrap: 'anywhere' }}
      >
        {value}
      </p>
    </div>
  );
}

function CredentialRows({ slots }: { slots: CredentialSlot[] }) {
  if (slots.length === 0) return <p className={styles.quiet}>No hay credenciales asociadas.</p>;
  return (
    <ul className={styles.rows}>
      {slots.map((slot) => (
        <li key={slot.id} className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>{slot.label}</p>
            <p className={styles.rowMeta}>{slot.hint}</p>
          </div>
          <p className={styles.mono}>{slot.masked}</p>
          <p className={slot.configured ? styles.quiet : styles.tertiary}>
            {slot.configured ? 'Listo' : 'Pendiente'}
          </p>
        </li>
      ))}
    </ul>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>{label}</p>
        <p className={styles.mono} style={{ overflowWrap: 'anywhere' }}>
          {value}
        </p>
      </div>
      <span />
      <TicketButton variant="ghost" onClick={() => onCopy(label, value)}>
        Copiar
      </TicketButton>
    </div>
  );
}

function WebhooksDetail({
  webhooks,
  onCopy,
}: {
  webhooks: WebhookHealthSnapshot | undefined;
  onCopy: (label: string, value: string) => void;
}) {
  if (!webhooks) {
    return (
      <p className={styles.quiet}>Sin salud de webhooks: falta la lectura de /payments/config.</p>
    );
  }
  const modeLabel =
    webhooks.mode === 'live' ? 'En vivo' : webhooks.mode === 'demo' ? 'Demo' : 'Sin dato';
  return (
    <>
      <p className={styles.rowTitle}>IPN Banorte</p>
      <p className={styles.quiet}>{webhooks.note}</p>
      <div className={styles.rows}>
        <InfoRow label="Estado" value={healthMeta(webhooks.health).label} />
        <InfoRow label="Modo" value={modeLabel} />
        <InfoRow
          label="Secreto de firma"
          value={webhooks.webhookSecretConfigured ? 'Configurado' : 'Faltante'}
        />
        <InfoRow
          label="Encabezados"
          value={webhooks.signatureHeaders.length > 0 ? webhooks.signatureHeaders.join(', ') : '—'}
          mono={webhooks.signatureHeaders.length > 0}
        />
      </div>
      {webhooks.webhookUrl ? (
        <CopyRow label="URL del webhook" value={webhooks.webhookUrl} onCopy={onCopy} />
      ) : null}
      <p className={styles.tertiary}>
        Los webhooks salientes genéricos (order.*) aún no tienen API de conexiones; el catálogo
        documenta el conector Banorte IPN que sí está cableado.
      </p>
    </>
  );
}
