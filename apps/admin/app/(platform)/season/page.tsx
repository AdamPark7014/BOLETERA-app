'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  SkeletonCard,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import type { SeasonPass } from '@/lib/queries/season';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import { AdoptionPanel } from './_components/AdoptionPanel';
import {
  CreatePassModal,
  type CreatePassPayload,
} from './_components/CreatePassModal';
import { InventoryHealth } from './_components/InventoryHealth';
import {
  formatCount,
  formatMoney,
  formatMoneyPrecise,
  formatRatio,
} from './_lib/money';
import {
  adoptionBySeason,
  adoptionRate,
  buildSeasonAlerts,
  computeSeasonKpis,
  filterAndSortPasses,
  inventoryHealth,
  passPriceCents,
  passStatusMeta,
  revenueCents,
  seasonLabelsOf,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  statusOf,
  type SortKey,
  type StatusFilter,
} from './_lib/passes';
import { useSeasonUrlState } from './_lib/use-season-url-state';
import styles from './season.module.scss';

function SeasonPassesCockpit() {
  const session = useSession();
  const { token, orgId } = session;
  const toast = useToast();
  const url = useSeasonUrlState();
  const deferredQ = useDeferredValue(url.q);

  const [rows, setRows] = useState<SeasonPass[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function reload() {
    if (!token || !orgId) return;
    setLoading(true);
    setError(null);
  // Antes: `fetch(...).then(r => r.json()).then(setRows)`. Con un 401 el cuerpo
  // del error entraba en `rows` y `rows.map` reventaba la pantalla entera.
    adminApi<SeasonPass[]>(`/season/org/${orgId}`, token)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (session.status === 'ready') reload();
    else if (session.status !== 'loading') setLoading(false);
  }, [orgId, token, session.status]);

  const kpis = useMemo(() => computeSeasonKpis(rows), [rows]);
  const alerts = useMemo(() => buildSeasonAlerts(rows), [rows]);
  const buckets = useMemo(() => adoptionBySeason(rows), [rows]);
  const inventoryRows = useMemo(() => inventoryHealth(rows), [rows]);
  const seasonLabels = useMemo(() => seasonLabelsOf(rows), [rows]);

  const filtered = useMemo(
    () =>
      filterAndSortPasses(rows, {
        query: deferredQ,
        season: url.season,
        status: url.status,
        sort: url.sort,
      }),
    [deferredQ, rows, url.season, url.sort, url.status],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const next: Record<string, readonly string[]> = {};
    if (url.status !== 'all') next.status = [url.status];
    if (url.season !== 'all') next.season = [url.season];
    return next;
  }, [url.season, url.status]);

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    if (seasonLabels.length <= 1) return [];
    return [
      {
        id: 'season',
        label: 'Temporada',
        multiple: false,
        options: seasonLabels.map((label) => ({
          value: label,
          label,
          count: rows.filter((pass) => pass.seasonLabel === label).length,
        })),
      },
    ];
  }, [rows, seasonLabels]);

  async function onCreate(payload: CreatePassPayload) {
    if (!token || !orgId) {
      throw new Error('Sesión inválida.');
    }
    setSaving(true);
    try {
      await adminApi(`/season/org/${orgId}`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(`Abono «${payload.name}» creado`);
      setCreateOpen(false);
      reload();
    } catch (err) {
      // El alta fallaba en silencio: sin `await` comprobado, el formulario se
      // limpiaba igual y el usuario creía haber creado el abono.
      throw new Error(
        err instanceof ApiError
          ? `${err.userMessage} (${err.status})`
          : 'No se pudo crear el abono.',
      );
    } finally {
      setSaving(false);
    }
  }

  const columns: DataTableColumn<SeasonPass>[] = [
    {
      key: 'name',
      header: 'Abono',
      width: 220,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className={styles.passMeta}>
          <strong>{row.name}</strong>
          <small>
            {row.seasonLabel} · {row.slug}
          </small>
        </div>
      ),
    },
    {
      key: 'adoption',
      header: 'Adopción',
      width: 160,
      sortValue: (row) => adoptionRate(row),
      render: (row) => {
        const rate = adoptionRate(row);
        return (
          <div className={styles.adoptionCell}>
            <strong>{formatRatio(rate)}</strong>
            <div
              className={styles.bar}
              role="meter"
              aria-label={`Adopción ${Math.round(rate * 100)}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rate * 100)}
            >
              <span style={{ width: `${Math.min(rate * 100, 100)}%` }} />
            </div>
            <small>
              {formatCount(row.soldQuantity)}/{formatCount(row.maxQuantity)} vendidos
            </small>
          </div>
        );
      },
    },
    {
      key: 'price',
      header: 'Precio',
      width: 120,
      align: 'right',
      sortValue: (row) => passPriceCents(row),
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatMoneyPrecise(passPriceCents(row))}</strong>
          <small>por abono</small>
        </div>
      ),
    },
    {
      key: 'revenue',
      header: 'Ingreso',
      width: 130,
      align: 'right',
      sortValue: (row) => revenueCents(row),
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatMoney(revenueCents(row))}</strong>
          <small>estimado</small>
        </div>
      ),
    },
    {
      key: 'events',
      header: 'Eventos',
      width: 90,
      align: 'right',
      sortValue: (row) => row.events?.length ?? 0,
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatCount(row.events?.length ?? 0)}</strong>
          <small>ligados</small>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 120,
      sortValue: (row) => statusOf(row),
      render: (row) => {
        const meta = passStatusMeta(statusOf(row));
        return (
          <Badge tone={meta.tone} variant="soft" size="sm" dot>
            {meta.label}
          </Badge>
        );
      },
    },
  ];

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView error={error} context="listar los abonos de temporada" onRetry={reload} />
    );
  }

  if (session.status === 'loading') {
    return (
      <div className={styles.page} aria-busy="true">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Abonos / temporadas"
        description="Pases de temporada ligados a múltiples eventos del venue — cupo, adopción e ingresos"
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Nuevo abono
          </Button>
        }
      />

      {alerts.length > 0 ? (
        <div className={styles.alerts} aria-label="Alertas de abonos">
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

      <Section columns={4} gap="sm" aria-label="Indicadores de abonos">
        <KpiCard
          label="Abonos activos"
          value={formatCount(kpis.active)}
          loading={loading}
          hint={`${formatCount(rows.length)} en catálogo`}
          tone="accent"
        />
        <KpiCard
          label="Vendidos"
          value={formatCount(kpis.sold)}
          loading={loading}
          hint={`${formatCount(kpis.inventory)} cupos libres`}
          tone="info"
        />
        <KpiCard
          label="Adopción"
          value={formatRatio(kpis.adoption)}
          loading={loading}
          hint={`${formatCount(kpis.renewable)} con alta adopción`}
          tone="success"
        />
        <KpiCard
          label="Ingresos"
          value={formatMoney(kpis.revenueCents)}
          loading={loading}
          hint={`${formatCount(kpis.capacity)} cupo total`}
          tone="warning"
        />
      </Section>

      <div className={styles.layout}>
        <Section
          title="Catálogo de abonos"
          description="Cupo, adopción, ingreso estimado y eventos ligados por pase."
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={loading}
              loadingLabel="Actualizando…"
              onClick={() => reload()}
            >
              Actualizar
            </Button>
          }
        >
          <div className={styles.filters}>
            <FilterBar
              filters={filterDefs}
              value={filterSelection}
              onChange={(next) => {
                const status = (next.status?.[0] as StatusFilter | undefined) ?? 'all';
                const season = next.season?.[0] ?? 'all';
                url.setStatus(status);
                url.setSeason(season);
              }}
              search={{
                value: url.q,
                onChange: url.setSearch,
                placeholder: 'Buscar por nombre, slug o temporada',
              }}
            >
              <SegmentedControl
                label="Filtro rápido de estado"
                size="sm"
                value={url.status}
                onValueChange={(value) => url.setStatus(value as StatusFilter)}
                options={STATUS_FILTER_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
              <select
                className={styles.sortSelect}
                aria-label="Ordenar abonos"
                value={url.sort}
                onChange={(e) => url.setSort(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterBar>
          </div>

          <div className={styles.tableMeta}>
            <span className={styles.muted}>
              {formatCount(filtered.length)} de {formatCount(rows.length)} resultados
            </span>
          </div>

          {loading && rows.length === 0 ? (
            <LoadingView label="Cargando abonos…" />
          ) : (
            <DataTable
              label="Catálogo de abonos de temporada"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={loading}
              maxHeight={520}
              rowHeight={64}
              empty={
                <EmptyState
                  title={rows.length === 0 ? 'Sin abonos' : 'Sin resultados'}
                  description={
                    rows.length === 0
                      ? 'Crea el primer abono para medir adopción y ocupación de cupo.'
                      : 'Ajusta filtros o limpia la URL.'
                  }
                  illustration={rows.length === 0 ? 'seats' : 'search'}
                  action={
                    rows.length === 0 ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        Crear abono
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
          )}
        </Section>

        <div className={styles.stack}>
          <AdoptionPanel buckets={buckets} loading={loading} />
          <InventoryHealth rows={inventoryRows} loading={loading} />
        </div>
      </div>

      <CreatePassModal
        open={createOpen}
        busy={saving}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
      />
    </div>
  );
}

export default function SeasonPassesPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando abonos…
        </div>
      }
    >
      <SeasonPassesCockpit />
    </Suspense>
  );
}
