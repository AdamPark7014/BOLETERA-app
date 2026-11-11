'use client';

import { Suspense, useMemo, useState } from 'react';
import { TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import {
  useBanorteConfig,
  useIntegrationCatalog,
  useValidateBanorteSetup,
  useWebhookHealth,
  type BanorteValidateResult,
} from '@/lib/queries/integrations';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount } from '../events/_ticket/read';
import { ConnectorDetail } from './_components/ConnectorDetail';
import { categoryLabel, computeIntegrationKpis, healthMeta, resolveHealth } from './_lib/health';
import { useIntegrationsUrlState, type IntegrationsUrlState } from './_lib/use-url-state';

function failMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error) return cause.message;
  return fallback;
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <IntegracionesBody />
      </AdminFrame>
    </Suspense>
  );
}

function IntegracionesBody() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando integraciones.</p>;
  return <Integraciones />;
}

function Integraciones() {
  const url = useIntegrationsUrlState();
  const catalogQuery = useIntegrationCatalog();
  const banorteQuery = useBanorteConfig();
  const webhooksQuery = useWebhookHealth(!banorteQuery.isError);
  const validateBanorte = useValidateBanorteSetup();
  const [validation, setValidation] = useState<BanorteValidateResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const catalog = catalogQuery.data ?? [];
  const banorte = banorteQuery.data;
  const webhooks = webhooksQuery.data;
  const kpis = useMemo(() => computeIntegrationKpis(banorte, webhooks), [banorte, webhooks]);

  const filtered = useMemo(() => {
    if (url.filter === 'all') return catalog;
    return catalog.filter((item) => {
      const health = resolveHealth(item.id, banorte, webhooks);
      if (url.filter === 'healthy') return health === 'healthy';
      return health === 'misconfigured' || health === 'degraded' || health === 'demo';
    });
  }, [banorte, catalog, url.filter, webhooks]);

  const refreshing = catalogQuery.isFetching || banorteQuery.isFetching || webhooksQuery.isFetching;
  const pendingHealth = banorteQuery.isPending;

  function refreshAll() {
    setNotice(null);
    void catalogQuery.refetch();
    void banorteQuery.refetch();
    void webhooksQuery.refetch();
  }

  async function onValidateBanorte() {
    setNotice(null);
    setActionError(null);
    try {
      const result = await validateBanorte.mutateAsync();
      setValidation(result);
      setNotice(
        result.ready && !result.demo
          ? 'Validación en orden: Banorte listo.'
          : result.demo
            ? 'Validación: entorno demo.'
            : 'Validación: configuración incompleta.'
      );
    } catch (cause) {
      setActionError(failMessage(cause, 'No se pudo validar Banorte.'));
    }
  }

  async function onCopy(label: string, value: string) {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copiado.`);
    } catch {
      setNotice('Copia el valor a mano.');
    }
  }

  const figures = [
    {
      label: 'Conectores',
      meta: 'Catálogo documentado',
      value: kpis.catalog,
      wait: catalogQuery.isPending,
    },
    { label: 'Sanas', meta: 'Listas en producción', value: kpis.healthy, wait: pendingHealth },
    {
      label: 'Requieren ajuste',
      meta: 'Mal configuradas o degradadas',
      value: kpis.needsSetup,
      wait: pendingHealth,
    },
    {
      label: 'Demo o sin telemetría',
      meta: 'El correo SMTP no tiene lectura de salud',
      value: kpis.demoOrUnknown,
      wait: pendingHealth,
    },
  ];

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Integraciones</h1>
        <p className={styles.quiet}>
          Banorte, correo SMTP y webhooks IPN. Salud y pasos de configuración sin mostrar secretos.
        </p>
      </header>

      <div className={styles.stack}>
        <div className={styles.rows}>
          {figures.map((item) => (
            <div key={item.label} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{item.label}</p>
                <p className={styles.rowMeta}>{item.meta}</p>
              </div>
              <span />
              <p className={styles.figure}>{item.wait ? '—' : formatCount(item.value)}</p>
            </div>
          ))}
        </div>
        <p className={styles.tertiary}>
          Banorte y los webhooks IPN leen el API real; el correo SMTP sale como sin telemetría
          porque no hay lectura de salud. Valida Banorte antes de activar cobros en producción.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <TicketButton
            variant="secondary"
            disabled={validateBanorte.isPending}
            onClick={() => void onValidateBanorte()}
          >
            {validateBanorte.isPending ? 'Validando' : 'Validar Banorte'}
          </TicketButton>
          <TicketButton variant="ghost" disabled={refreshing} onClick={refreshAll}>
            {refreshing ? 'Actualizando' : 'Actualizar'}
          </TicketButton>
        </div>
        {actionError ? (
          <p className={styles.danger} role="alert">
            {actionError}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.quiet} role="status">
            {notice}
          </p>
        ) : null}
      </div>

      {banorteQuery.error ? (
        <div style={{ marginTop: 24 }}>
          <ApiErrorView
            error={banorteQuery.error}
            context="leer la configuración de Banorte"
            onRetry={() => void banorteQuery.refetch()}
          />
        </div>
      ) : null}

      <header className={styles.sectionHead} style={{ marginTop: 24 }}>
        <p className={styles.rowTitle}>Catálogo</p>
        <p className={styles.tertiary}>
          {formatCount(filtered.length)} de {formatCount(catalog.length)} conectores
          {url.filter !== 'all' ? ' con ese filtro' : ''}.
        </p>
      </header>
      <div className={styles.stack}>
        <Segment<IntegrationsUrlState['filter']>
          label="Filtro de salud"
          value={url.filter}
          onChange={url.setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'healthy', label: 'Sanos' },
            { value: 'needsSetup', label: 'Por ajustar' },
          ]}
        />
        {filtered.length === 0 ? <p className={styles.quiet}>Nada con ese criterio.</p> : null}
        {filtered.map((item) => {
          const open = url.selectedId === item.id;
          const health = healthMeta(resolveHealth(item.id, banorte, webhooks));
          return (
            <div key={item.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => url.setSelectedId(open ? null : item.id)}
              >
                <span>
                  {item.name} · {categoryLabel(item.category)}
                </span>
                <span className={styles.tertiary}>{health.label}</span>
              </button>
              {open ? (
                <ConnectorDetail
                  item={item}
                  banorte={banorte}
                  webhooks={webhooks}
                  validation={validation}
                  validating={validateBanorte.isPending}
                  onValidateBanorte={() => void onValidateBanorte()}
                  onCopy={(label, value) => void onCopy(label, value)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
