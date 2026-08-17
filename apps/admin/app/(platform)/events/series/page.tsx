'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatNumber,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  Tabs,
  formatDateTime,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import { listSeries, type SeriesRow } from '@/lib/scheduling-api';
import { useSession } from '@/lib/use-session';
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
        description="Catálogo de programas recurrentes, altas rápidas de serie/residencia y acceso al detalle."
        breadcrumbs={[
          { label: 'Eventos', href: '/events' },
          { label: 'Series' },
        ]}
        actions={
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={() => router.push('/calendar')}>
              Calendario
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/events/new')}>
              Asistente completo
            </Button>
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

      <Section columns={4} gap="sm" aria-label="Indicadores de series">
        <KpiCard
          label="Programas"
          value={formatNumber(kpis.total)}
          loading={loading}
          hint="Series y temporadas"
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
        <>
          <Card variant="outline" padding="md">
            <div className={styles.filters}>
              <label className={styles.field}>
                Buscar
                <input
                  value={filters.q}
                  placeholder="Nombre, recinto o resumen"
                  onChange={(e) => setFilters({ q: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                Tipo
                <select
                  value={filters.kind}
                  onChange={(e) =>
                    setFilters({ kind: e.target.value as SeriesFilters['kind'] })
                  }
                >
                  <option value="ALL">Todos</option>
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Estado
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({ status: e.target.value as SeriesFilters['status'] })
                  }
                >
                  <option value="ALL">Todos</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

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
                <Button type="button" variant="outline" onClick={() => router.push('/events/new')}>
                  Asistente completo
                </Button>
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
            <Card variant="outline" padding="none">
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Programa</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Recinto</th>
                      <th scope="col">Recurrencia</th>
                      <th scope="col">Fechas</th>
                      <th scope="col">Próxima</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link
                            href={`/events/series/${row.id}`}
                            className={styles.rowLink}
                          >
                            <strong>{row.name}</strong>
                          </Link>
                          <div className={styles.muted}>
                            {formatDate(row.firstDate)} → {formatDate(row.lastDate)}
                          </div>
                        </td>
                        <td>
                          <Badge tone={kindTone(row.kind)} dot>
                            {KIND_LABELS[row.kind]}
                          </Badge>
                        </td>
                        <td>{row.venue?.name ?? '—'}</td>
                        <td>
                          <span className={styles.muted}>{row.summary ?? '—'}</span>
                        </td>
                        <td>
                          {formatNumber(row.totals.events)}
                          {row.totals.cancelled > 0 && (
                            <span className={styles.muted}>
                              {' '}
                              · {formatNumber(row.totals.cancelled)} cancel.
                            </span>
                          )}
                          <div className={styles.muted}>
                            {formatNumber(row.totals.capacity)} lugares
                          </div>
                        </td>
                        <td>{formatDate(row.nextDate)}</td>
                        <td>
                          <Badge tone={statusTone(row.status)} variant="soft">
                            {STATUS_LABELS[row.status]}
                          </Badge>
                          <div className={styles.muted}>
                            Alta {formatDateTime(row.createdAt)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
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
