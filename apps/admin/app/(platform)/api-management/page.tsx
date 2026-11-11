'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import { useAuditLog } from '@/lib/queries/audit';
import {
  useApiManagementKeys,
  useApiUsageSummary,
  useCreateManagedApiKey,
  useQuotaTemplates,
  useRevokeManagedApiKey,
  useRotateManagedApiKey,
  type ApiKey,
} from '@/lib/queries/api-management';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatWhen } from '../events/_ticket/read';
import { CreateKeyForm, type CreateKeyPayload } from './_components/CreateKeyForm';
import { KeyDetail, type KeyConfirm } from './_components/KeyDetail';
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
  type HealthFilter,
} from './_lib/keys';
import { scopeLabel } from './_lib/scopes';
import { useApiManagementUrlState, type ApiManagementUrlState } from './_lib/use-url-state';

function auditLabel(action: string): string {
  switch (action) {
    case 'API_KEY_CREATED':
      return 'Creó la llave';
    case 'API_KEY_REVOKED':
      return 'Revocó la llave';
    default:
      return action.toLowerCase().replaceAll('_', ' ');
  }
}

function failMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error) return cause.message;
  return fallback;
}

export default function ApiManagementPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ApiBody />
      </AdminFrame>
    </Suspense>
  );
}

function ApiBody() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando API.</p>;
  return <GestionApi organizationId={session.orgId} />;
}

function GestionApi({ organizationId }: { organizationId: string }) {
  const url = useApiManagementUrlState();
  const deferredQ = useDeferredValue(url.q);

  const keysQuery = useApiManagementKeys(organizationId);
  const auditQuery = useAuditLog(organizationId, 40);
  const quotasQuery = useQuotaTemplates();
  const createKey = useCreateManagedApiKey(organizationId);
  const revokeKey = useRevokeManagedApiKey(organizationId);
  const rotateKey = useRotateManagedApiKey(organizationId);

  const [now, setNow] = useState(() => Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<KeyConfirm>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const usageQuery = useApiUsageSummary(organizationId, now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const keys = useMemo(() => keysQuery.data ?? [], [keysQuery.data]);
  const kpis = useMemo(() => computeApiKpis(keys, now), [keys, now]);
  const alerts = useMemo(() => buildKeyAlerts(keys, now), [keys, now]);
  const scopes = useMemo(() => scopeDistribution(keys), [keys]);
  const buckets = useMemo(() => rateLimitBuckets(keys), [keys]);
  const filtered = useMemo(
    () => keys.filter((key) => matchesHealth(key, url.health, now) && matchesQuery(key, deferredQ)),
    [deferredQ, keys, now, url.health]
  );

  const activity = useMemo(() => {
    const entries = (auditQuery.data ?? []).filter(
      (entry) => entry.entityType === 'ApiKey' || entry.action.startsWith('API_KEY_')
    );
    return entries.slice(0, 12).map((entry) => {
      const meta = entry.metadata ?? {};
      const name =
        typeof meta.name === 'string'
          ? meta.name
          : typeof meta.keyPrefix === 'string'
            ? String(meta.keyPrefix)
            : entry.entityId.slice(0, 8);
      return { id: entry.id, verb: auditLabel(entry.action), name, at: entry.createdAt };
    });
  }, [auditQuery.data]);

  async function onCreate(payload: CreateKeyPayload) {
    setNotice(null);
    setActionError(null);
    const created = await createKey.mutateAsync({
      name: payload.name,
      scopes: payload.scopes,
      rateLimit: payload.rateLimit,
      expiresInDays: payload.expiresInDays,
    });
    setSecret({ value: created.secret, name: payload.name });
    setCreateOpen(false);
    setNotice('Llave generada.');
  }

  async function onRevoke(target: ApiKey) {
    setBusyId(target.id);
    setNotice(null);
    setActionError(null);
    try {
      await revokeKey.mutateAsync(target.id);
      setNotice(`Llave «${target.name}» revocada.`);
      setConfirm(null);
      if (url.selectedId === target.id) url.setSelectedId(null);
    } catch (cause) {
      setActionError(failMessage(cause, 'No se pudo revocar.'));
    } finally {
      setBusyId(null);
    }
  }

  async function onRotate(target: ApiKey) {
    setBusyId(target.id);
    setNotice(null);
    setActionError(null);
    try {
      const created = await rotateKey.mutateAsync(target);
      setSecret({ value: created.secret, name: target.name });
      setNotice('Rotación hecha. Copia el secreto nuevo.');
      setConfirm(null);
      if (url.selectedId === target.id) url.setSelectedId(null);
    } catch (cause) {
      setActionError(failMessage(cause, 'No se pudo rotar la llave.'));
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setNotice('Secreto copiado.');
    } catch {
      setNotice('Copia el secreto a mano.');
    }
  }

  const loadingKeys = keysQuery.isPending;
  const figures = [
    { label: 'Llaves activas', meta: `${formatCount(kpis.total)} en total`, value: kpis.active },
    {
      label: 'Uso reciente',
      meta: 'Llaves con tráfico en 24 h (derivado)',
      value: usageQuery.data?.usedIn24h ?? kpis.usedRecently,
    },
    {
      label: 'Límite medio por minuto',
      meta:
        kpis.nearHighLimit > 0
          ? `${formatCount(kpis.nearHighLimit)} con 5 000 o más`
          : 'Límite de las llaves activas',
      value: kpis.avgLimit,
    },
    {
      label: 'Por rotar',
      meta: 'Más de 90 días, por expirar o expiradas',
      value: kpis.rotationDue,
    },
  ];

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>API</h1>
        <p className={styles.quiet}>
          Llaves, permisos, límites y rotación. Se ve el prefijo; el secreto se muestra una sola vez
          al crear o rotar.
        </p>
      </header>

      {secret ? (
        <div className={styles.stack} role="status" aria-live="polite" style={{ marginBottom: 24 }}>
          <p className={styles.rowTitle}>Copia el secreto ahora · «{secret.name}»</p>
          <p className={styles.quiet}>
            No vuelve a mostrarse. Guárdalo en tu bóveda antes de cerrar este aviso; tras
            «Entendido» desaparece.
          </p>
          <p className={styles.mono} style={{ overflowWrap: 'anywhere' }}>
            {secret.value}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <TicketButton variant="secondary" onClick={() => void copySecret()}>
              Copiar
            </TicketButton>
            <TicketButton variant="ghost" onClick={() => setSecret(null)}>
              Entendido
            </TicketButton>
          </div>
        </div>
      ) : null}

      <div className={styles.stack}>
        {createOpen ? (
          <CreateKeyForm
            busy={createKey.isPending}
            onCancel={() => setCreateOpen(false)}
            onSubmit={onCreate}
            describeError={(cause) => failMessage(cause, 'No se pudo crear la llave.')}
          />
        ) : (
          <div>
            <TicketButton variant="primary" onClick={() => setCreateOpen(true)}>
              Nueva llave
            </TicketButton>
          </div>
        )}
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
        {alerts.map((alert) => (
          <p key={alert.id} className={styles.quiet} role="status">
            Atención · {alert.text}
          </p>
        ))}
        <div className={styles.rows}>
          {figures.map((item) => (
            <div key={item.label} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{item.label}</p>
                <p className={styles.rowMeta}>{item.meta}</p>
              </div>
              <span />
              <p className={styles.figure}>{loadingKeys ? '—' : formatCount(item.value)}</p>
            </div>
          ))}
        </div>
        <Segment<ApiManagementUrlState['tab']>
          label="Vista"
          value={url.tab}
          onChange={url.setTab}
          options={[
            { value: 'keys', label: 'Llaves' },
            { value: 'quotas', label: 'Cuotas' },
            { value: 'usage', label: 'Uso' },
          ]}
        />
      </div>

      <div style={{ marginTop: 24 }}>
        {keysQuery.error ? (
          <ApiErrorView
            error={keysQuery.error}
            context="abrir las llaves"
            onRetry={() => void keysQuery.refetch()}
          />
        ) : null}

        {!keysQuery.error && url.tab === 'keys' ? (
          <div className={styles.stack}>
            <Field
              label="Buscar"
              kind="search"
              value={url.q}
              onChange={(event) => url.setSearch(event.target.value)}
              placeholder="Nombre, prefijo o permiso"
            />
            <SheetSelect
              label="Estado"
              value={url.health}
              placeholder="Todas"
              options={HEALTH_FILTER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(value) => url.setHealth(value as HealthFilter)}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <p className={styles.tertiary}>
                {formatCount(filtered.length)} de {formatCount(keys.length)} llaves
              </p>
              <TicketButton
                variant="ghost"
                disabled={keysQuery.isFetching}
                onClick={() => void keysQuery.refetch()}
              >
                {keysQuery.isFetching ? 'Actualizando' : 'Actualizar'}
              </TicketButton>
            </div>
            {loadingKeys ? <p className={styles.quiet}>Cargando llaves.</p> : null}
            {!loadingKeys && keys.length === 0 ? (
              <p className={styles.quiet}>
                Sin llaves. Crea la primera para conectar POS, marketplaces u otros sistemas.
              </p>
            ) : null}
            {!loadingKeys && keys.length > 0 && filtered.length === 0 ? (
              <div className={styles.stack}>
                <p className={styles.quiet}>Nada con ese criterio.</p>
                <div>
                  <TicketButton variant="ghost" onClick={url.clearFilters}>
                    Limpiar filtros
                  </TicketButton>
                </div>
              </div>
            ) : null}
            {filtered.map((key) => {
              const open = url.selectedId === key.id;
              const health = keyHealthMeta(classifyKey(key, now));
              return (
                <div key={key.id} className={styles.stack}>
                  <button
                    type="button"
                    className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                    aria-expanded={open}
                    onClick={() => {
                      setConfirm(null);
                      url.setSelectedId(open ? null : key.id);
                    }}
                  >
                    <span>
                      {key.name} · <span className={styles.mono}>{key.keyPrefix}…</span>
                    </span>
                    <span className={styles.tertiary}>
                      {health.label} · {relativePast(key.lastUsedAt, now)}
                    </span>
                  </button>
                  {open ? (
                    <KeyDetail
                      keyRow={key}
                      now={now}
                      busy={busyId === key.id}
                      confirm={confirm}
                      onAsk={(kind) => setConfirm({ kind, keyId: key.id })}
                      onCancel={() => setConfirm(null)}
                      onRotate={() => void onRotate(key)}
                      onRevoke={() => void onRevoke(key)}
                    />
                  ) : null}
                </div>
              );
            })}

            <header className={styles.sectionHead} style={{ marginTop: 24, marginBottom: 0 }}>
              <p className={styles.rowTitle}>Límites</p>
              <p className={styles.tertiary}>Reparto de cuotas en llaves activas.</p>
            </header>
            {buckets.every((bucket) => bucket.count === 0) ? (
              <p className={styles.quiet}>Sin llaves activas para agrupar.</p>
            ) : (
              <div className={styles.rows}>
                {buckets.map((bucket) => (
                  <div key={bucket.id} className={styles.row}>
                    <p className={styles.rowTitle}>{bucket.label}</p>
                    <span />
                    <p className={styles.figure}>{formatCount(bucket.count)}</p>
                  </div>
                ))}
              </div>
            )}

            <header className={styles.sectionHead} style={{ marginTop: 24, marginBottom: 0 }}>
              <p className={styles.rowTitle}>Permisos en uso</p>
              <p className={styles.tertiary}>Concesiones entre llaves activas.</p>
            </header>
            {scopes.length === 0 ? (
              <p className={styles.quiet}>Aparecen al emitir la primera llave activa.</p>
            ) : (
              <div className={styles.rows}>
                {scopes.map((slice) => (
                  <div key={slice.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{scopeLabel(slice.id)}</p>
                      <p className={styles.mono}>{slice.id}</p>
                    </div>
                    <span />
                    <p className={styles.figure}>{formatCount(slice.value)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!keysQuery.error && url.tab === 'quotas' ? (
          <div className={styles.stack}>
            <p className={styles.tertiary}>
              Perfiles sugeridos. El API aún no guarda cuotas globales; al crear una llave manda el
              límite del formulario.
            </p>
            <ul className={styles.rows}>
              {(quotasQuery.data ?? []).map((template) => (
                <li key={template.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>{template.name}</p>
                    <p className={styles.rowMeta}>
                      {template.environment === 'sandbox' ? 'Sandbox' : 'Producción'} · ráfaga
                      sugerida {formatCount(template.burst)} por minuto · {template.description}
                    </p>
                  </div>
                  <p className={styles.figure}>{formatCount(template.rpm)}/min</p>
                  <TicketButton variant="ghost" onClick={() => setCreateOpen(true)}>
                    Crear llave
                  </TicketButton>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!keysQuery.error && url.tab === 'usage' ? (
          <div className={styles.stack}>
            <p className={styles.tertiary}>
              Sin series del gateway: se deriva del último uso de cada llave.
            </p>
            {usageQuery.data?.note ? <p className={styles.quiet}>{usageQuery.data.note}</p> : null}
            <div className={styles.rows}>
              {[
                { label: 'Activas', value: usageQuery.data?.activeKeys },
                { label: 'Con uso en 24 h', value: usageQuery.data?.usedIn24h },
                { label: 'Con uso en 7 días', value: usageQuery.data?.usedIn7d },
                { label: 'Activas sin uso', value: usageQuery.data?.idleActive },
              ].map((item) => (
                <div key={item.label} className={styles.row}>
                  <p className={styles.rowTitle}>{item.label}</p>
                  <span />
                  <p className={styles.figure}>
                    {usageQuery.isPending ? '—' : formatCount(item.value ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <header className={styles.sectionHead} style={{ marginTop: 24 }}>
        <p className={styles.rowTitle}>Actividad de llaves</p>
        <p className={styles.tertiary}>Altas y revocaciones del registro de auditoría.</p>
      </header>
      <div className={styles.stack}>
        <div>
          <TicketButton
            variant="ghost"
            disabled={auditQuery.isFetching}
            onClick={() => void auditQuery.refetch()}
          >
            {auditQuery.isFetching ? 'Actualizando' : 'Actualizar actividad'}
          </TicketButton>
        </div>
        {auditQuery.error ? (
          <p className={styles.danger} role="alert">
            {failMessage(auditQuery.error, 'No se pudo leer la auditoría.')}
          </p>
        ) : auditQuery.isPending ? (
          <p className={styles.quiet}>Cargando actividad.</p>
        ) : activity.length === 0 ? (
          <p className={styles.quiet}>Sin actividad reciente.</p>
        ) : (
          <ul className={styles.rows}>
            {activity.map((item) => (
              <li key={item.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{item.verb}</p>
                  <p className={styles.rowMeta}>{item.name}</p>
                </div>
                <span />
                <p className={styles.tertiary}>{formatWhen(item.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
