'use client';

import { Suspense, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  StatusDot,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  useBanorteConfig,
  useIntegrationCatalog,
  useValidateBanorteSetup,
  useWebhookHealth,
  type BanorteValidateResult,
  type IntegrationCatalogItem,
  type IntegrationKind,
} from '@/lib/queries/integrations';
import { SetupDrawer } from './_components/SetupDrawer';
import {
  categoryLabel,
  computeIntegrationKpis,
  healthMeta,
  resolveHealth,
} from './_lib/health';
import { useIntegrationsUrlState } from './_lib/use-url-state';
import styles from './integrations.module.scss';

function IntegrationsCockpit() {
  const toast = useToast();
  const url = useIntegrationsUrlState();

  const catalogQuery = useIntegrationCatalog();
  const banorteQuery = useBanorteConfig();
  const webhooksQuery = useWebhookHealth(!banorteQuery.isError);
  const validateBanorte = useValidateBanorteSetup();

  const [validation, setValidation] = useState<BanorteValidateResult | null>(null);

  const catalog = catalogQuery.data ?? [];
  const banorte = banorteQuery.data;
  const webhooks = webhooksQuery.data;

  const kpis = useMemo(
    () => computeIntegrationKpis(banorte, webhooks),
    [banorte, webhooks],
  );

  const selected = useMemo(
    () => catalog.find((item) => item.id === url.selectedId) ?? null,
    [catalog, url.selectedId],
  );

  const filtered = useMemo(() => {
    if (url.filter === 'all') return catalog;
    return catalog.filter((item) => {
      const health = resolveHealth(item.id, banorte, webhooks);
      if (url.filter === 'healthy') return health === 'healthy';
      return health === 'misconfigured' || health === 'degraded' || health === 'demo';
    });
  }, [banorte, catalog, url.filter, webhooks]);

  async function onValidateBanorte() {
    try {
      const result = await validateBanorte.mutateAsync();
      setValidation(result);
      toast.success(
        result.ready && !result.demo
          ? 'Health check OK — Banorte listo'
          : result.demo
            ? 'Health check: entorno demo'
            : 'Health check: configuración incompleta',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo validar Banorte');
    }
  }

  async function onCopy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.info('Copia el valor manualmente');
    }
  }

  function openConnector(id: IntegrationKind) {
    url.setSelectedId(id);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Plataforma · Ecosistema"
        title="Integraciones"
        description="Catálogo de Banorte, email SMTP y webhooks IPN. Salud y setup sin exponer secretos."
        actions={
          <Button
            type="button"
            variant="outline"
            loading={validateBanorte.isPending}
            loadingLabel="Validando…"
            onClick={() => void onValidateBanorte()}
          >
            Health check Banorte
          </Button>
        }
      />

      <Section columns={4} gap="sm" aria-label="Indicadores de integraciones">
        <KpiCard
          label="Conectores"
          value={String(kpis.catalog)}
          loading={catalogQuery.isPending}
          hint="Catálogo documentado"
        />
        <KpiCard
          label="Sanas"
          value={String(kpis.healthy)}
          tone="success"
          loading={banorteQuery.isPending}
          hint="Listas en producción"
        />
        <KpiCard
          label="Requieren setup"
          value={String(kpis.needsSetup)}
          tone={kpis.needsSetup > 0 ? 'warning' : 'neutral'}
          loading={banorteQuery.isPending}
          hint="Mal configuradas o degradadas"
        />
        <KpiCard
          label="Demo / sin telemetría"
          value={String(kpis.demoOrUnknown)}
          tone="info"
          loading={banorteQuery.isPending}
          hint="Email SMTP sin endpoint de salud"
        />
      </Section>

      {banorteQuery.error ? (
        <QueryError
          error={banorteQuery.error}
          onRetry={() => void banorteQuery.refetch()}
        />
      ) : null}

      <div className={styles.layout}>
        <Section
          title="Catálogo"
          description="Conectores con health derivado de APIs reales cuando existen."
        >
          <div className={styles.filters}>
            <SegmentedControl
              label="Filtro de salud"
              size="sm"
              value={url.filter}
              onValueChange={(value) => {
                if (value === 'all' || value === 'needsSetup' || value === 'healthy') {
                  url.setFilter(value);
                }
              }}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'healthy', label: 'Sanos' },
                { value: 'needsSetup', label: 'Setup' },
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="Sin conectores en este filtro"
              description="Cambia el filtro o abre el catálogo completo."
              illustration="search"
              action={
                <Button type="button" variant="secondary" size="sm" onClick={() => url.setFilter('all')}>
                  Ver todos
                </Button>
              }
            />
          ) : (
            <div className={styles.catalog}>
              {filtered.map((item) => (
                <CatalogCard
                  key={item.id}
                  item={item}
                  selected={url.selectedId === item.id}
                  health={resolveHealth(item.id, banorte, webhooks)}
                  onOpen={() => openConnector(item.id)}
                />
              ))}
            </div>
          )}
        </Section>

        <aside className={styles.sideCard}>
          <div className={styles.sideHead}>
            <h2>Salud en vivo</h2>
            <p>Estado por conector</p>
          </div>
          <ul className={styles.healthList}>
            {catalog.map((item) => {
              const health = healthMeta(resolveHealth(item.id, banorte, webhooks));
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.healthRow}
                    onClick={() => openConnector(item.id)}
                  >
                    <StatusDot tone={health.statusTone} aria-hidden />
                    <div>
                      <strong>{item.name}</strong>
                      <span>{categoryLabel(item.category)}</span>
                    </div>
                    <Badge tone={health.tone} variant="outline" size="sm">
                      {health.label}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>

          {webhooks ? (
            <p className={styles.note} style={{ marginTop: '1rem' }}>
              {webhooks.note}
            </p>
          ) : (
            <p className={styles.note} style={{ marginTop: '1rem' }}>
              La salud de webhooks se deriva del IPN Banorte en /payments/config.
            </p>
          )}
        </aside>
      </div>

      <SetupDrawer
        item={selected}
        banorte={banorte}
        webhooks={webhooks}
        validation={validation}
        validating={validateBanorte.isPending}
        onClose={() => url.setSelectedId(null)}
        onValidateBanorte={() => void onValidateBanorte()}
        onCopy={(label, value) => void onCopy(label, value)}
      />
    </div>
  );
}

function CatalogCard({
  item,
  selected,
  health,
  onOpen,
}: {
  item: IntegrationCatalogItem;
  selected: boolean;
  health: ReturnType<typeof resolveHealth>;
  onOpen: () => void;
}) {
  const meta = healthMeta(health);
  return (
    <button
      type="button"
      className={styles.card}
      data-selected={selected ? 'true' : 'false'}
      onClick={onOpen}
    >
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{item.name}</h3>
        <Badge tone={meta.tone} variant="soft" size="sm" dot>
          {meta.label}
        </Badge>
      </div>
      <p className={styles.cardSummary}>{item.summary}</p>
      <div className={styles.cardMeta}>
        <Badge tone="neutral" variant="outline" size="sm">
          {categoryLabel(item.category)}
        </Badge>
        <span className={styles.muted}>Abrir setup</span>
      </div>
    </button>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando integraciones…
        </div>
      }
    >
      <IntegrationsCockpit />
    </Suspense>
  );
}
