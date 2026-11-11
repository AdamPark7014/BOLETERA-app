'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import {
  listSeries,
  type EventSeriesKind,
  type EventSeriesStatus,
  type SeriesRow,
} from '@/lib/scheduling-api';
import { useSession as usePermissions } from '@/lib/use-session';
import { AnonymousView, NoOrgView, useSession } from '../_shared/api-state';
import { AdminFrame } from '../_ticket/AdminFrame';
import { Param, Segment, SheetSelect } from '../_ticket/controls';
import frame from '../_ticket/frame.module.scss';
import { formatCount, formatWhen } from '../_ticket/read';
import { CreateResidencyForm } from './_components/CreateResidencyForm';
import { CreateSeriesForm } from './_components/CreateSeriesForm';
import { describeFailure } from './_lib/errors';
import {
  filterSeries,
  filtersToParams,
  parseFilters,
  seriesKpis,
  type SeriesFilters,
  type SeriesTab,
} from './_lib/filters';
import { KIND_LABELS, STATUS_LABELS } from './_lib/labels';
import styles from './series.module.scss';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { dateStyle: 'medium' });
}

export default function SeriesListPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <SeriesBody />
      </AdminFrame>
    </Suspense>
  );
}

function SeriesBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const { can } = usePermissions();
  const canWrite = can('event:write');

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const [rows, setRows] = useState<SeriesRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const setFilters = useCallback(
    (patch: Partial<SeriesFilters>) => {
      const next = { ...filters, ...patch };
      const qs = filtersToParams(next).toString();
      router.replace(qs ? `/events/series?${qs}` : '/events/series', { scroll: false });
    },
    [filters, router]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listSeries());
    } catch (err) {
      setRows(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const ready = session.status === 'ready';
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const filtered = useMemo(() => (rows ? filterSeries(rows, filters) : []), [rows, filters]);
  const kpis = useMemo(() => seriesKpis(rows ?? []), [rows]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={frame.quiet}>Cargando series.</p>;

  const tabs: { value: SeriesTab; label: string }[] = canWrite
    ? [
        { value: 'catalogo', label: 'Catálogo' },
        { value: 'crear-serie', label: 'Crear serie' },
        { value: 'crear-residencia', label: 'Crear residencia' },
      ]
    : [{ value: 'catalogo', label: 'Catálogo' }];
  const tab: SeriesTab = canWrite ? filters.tab : 'catalogo';
  const failure = error ? describeFailure(error, 'events/schedule/series') : null;

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Series y residencias</h1>
        <p className={frame.quiet}>
          Programas recurrentes y residencias con fechas, aforo y próxima función.
        </p>
        <p className={styles.links}>
          <Link href="/calendar" className={styles.inlineLink}>
            Calendario
          </Link>
          <Link href="/events/new" className={styles.inlineLink}>
            Asistente completo
          </Link>
        </p>
      </header>

      {tabs.length > 1 ? (
        <div className={styles.block}>
          <Segment
            label="Secciones de series"
            value={tab}
            options={tabs}
            onChange={(next) => setFilters({ tab: next })}
          />
        </div>
      ) : (
        <p className={`${frame.tertiary} ${styles.block}`}>
          Sin permiso para crear: el catálogo se lee, no se crean series ni residencias.
        </p>
      )}

      {notice ? (
        <p className={`${frame.quiet} ${styles.block}`} role="status">
          {notice}
        </p>
      ) : null}

      {tab === 'crear-serie' ? (
        <CreateSeriesForm
          disabled={!canWrite}
          onCreated={(message) => {
            setNotice(message);
            setFilters({ tab: 'catalogo' });
            void load();
          }}
        />
      ) : null}

      {tab === 'crear-residencia' ? (
        <CreateResidencyForm
          disabled={!canWrite}
          onCreated={(message) => {
            setNotice(message);
            setFilters({ tab: 'catalogo' });
            void load();
          }}
        />
      ) : null}

      {tab === 'catalogo' ? (
        <div className={styles.block}>
          {loading ? <p className={frame.quiet}>Cargando catálogo.</p> : null}

          {!loading && failure ? (
            <div className={styles.alert} role="alert">
              <p className={styles.subTitle}>No se pudo cargar el catálogo</p>
              <p className={frame.danger}>{failure.title}</p>
              <p className={frame.mono}>
                GET /events/schedule/series · {failure.status ?? 'sin respuesta'} · {failure.detail}
              </p>
              <div className={styles.actions}>
                <TicketButton variant="secondary" onClick={() => void load()}>
                  Reintentar
                </TicketButton>
              </div>
            </div>
          ) : null}

          {!loading && rows ? (
            <>
              <div className={styles.figures}>
                <Param name="Programas">
                  <ParameterCard
                    name="Programas"
                    value={formatCount(kpis.total)}
                    valueStyle="tabular"
                    effect="Series y temporadas."
                  />
                </Param>
                <Param name="Activas">
                  <ParameterCard
                    name="Activas"
                    value={formatCount(kpis.active)}
                    valueStyle="tabular"
                    effect="En estado Activa."
                  />
                </Param>
                <Param name="Fechas próximas">
                  <ParameterCard
                    name="Fechas próximas"
                    value={formatCount(kpis.upcomingDates)}
                    valueStyle="tabular"
                    effect="Funciones por venir."
                  />
                </Param>
                <Param name="Aforo agregado">
                  <ParameterCard
                    name="Aforo agregado"
                    value={formatCount(kpis.capacity)}
                    valueStyle="tabular"
                    effect="Capacidad de todas las fechas."
                  />
                </Param>
              </div>

              {rows.length === 0 ? (
                <p className={frame.quiet}>
                  Todavía no hay series. Crea una serie o residencia, o usa el asistente completo.
                </p>
              ) : (
                <>
                  <div className={styles.filters}>
                    <Field
                      label="Buscar"
                      kind="search"
                      value={filters.q}
                      placeholder="Nombre, recinto o resumen"
                      onChange={(e) => setFilters({ q: e.target.value })}
                    />
                    <div className={styles.pick}>
                      <p className={styles.caption}>Tipo</p>
                      <SheetSelect
                        label="Tipo"
                        value={filters.kind}
                        placeholder="Todos"
                        options={[
                          { value: 'ALL', label: 'Todos' },
                          ...(Object.keys(KIND_LABELS) as EventSeriesKind[]).map((kind) => ({
                            value: kind,
                            label: KIND_LABELS[kind],
                          })),
                        ]}
                        onChange={(next) => setFilters({ kind: next as SeriesFilters['kind'] })}
                      />
                    </div>
                    <div className={styles.pick}>
                      <p className={styles.caption}>Estado</p>
                      <SheetSelect
                        label="Estado"
                        value={filters.status}
                        placeholder="Todos"
                        options={[
                          { value: 'ALL', label: 'Todos' },
                          ...(Object.keys(STATUS_LABELS) as EventSeriesStatus[]).map((status) => ({
                            value: status,
                            label: STATUS_LABELS[status],
                          })),
                        ]}
                        onChange={(next) => setFilters({ status: next as SeriesFilters['status'] })}
                      />
                    </div>
                  </div>

                  <p className={frame.tertiary}>
                    {filtered.length === rows.length
                      ? `${formatCount(filtered.length)} programas`
                      : `${formatCount(filtered.length)} de ${formatCount(rows.length)} programas`}
                  </p>

                  {filtered.length === 0 ? (
                    <div className={styles.actions}>
                      <p className={frame.quiet}>Sin coincidencias.</p>
                      <TicketButton
                        variant="ghost"
                        onClick={() => setFilters({ q: '', kind: 'ALL', status: 'ALL' })}
                      >
                        Limpiar filtros
                      </TicketButton>
                    </div>
                  ) : (
                    <ul className={frame.rows}>
                      {filtered.map((row) => (
                        <li key={row.id} className={frame.row}>
                          <div className={frame.rowMain}>
                            <p className={frame.rowTitle}>
                              <Link href={`/events/series/${row.id}`} className={styles.inlineLink}>
                                {row.name}
                              </Link>
                            </p>
                            <p className={frame.rowMeta}>
                              {KIND_LABELS[row.kind]} · {row.venue?.name ?? 'Sin recinto'} ·{' '}
                              {formatDate(row.firstDate)} → {formatDate(row.lastDate)}
                              {row.summary ? ` · ${row.summary}` : ''}
                            </p>
                            <p className={frame.rowMeta}>
                              Próxima {formatDate(row.nextDate)} ·{' '}
                              {formatCount(row.totals.capacity)} lugares
                              {row.totals.cancelled > 0
                                ? ` · ${formatCount(row.totals.cancelled)} canceladas`
                                : ''}{' '}
                              · alta {formatWhen(row.createdAt)}
                            </p>
                          </div>
                          <p className={frame.rowMeta}>{STATUS_LABELS[row.status]}</p>
                          <p className={frame.figure}>{formatCount(row.totals.events)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
