'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterBar,
  formatNumber,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  Tabs,
  formatDateTime,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import { listSeries, type EventSeriesKind, type EventSeriesStatus, type SeriesRow } from '@/lib/scheduling-api';
import { useSession } from '@/lib/use-session';
import platform from '../../_styles/platform.module.scss';
import { CreateResidencyForm } from './_components/CreateResidencyForm';
import { CreateSeriesForm } from './_components/CreateSeriesForm';
import {
  filterSeries,
  filtersToParams,
  parseFilters,
  seriesKpis,
  type SeriesFilters,
} from './_lib/filters';
import { KIND_LABELS, STATUS_LABELS, kindTone, statusTone } from './_lib/labels';
import styles from './series.module.scss';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { dateStyle: 'medium' });
}

function countBy<T extends string>(rows: SeriesRow[], key: (row: SeriesRow) => T): Map<T, number> {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export default function SeriesListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { can, status: sessionStatus } = useSession();
  const canWrite = can('event:write');

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const [rows, setRows] = useState<SeriesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setFilters = useCallback(
    (patch: Partial<SeriesFilters>) => {
      const next = { ...filters, ...patch };
      const params = filtersToParams(next);
      const qs = params.toString();
      router.replace(qs ? `/events/series?${qs}` : '/events/series', { scroll: false });
    },
    [filters, router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listSeries());
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las series');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (rows ? filterSeries(rows, filters) : []),
    [rows, filters],
  );
  const kpis = useMemo(() => seriesKpis(rows ?? []), [rows]);
  const kindCounts = useMemo(() => countBy(rows ?? [], (row) => row.kind), [rows]);
  const statusCounts = useMemo(() => countBy(rows ?? [], (row) => row.status), [rows]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'kind',
        label: 'Tipo',
        multiple: false,
        options: Array.from(kindCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([kind, count]) => ({
            value: kind,
            label: KIND_LABELS[kind],
            count,
          })),
      },
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: Array.from(statusCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([status, count]) => ({
            value: status,
            label: STATUS_LABELS[status],
            count,
          })),
      },
    ],
    [kindCounts, statusCounts],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const next: Record<string, readonly string[]> = {};
    if (filters.kind !== 'ALL') next.kind = [filters.kind];
    if (filters.status !== 'ALL') next.status = [filters.status];
    return next;
  }, [filters.kind, filters.status]);

  if (sessionStatus === 'loading') {
    return (
      <div className={styles.page}>
        <Skeleton height={96} />
        <Skeleton height={180} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Programación"
        title="Series y residencias"
        description={`${formatNumber(kpis.total)} programas · ${formatNumber(kpis.active)} activas · ${formatNumber(kpis.upcomingDates)} fechas próximas`}
        breadcrumbs={[
          { label: 'Eventos', href: '/events' },
          { label: 'Series' },
        ]}
        actions={
          <div className={styles.actions}>
            <Link href="/calendar" className={platform.ghostBtn}>
              Calendario
            </Link>
            <Link href="/events/new" className={platform.ghostBtn}>
              Asistente completo
            </Link>
            {canWrite && (
              <Button type="button" onClick={() => setFilters({ tab: 'crear-serie' })}>
                Nueva serie
              </Button>
            )}
          </div>
        }
      >
        <Tabs
          label="Secciones de series"
          variant="pill"
          value={filters.tab}
          onValueChange={(id) =>
            setFilters({
              tab: id as SeriesFilters['tab'],
            })
          }
          items={[
            {
              id: 'catalogo',
              label: 'Catálogo',
              badge: rows ? formatNumber(rows.length) : undefined,
            },
            {
              id: 'crear-serie',
              label: 'Crear serie',
              disabled: !canWrite,
            },
            {
              id: 'crear-residencia',
              label: 'Crear residencia',
              disabled: !canWrite,
            },
          ]}
        />
      </PageHeader>

      <Section columns={4} gap="md" className={styles.kpiStrip} aria-label="Indicadores de series">
        <KpiCard
          label="Programas"
          value={formatNumber(kpis.total)}
          loading={loading}
          hint="Series y temporadas"
          tone="accent"
        />
        <KpiCard
          label="Activas"
          value={formatNumber(kpis.active)}
          loading={loading}
          tone="success"
          hint="Estado ACTIVE"
        />
        <KpiCard
          label="Fechas próximas"
          value={formatNumber(kpis.upcomingDates)}
          loading={loading}
          tone="info"
          hint="Suma de upcoming"
        />
        <KpiCard
          label="Aforo agregado"
          value={formatNumber(kpis.capacity)}
          loading={loading}
          hint="Capacidad de todas las fechas"
        />
      </Section>

      {filters.tab === 'crear-serie' && (
        <CreateSeriesForm
          disabled={!canWrite}
          onCreated={() => {
            setFilters({ tab: 'catalogo' });
            void load();
          }}
        />
      )}

      {filters.tab === 'crear-residencia' && (
        <CreateResidencyForm
          disabled={!canWrite}
          onCreated={() => {
            setFilters({ tab: 'catalogo' });
            void load();
          }}
        />
      )}

      {filters.tab === 'catalogo' && (
        <Section
          title="Catálogo de series"
          description="Programas recurrentes y residencias con fechas, aforo y próxima función."
        >
          {rows && rows.length > 0 && (
            <>
              <div className={styles.filters}>
                <FilterBar
                  filters={filterDefs}
                  value={filterSelection}
                  onChange={(next) =>
                    setFilters({
                      kind: (next.kind?.[0] as EventSeriesKind | undefined) ?? 'ALL',
                      status: (next.status?.[0] as EventSeriesStatus | undefined) ?? 'ALL',
                    })
                  }
                  search={{
                    value: filters.q,
                    onChange: (value) => setFilters({ q: value }),
                    placeholder: 'Nombre, recinto o resumen…',
                  }}
                />
              </div>

              <div className={styles.tableMeta}>
                <span className={styles.muted}>
                  {filtered.length === rows.length
                    ? `${formatNumber(filtered.length)} programas en catálogo`
                    : `${formatNumber(filtered.length)} de ${formatNumber(rows.length)} programas coinciden con los filtros`}
                </span>
              </div>
            </>
          )}

          {loading ? (
            <Skeleton height={240} />
          ) : error ? (
            <EmptyState
              title="No se pudo cargar el catálogo"
              description={error}
              illustration="error"
              tone="danger"
              action={
                <Button
                  type="button"
                  onClick={() => {
                    void load();
                    toast.success('Reintentando…');
                  }}
                >
                  Reintentar
                </Button>
              }
            />
          ) : !rows?.length ? (
            <EmptyState
              title="Todavía no hay series"
              description="Crea una serie o residencia desde las pestañas superiores, o usa el asistente completo."
              illustration="inbox"
              hints={[
                'Serie: varias fechas a partir de una recurrencia',
                'Residencia: mismo venue con frecuencia fija',
              ]}
              action={
                canWrite ? (
                  <Button type="button" onClick={() => setFilters({ tab: 'crear-serie' })}>
                    Crear serie
                  </Button>
                ) : undefined
              }
              secondaryAction={
                <Link href="/events/new" className={platform.ghostBtn}>
                  Asistente completo
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Sin coincidencias"
              description="Prueba otro texto o limpia los filtros de tipo y estado."
              illustration="search"
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFilters({ q: '', kind: 'ALL', status: 'ALL' })}
                >
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <Card variant="outline" padding="md" className={styles.catalogCard}>
              <div className={styles.tableWrap}>
                <table className={platform.table}>
                  <caption className={styles.srOnly}>Catálogo de series y residencias</caption>
                  <thead>
                    <tr>
                      <th scope="col">Programa</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Recinto</th>
                      <th scope="col">Recurrencia</th>
                      <th scope="col" className={styles.numeric}>
                        Fechas
                      </th>
                      <th scope="col">Próxima</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        <td className={styles.programCell}>
                          <Link href={`/events/series/${row.id}`}>{row.name}</Link>
                          <span className={styles.subtle}>
                            {formatDate(row.firstDate)} → {formatDate(row.lastDate)}
                          </span>
                        </td>
                        <td>
                          <Badge tone={kindTone(row.kind)} dot size="sm">
                            {KIND_LABELS[row.kind]}
                          </Badge>
                        </td>
                        <td>{row.venue?.name ?? '—'}</td>
                        <td>
                          <span className={styles.subtle}>{row.summary ?? '—'}</span>
                        </td>
                        <td className={styles.numeric}>
                          {formatNumber(row.totals.events)}
                          {row.totals.cancelled > 0 && (
                            <span className={styles.subtle}>
                              {' '}
                              · {formatNumber(row.totals.cancelled)} cancel.
                            </span>
                          )}
                          <div className={styles.subtle}>
                            {formatNumber(row.totals.capacity)} lugares
                          </div>
                        </td>
                        <td>{formatDate(row.nextDate)}</td>
                        <td>
                          <Badge tone={statusTone(row.status)} variant="soft" size="sm">
                            {STATUS_LABELS[row.status]}
                          </Badge>
                          <div className={styles.subtle}>Alta {formatDateTime(row.createdAt)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </Section>
      )}

      {!canWrite && filters.tab !== 'catalogo' && (
        <EmptyState
          title="Sin permiso event:write"
          description="Puedes consultar el catálogo, pero no crear series ni residencias."
          illustration="error"
          tone="danger"
        />
      )}
    </div>
  );
}
