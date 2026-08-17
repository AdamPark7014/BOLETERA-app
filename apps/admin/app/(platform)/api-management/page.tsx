'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  KpiCard,
  Modal,
  PageHeader,
  Section,
  SegmentedControl,
  StatusDot,
  formatDateTime,
  formatNumber,
  type ActivityItem,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { useAuditLog } from '@/lib/queries/audit';
import {
  useApiManagementKeys,
  useCreateManagedApiKey,
  useQuotaTemplates,
  useRevokeManagedApiKey,
  useRotateManagedApiKey,
  useApiUsageSummary,
  type ApiKey,
} from '@/lib/queries/api-management';
import { useSession } from '@/lib/use-session';
import { CreateKeyModal, type CreateKeyPayload } from './_components/CreateKeyModal';
import { KeyDetailDrawer } from './_components/KeyDetailDrawer';
import { formatCount, relativePast } from './_lib/format';
import {
  buildKeyAlerts,
  classifyKey,
  computeApiKpis,
  HEALTH_FILTER_OPTIONS,
  keyHealthMeta,
  matchesHealth,
  matchesQuery,
  rateLimitBuckets,
  scopeDistribution,
} from './_lib/keys';
import { isWriteScope, scopeLabel } from './_lib/scopes';
import { useApiManagementUrlState } from './_lib/use-url-state';
import styles from './api-management.module.scss';

function auditLabel(action: string): { verb: string; detail?: string } {
  switch (action) {
    case 'API_KEY_CREATED':
      return { verb: 'creó la clave', detail: 'API key' };
    case 'API_KEY_REVOKED':
      return { verb: 'revocó la clave', detail: 'API key' };
    default:
      return { verb: action.toLowerCase().replaceAll('_', ' ') };
  }
}

function ApiManagementCockpit() {
  const { organizationId } = useSession();
  const toast = useToast();
  const url = useApiManagementUrlState();
  const deferredQ = useDeferredValue(url.q);

  const keysQuery = useApiManagementKeys(organizationId);
  const auditQuery = useAuditLog(organizationId, 40);
  const quotasQuery = useQuotaTemplates();
  const createKey = useCreateManagedApiKey(organizationId ?? '');
  const revokeKey = useRevokeManagedApiKey(organizationId ?? '');
  const rotateKey = useRotateManagedApiKey(organizationId ?? '');

  const [now, setNow] = useState(() => Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const usageQuery = useApiUsageSummary(organizationId, now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const keys = keysQuery.data ?? [];
  const kpis = useMemo(() => computeApiKpis(keys, now), [keys, now]);
  const alerts = useMemo(() => buildKeyAlerts(keys, now), [keys, now]);
  const scopes = useMemo(() => scopeDistribution(keys), [keys]);
  const buckets = useMemo(() => rateLimitBuckets(keys), [keys]);

  const filtered = useMemo(
    () =>
      keys.filter(
        (key) => matchesHealth(key, url.health, now) && matchesQuery(key, deferredQ),
      ),
    [deferredQ, keys, now, url.health],
  );

  const selected = useMemo(
    () => (url.selectedId ? keys.find((key) => key.id === url.selectedId) ?? null : null),
    [keys, url.selectedId],
  );

  const activityItems = useMemo<ActivityItem[]>(() => {
    const entries = (auditQuery.data ?? []).filter(
      (entry) => entry.entityType === 'ApiKey' || entry.action.startsWith('API_KEY_'),
    );
    return entries.slice(0, 12).map((entry) => {
      const meta = entry.metadata ?? {};
      const name =
        typeof meta.name === 'string'
          ? meta.name
          : typeof meta.keyPrefix === 'string'
            ? String(meta.keyPrefix)
            : entry.entityId.slice(0, 8);
      const labels = auditLabel(entry.action);
      return {
        id: entry.id,
        actor: 'Administración',
        action: labels.verb,
        target: name,
        timestamp: entry.createdAt,
        detail: labels.detail,
      };
    });
  }, [auditQuery.data]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'health',
        label: 'Estado',
        multiple: false,
        options: HEALTH_FILTER_OPTIONS.filter((option) => option.value !== 'all').map(
          (option) => ({ value: option.value, label: option.label }),
        ),
      },
    ],
    [],
  );

  async function onCreate(payload: CreateKeyPayload) {
    if (!organizationId) return;
    const created = await createKey.mutateAsync({
      name: payload.name,
      scopes: payload.scopes,
      rateLimit: payload.rateLimit,
      expiresInDays: payload.expiresInDays,
    });
    setSecret({ value: created.secret, name: payload.name });
    setCreateOpen(false);
    toast.success('API key generada');
  }

  async function onRevoke() {
    if (!revokeTarget || !organizationId) return;
    setBusyId(revokeTarget.id);
    try {
      await revokeKey.mutateAsync(revokeTarget.id);
      toast.success(`Clave «${revokeTarget.name}» revocada`);
      setRevokeTarget(null);
      if (url.selectedId === revokeTarget.id) url.setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo revocar');
    } finally {
      setBusyId(null);
    }
  }

  async function onRotate() {
    if (!rotateTarget || !organizationId) return;
    setBusyId(rotateTarget.id);
    try {
      const created = await rotateKey.mutateAsync(rotateTarget);
      setSecret({ value: created.secret, name: rotateTarget.name });
      toast.success('Rotación completada — copia el nuevo secreto');
      setRotateTarget(null);
      if (url.selectedId === rotateTarget.id) url.setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo rotar la clave');
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      toast.success('Secreto copiado al portapapeles');
    } catch {
      toast.info('Copia el secreto manualmente');
    }
  }

  const columns: DataTableColumn<ApiKey>[] = [
    {
      key: 'name',
      header: 'Clave',
      width: 220,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className={styles.keyMeta}>
          <strong>{row.name}</strong>
          <code>{row.keyPrefix}…</code>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 150,
      sortValue: (row) => classifyKey(row, now),
      render: (row) => {
        const health = keyHealthMeta(classifyKey(row, now));
        return (
          <Badge tone={health.tone} variant="soft" size="sm" dot>
            {health.label}
          </Badge>
        );
      },
    },
    {
      key: 'scopes',
      header: 'Scopes',
      width: 240,
      render: (row) => (
        <div className={styles.scopes}>
          {row.scopes.slice(0, 3).map((scope) => (
            <Badge
              key={scope}
              tone={isWriteScope(scope) ? 'warning' : 'neutral'}
              variant="outline"
              size="sm"
            >
              {scopeLabel(scope)}
            </Badge>
          ))}
          {row.scopes.length > 3 ? (
            <Badge tone="neutral" variant="soft" size="sm">
              +{row.scopes.length - 3}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'rateLimit',
      header: 'Límite/min',
      width: 110,
      align: 'right',
      sortValue: (row) => row.rateLimit,
      render: (row) => formatNumber(row.rateLimit),
    },
    {
      key: 'lastUsedAt',
      header: 'Último uso',
      width: 130,
      sortValue: (row) => (row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0),
      render: (row) => (
        <span
          className={styles.muted}
          title={row.lastUsedAt ? formatDateTime(row.lastUsedAt) : undefined}
        >
          {relativePast(row.lastUsedAt, now)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      width: 180,
      resizable: false,
      render: (row) =>
        row.active ? (
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyId === row.id}
              onClick={(event) => {
                event.stopPropagation();
                setRotateTarget(row);
              }}
            >
              Rotar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyId === row.id}
              onClick={(event) => {
                event.stopPropagation();
                setRevokeTarget(row);
              }}
            >
              Revocar
            </Button>
          </div>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
  ];

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
          illustration="error"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Plataforma · Developer"
        title="Gestión de API"
        description="Llaves, scopes, rate limits y rotación segura. El secreto solo se revela una vez al crear o rotar."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Nueva API key
          </Button>
        }
      />

      {secret ? (
        <div className={styles.secretBanner} role="status" aria-live="polite">
          <h2>Copia el secreto ahora — «{secret.name}»</h2>
          <p>
            No volverá a mostrarse. Guárdalo en tu vault antes de cerrar este aviso. Tras
            «Entendido» desaparece de la UI.
          </p>
          <div className={styles.secretBox}>
            <code>{secret.value}</code>
            <Button type="button" size="sm" variant="secondary" onClick={() => void copySecret()}>
              Copiar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Entendido
            </Button>
          </div>
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className={styles.alerts} aria-label="Alertas de API">
          {alerts.map((alert) => (
            <div key={alert.id} className={styles.alert} role="status">
              <Badge tone={alert.tone} variant="soft" size="sm" dot>
                Atención
              </Badge>
              <span>{alert.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      <Section columns={4} gap="sm" aria-label="Indicadores de API">
        <KpiCard
          label="Llaves activas"
          value={formatCount(kpis.active)}
          tone="success"
          loading={keysQuery.isPending}
          hint={`${formatCount(kpis.total)} totales`}
        />
        <KpiCard
          label="Uso reciente"
          value={formatCount(usageQuery.data?.usedIn24h ?? kpis.usedRecently)}
          tone="info"
          loading={keysQuery.isPending}
          hint="Claves con tráfico en 24 h (derivado)"
        />
        <KpiCard
          label="Límite medio"
          value={formatCount(kpis.avgLimit)}
          unit="/min"
          loading={keysQuery.isPending}
          hint={
            kpis.nearHighLimit > 0
              ? `${formatCount(kpis.nearHighLimit)} con ≥5k rpm`
              : 'Rate limit de claves activas'
          }
        />
        <KpiCard
          label="Por rotar"
          value={formatCount(kpis.rotationDue)}
          tone={kpis.rotationDue > 0 ? 'warning' : 'neutral'}
          loading={keysQuery.isPending}
          hint=">90 días, por expirar o expiradas"
        />
      </Section>

      <div className={styles.tabs}>
        <SegmentedControl
          label="Vista de gestión de API"
          size="sm"
          value={url.tab}
          onValueChange={(value) => {
            if (value === 'keys' || value === 'quotas' || value === 'usage') {
              url.setTab(value);
            }
          }}
          options={[
            { value: 'keys', label: 'Llaves' },
            { value: 'quotas', label: 'Cuotas' },
            { value: 'usage', label: 'Uso' },
          ]}
        />
      </div>

      {keysQuery.error ? (
        <QueryError error={keysQuery.error} onRetry={() => void keysQuery.refetch()} />
      ) : null}

      {!keysQuery.error && url.tab === 'keys' ? (
        <div className={styles.layout}>
          <Section
            title="API keys"
            description="Prefijo visible, scopes concedidos y rate limit. Nunca se listan secretos."
            actions={
              <div className={styles.livePill}>
                <StatusDot tone="success" pulse aria-hidden />
                En vivo
              </div>
            }
          >
            <div className={styles.filters}>
              <FilterBar
                filters={filterDefs}
                value={url.filterSelection}
                onChange={url.setFilterSelection}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar por nombre, prefijo o scope',
                }}
              >
                <SegmentedControl
                  label="Filtro rápido de estado"
                  size="sm"
                  value={
                    url.health === 'all' ||
                    url.health === 'active' ||
                    url.health === 'revoked' ||
                    url.health === 'rotationDue'
                      ? url.health
                      : 'all'
                  }
                  onValueChange={(value) => {
                    if (
                      value === 'all' ||
                      value === 'active' ||
                      value === 'revoked' ||
                      value === 'rotationDue'
                    ) {
                      url.setHealth(value);
                    }
                  }}
                  options={[
                    { value: 'all', label: 'Todas' },
                    { value: 'active', label: 'Activas' },
                    { value: 'rotationDue', label: 'Rotar' },
                    { value: 'revoked', label: 'Revocadas' },
                  ]}
                />
              </FilterBar>
            </div>

            <div className={styles.tableMeta}>
              <span className={styles.muted}>
                {formatCount(filtered.length)} de {formatCount(keys.length)} claves
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void keysQuery.refetch()}
              >
                Actualizar
              </Button>
            </div>

            <DataTable
              label="API keys"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={keysQuery.isPending}
              maxHeight={480}
              onRowClick={(row) => url.setSelectedId(row.id)}
              empty={
                <EmptyState
                  title={keys.length === 0 ? 'Sin API keys' : 'Sin resultados'}
                  description={
                    keys.length === 0
                      ? 'Crea la primera clave para conectar POS, marketplaces u otros sistemas.'
                      : 'Ajusta la búsqueda o limpia los filtros de la URL.'
                  }
                  illustration={keys.length === 0 ? 'inbox' : 'search'}
                  action={
                    keys.length === 0 ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        Generar API key
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={url.clearFilters}
                      >
                        Limpiar filtros
                      </Button>
                    )
                  }
                />
              }
            />
          </Section>

          <div className={styles.stack}>
            <aside className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Rate limits</h2>
                  <p>Distribución de cuotas en claves activas</p>
                </div>
              </div>
              {buckets.every((bucket) => bucket.count === 0) ? (
                <p className={styles.muted}>Sin claves activas para agrupar.</p>
              ) : (
                <ul className={styles.bucketList}>
                  {buckets.map((bucket) => (
                    <li key={bucket.id} className={styles.bucketRow}>
                      <span>{bucket.label}</span>
                      <strong>{formatCount(bucket.count)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <aside className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Scopes en uso</h2>
                  <p>Concesiones entre claves activas</p>
                </div>
              </div>
              {scopes.length === 0 ? (
                <EmptyState
                  title="Sin scopes"
                  description="Aparecerán al emitir la primera clave activa."
                  illustration="chart"
                  size="sm"
                />
              ) : (
                <DonutChart
                  label="Distribución de scopes en claves activas"
                  slices={scopes}
                  height={200}
                  centerLabel="Concesiones"
                  formatValue={(value) => formatCount(value)}
                />
              )}
            </aside>
          </div>
        </div>
      ) : null}

      {!keysQuery.error && url.tab === 'quotas' ? (
        <Section
          title="Plantillas de cuota"
          description="Perfiles sugeridos. La API aún no persiste cuotas globales; al crear una key usa el rate limit del formulario."
        >
          <div className={styles.quotaGrid}>
            {(quotasQuery.data ?? []).map((template) => (
              <article key={template.id} className={styles.quotaCard}>
                <div className={styles.scopes}>
                  <Badge
                    tone={template.environment === 'sandbox' ? 'info' : 'success'}
                    variant="soft"
                    size="sm"
                  >
                    {template.environment}
                  </Badge>
                  <Badge tone="neutral" variant="outline" size="sm">
                    {formatCount(template.rpm)} rpm
                  </Badge>
                </div>
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <p className={styles.muted}>Burst sugerido: {formatCount(template.burst)} /min</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCreateOpen(true)}
                >
                  Crear key con este perfil
                </Button>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {!keysQuery.error && url.tab === 'usage' ? (
        <Section
          title="Uso estimado"
          description="Sin series de gateway: se deriva de lastUsedAt de cada clave."
        >
          <p className={styles.usageNote}>{usageQuery.data?.note}</p>
          <Section columns={4} gap="sm" aria-label="Resumen de uso">
            <KpiCard
              label="Activas"
              value={formatCount(usageQuery.data?.activeKeys ?? 0)}
              loading={usageQuery.isPending}
            />
            <KpiCard
              label="Con uso 24 h"
              value={formatCount(usageQuery.data?.usedIn24h ?? 0)}
              tone="info"
              loading={usageQuery.isPending}
            />
            <KpiCard
              label="Con uso 7 d"
              value={formatCount(usageQuery.data?.usedIn7d ?? 0)}
              tone="success"
              loading={usageQuery.isPending}
            />
            <KpiCard
              label="Idle activas"
              value={formatCount(usageQuery.data?.idleActive ?? 0)}
              tone="warning"
              loading={usageQuery.isPending}
            />
          </Section>
        </Section>
      ) : null}

      <Section
        title="Actividad de claves"
        description="Creaciones y revocaciones del registro de auditoría."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void auditQuery.refetch()}
          >
            Actualizar
          </Button>
        }
      >
        {auditQuery.error ? (
          <QueryError error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
        ) : (
          <ActivityFeed
            items={activityItems}
            loading={auditQuery.isPending}
            label="Actividad de API keys"
            empty={
              <EmptyState
                title="Sin actividad reciente"
                description="Las altas y bajas de claves aparecerán aquí."
                illustration="inbox"
                size="sm"
              />
            }
          />
        )}
      </Section>

      <CreateKeyModal
        open={createOpen}
        busy={createKey.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
      />

      <KeyDetailDrawer
        keyRow={selected}
        now={now}
        busy={Boolean(busyId)}
        onClose={() => url.setSelectedId(null)}
        onRotate={(key) => setRotateTarget(key)}
        onRevoke={(key) => setRevokeTarget(key)}
      />

      <Modal
        open={Boolean(rotateTarget)}
        onClose={() => setRotateTarget(null)}
        title="Rotar API key"
        description={
          rotateTarget
            ? `Se emitirá una nueva clave para «${rotateTarget.name}» con los mismos scopes y se revocará la actual.`
            : undefined
        }
        footer={
          <div className={styles.modalFooter}>
            <Button type="button" variant="ghost" onClick={() => setRotateTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              loading={Boolean(rotateTarget && busyId === rotateTarget.id)}
              loadingLabel="Rotando…"
              onClick={() => void onRotate()}
            >
              Rotar ahora
            </Button>
          </div>
        }
      >
        <p className={styles.muted}>
          Las integraciones dejarán de autenticarse con el prefijo actual. Ten listo el vault
          para el nuevo secreto (se muestra una sola vez).
        </p>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revocar API key"
        description={
          revokeTarget
            ? `«${revokeTarget.name}» (${revokeTarget.keyPrefix}…) dejará de aceptar tráfico de inmediato.`
            : undefined
        }
        footer={
          <div className={styles.modalFooter}>
            <Button type="button" variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={Boolean(revokeTarget && busyId === revokeTarget.id)}
              loadingLabel="Revocando…"
              onClick={() => void onRevoke()}
            >
              Revocar
            </Button>
          </div>
        }
      >
        <p className={styles.muted}>
          Esta acción no se puede deshacer. Usa rotación si solo necesitas renovar el secreto.
        </p>
      </Modal>
    </div>
  );
}

export default function ApiManagementPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando gestión de API…
        </div>
      }
    >
      <ApiManagementCockpit />
    </Suspense>
  );
}
