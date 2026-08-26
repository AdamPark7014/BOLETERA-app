'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
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
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import type { ApiKey } from '@/lib/queries/partners';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/platform-api';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import { CreateKeyModal, type CreateKeyPayload } from './_components/CreateKeyModal';
import { KeyDetailDrawer } from './_components/KeyDetailDrawer';
import { formatCount, relativePast } from './_lib/format';
import {
  HEALTH_FILTER_OPTIONS,
  buildKeyAlerts,
  classifyKey,
  computePartnerKpis,
  keyHealthMeta,
  matchesHealth,
  matchesQuery,
  scopeDistribution,
  type HealthFilter,
  type KeyHealth,
} from './_lib/keys';
import { isWriteScope, scopeLabel } from './_lib/scopes';
import { usePartnersUrlState } from './_lib/use-partners-url-state';
import styles from './partners.module.scss';

function healthCounts(keys: readonly ApiKey[], now: number): Record<KeyHealth, number> {
  const counts: Record<KeyHealth, number> = {
    active: 0,
    low: 0,
    idle: 0,
    expiring: 0,
    expired: 0,
    revoked: 0,
  };
  for (const key of keys) {
    counts[classifyKey(key, now)] += 1;
  }
  return counts;
}

function PartnersCockpit() {
  const session = useSession();
  const toast = useToast();
  const url = usePartnersUrlState();
  const deferredQ = useDeferredValue(url.q);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { token, orgId } = session;

  function reload() {
    if (!token || !orgId) return;
    setLoading(true);
    setError(null);
    listApiKeys(token, orgId)
      .then((data) => {
        setKeys(data);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (session.status === 'ready') reload();
    else if (session.status !== 'loading') setLoading(false);
  }, [orgId, token, session.status]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const kpis = useMemo(() => computePartnerKpis(keys, now), [keys, now]);
  const alerts = useMemo(() => buildKeyAlerts(keys, now), [keys, now]);
  const scopes = useMemo(() => scopeDistribution(keys), [keys]);
  const counts = useMemo(() => healthCounts(keys, now), [keys, now]);

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
    if (!token || !orgId) return;
    setCreateBusy(true);
    try {
      const created = await createApiKey(token, orgId, {
        name: payload.name,
        scopes: payload.scopes,
        rateLimit: payload.rateLimit,
        expiresInDays: payload.expiresInDays,
      });
      setSecret({ value: created.secret, name: payload.name });
      setCreateOpen(false);
      toast.success('API key generada');
      reload();
    } catch (err) {
      throw err instanceof Error ? err : new Error('No se pudo crear la clave.');
    } finally {
      setCreateBusy(false);
    }
  }

  async function onRevoke() {
    if (!revokeTarget || !token || !orgId) return;
    setBusyId(revokeTarget.id);
    try {
      await revokeApiKey(token, orgId, revokeTarget.id);
      toast.success(`Clave «${revokeTarget.name}» revocada`);
      setRevokeTarget(null);
      if (url.selectedId === revokeTarget.id) url.setSelectedId(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo revocar');
    } finally {
      setBusyId(null);
    }
  }

  async function onRotate() {
    if (!rotateTarget || !token || !orgId) return;
    setBusyId(rotateTarget.id);
    try {
      const created = await createApiKey(token, orgId, {
        name: rotateTarget.name,
        scopes: rotateTarget.scopes,
        rateLimit: rotateTarget.rateLimit,
      });
      try {
        await revokeApiKey(token, orgId, rotateTarget.id);
      } catch (revokeErr) {
        throw new Error(
          revokeErr instanceof Error
            ? `Clave nueva emitida (${created.keyPrefix}…), pero no se pudo revocar la anterior: ${revokeErr.message}`
            : `Clave nueva emitida (${created.keyPrefix}…), pero no se pudo revocar la anterior.`,
        );
      }
      setSecret({ value: created.secret, name: rotateTarget.name });
      toast.success('Rotación completada — copia el nuevo secreto');
      setRotateTarget(null);
      if (url.selectedId === rotateTarget.id) url.setSelectedId(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo rotar la clave');
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
      header: 'Integración',
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

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading' || (loading && keys.length === 0 && !error)) {
    return <LoadingView label="Cargando partners y API keys…" />;
  }
  if (error) {
    return <ApiErrorView error={error} context="cargar las API keys de partners" onRetry={reload} />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Integraciones"
        title="Partners & API Keys"
        description="Integraciones B2B estilo Palco4 Connect — inventario, órdenes y reportes"
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
            Solo se muestra una vez. Guárdala en tu vault antes de cerrar este aviso.
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
        <div className={styles.alerts} aria-label="Alertas de partners">
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

      <Section columns={4} gap="sm" className={styles.kpiStrip} aria-label="Indicadores de partners">
        <KpiCard
          label="Claves activas"
          value={formatCount(kpis.active)}
          tone="success"
          loading={loading}
          hint={`${formatCount(kpis.total)} totales`}
        />
        <KpiCard
          label="Uso reciente"
          value={formatCount(kpis.usedRecently)}
          tone="info"
          loading={loading}
          hint="Con tráfico en los últimos 7 días"
        />
        <KpiCard
          label="Límite medio"
          value={formatCount(kpis.avgLimit)}
          unit="/min"
          loading={loading}
          hint="Rate limit de claves activas"
        />
        <KpiCard
          label="Con escritura"
          value={formatCount(kpis.writeCapable)}
          tone={kpis.writeCapable > 0 ? 'warning' : 'neutral'}
          loading={loading}
          hint={
            kpis.expiringSoon > 0
              ? `${formatCount(kpis.expiringSoon)} por expirar`
              : 'Scopes write:* concedidos'
          }
        />
      </Section>

      <div className={styles.layout}>
        <Section
          title="API keys"
          description="Prefijo visible, scopes concedidos y rate limit. Los secretos nunca se listan."
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
                  url.health === 'revoked'
                    ? url.health
                    : 'all'
                }
                onValueChange={(value) => {
                  if (value === 'all' || value === 'active' || value === 'revoked') {
                    url.setHealth(value as HealthFilter);
                  }
                }}
                options={[
                  { value: 'all', label: 'Todas' },
                  { value: 'active', label: 'Activas' },
                  { value: 'revoked', label: 'Revocadas' },
                ]}
              />
            </FilterBar>
          </div>

          <div className={styles.tableMeta}>
            <span className={styles.muted}>
              {formatCount(filtered.length)} de {formatCount(keys.length)} claves
            </span>
            <Button type="button" variant="outline" size="sm" loading={loading} onClick={() => reload()}>
              Actualizar
            </Button>
          </div>

          <DataTable
            label="API keys de partners"
            columns={columns}
            data={filtered}
            rowKey={(row) => row.id}
            loading={loading}
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
                    <Button type="button" variant="secondary" size="sm" onClick={url.clearFilters}>
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
                <h2>Salud del portfolio</h2>
                <p>Estado operativo derivado de uso y caducidad</p>
              </div>
            </div>
            <ul className={styles.statusList}>
              {HEALTH_FILTER_OPTIONS.filter((option) => option.value !== 'all').map((option) => {
                const health = option.value as KeyHealth;
                const meta = keyHealthMeta(health);
                const count = counts[health];
                const active = url.health === health;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={styles.statusRow}
                      aria-pressed={active}
                      onClick={() => url.setHealth(active ? 'all' : health)}
                    >
                      <StatusDot tone={meta.statusTone} pulse={meta.pulse && count > 0} aria-hidden />
                      <span>
                        <strong>{option.label}</strong>
                        <span>{count === 1 ? '1 clave' : `${count} claves`}</span>
                      </span>
                      <Badge tone={meta.tone} variant="soft" size="sm">
                        {formatCount(count)}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
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

      <CreateKeyModal
        open={createOpen}
        busy={createBusy}
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

export default function PartnersPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando partners…
        </div>
      }
    >
      <PartnersCockpit />
    </Suspense>
  );
}
