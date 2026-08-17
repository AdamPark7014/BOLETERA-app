'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { SALE_STATE_LABELS } from '@boletera/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  formatCurrency,
  formatNumber,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  Tabs,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  extendSeries,
  getSeries,
  updateSeries,
  type EventSeriesStatus,
  type SeriesDetail,
} from '@/lib/scheduling-api';
import { useSession } from '@/lib/use-session';
import {
  KIND_LABELS,
  STATUS_LABELS,
  kindTone,
  saleStateTone,
  statusTone,
} from '../_lib/labels';
import styles from './series-detail.module.scss';

const STATUSES: EventSeriesStatus[] = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'];
const DETAIL_TABS = ['resumen', 'funciones', 'gestion'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function parseTab(value: string | null): DetailTab {
  if (value && (DETAIL_TABS as readonly string[]).includes(value)) {
    return value as DetailTab;
  }
  return 'resumen';
}

export default function SeriesDetailPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { can, status: sessionStatus } = useSession();
  const canWrite = can('event:write');

  const tab = parseTab(searchParams.get('tab'));
  const setTab = useCallback(
    (next: DetailTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'resumen') params.delete('tab');
      else params.set('tab', next);
      const qs = params.toString();
      router.replace(
        qs ? `/events/series/${seriesId}?${qs}` : `/events/series/${seriesId}`,
        { scroll: false },
      );
    },
    [router, searchParams, seriesId],
  );

  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extendCount, setExtendCount] = useState(4);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!seriesId) return;
    setLoading(true);
    setError(null);
    try {
      setSeries(await getSeries(seriesId));
    } catch (err) {
      setSeries(null);
      setError(err instanceof Error ? err.message : 'No se pudo cargar la serie');
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    void load();
  }, [load]);

  const timezone = series?.timezone ?? 'America/Mexico_City';

  const kpis = useMemo(() => {
    if (!series) {
      return { events: 0, upcoming: 0, onSale: 0, orders: 0, capacity: 0 };
    }
    const now = Date.now();
    return {
      events: series.events.length,
      upcoming: series.events.filter((event) => new Date(event.startsAt).getTime() > now).length,
      onSale: series.events.filter((event) => event.sale.canPurchase).length,
      orders: series.events.reduce((sum, event) => sum + event.counts.orders, 0),
      capacity: series.events.reduce((sum, event) => sum + event.totalCapacity, 0),
    };
  }, [series]);

  async function changeStatus(status: EventSeriesStatus) {
    if (!seriesId || !canWrite) return;
    try {
      setSeries(await updateSeries(seriesId, { status }));
      toast.success('Serie actualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar');
    }
  }

  async function extend() {
    if (!seriesId || !canWrite) return;
    setBusy(true);
    try {
      const result = await extendSeries(seriesId, { count: extendCount });
      setSeries(result.series);
      toast.success(`${formatNumber(result.added)} fecha(s) agregadas`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo extender la serie');
    } finally {
      setBusy(false);
    }
  }

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className={styles.page}>
        <Skeleton height={96} />
        <Skeleton height={160} />
        <Skeleton height={280} />
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow="Series"
          title="Serie no disponible"
          breadcrumbs={[
            { label: 'Eventos', href: '/events' },
            { label: 'Series', href: '/events/series' },
            { label: 'Detalle' },
          ]}
        />
        <EmptyState
          title="No se pudo cargar la serie"
          description={error ?? 'La serie no existe o no tienes acceso.'}
          illustration="error"
          tone="danger"
          action={
            <Button type="button" onClick={() => void load()}>
              Reintentar
            </Button>
          }
          secondaryAction={
            <Button type="button" variant="outline" onClick={() => router.push('/events/series')}>
              Volver al catálogo
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={KIND_LABELS[series.kind]}
        title={series.name}
        description={
          series.description?.trim() ||
          `${series.venue?.name ?? 'Sin recinto'} · ${formatNumber(series.events.length)} fechas · ${timezone}`
        }
        breadcrumbs={[
          { label: 'Eventos', href: '/events' },
          { label: 'Series', href: '/events/series' },
          { label: series.name },
        ]}
        actions={
          <div className={styles.actions}>
            <Badge tone={kindTone(series.kind)} dot>
              {KIND_LABELS[series.kind]}
            </Badge>
            <Badge tone={statusTone(series.status)}>{STATUS_LABELS[series.status]}</Badge>
            <Button type="button" variant="ghost" onClick={() => router.push('/events/series')}>
              Catálogo
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/calendar')}>
              Calendario
            </Button>
          </div>
        }
      >
        <Tabs
          label="Detalle de serie"
          variant="underline"
          value={tab}
          onValueChange={(id) => setTab(parseTab(id))}
          items={[
            { id: 'resumen', label: 'Resumen' },
            {
              id: 'funciones',
              label: 'Funciones',
              badge: formatNumber(series.events.length),
            },
            { id: 'gestion', label: 'Gestión', disabled: !canWrite },
          ]}
        />
      </PageHeader>

      <Section columns={4} gap="sm" aria-label="Indicadores de la serie">
        <KpiCard
          label="Fechas"
          value={formatNumber(kpis.events)}
          hint={`${formatNumber(kpis.upcoming)} por venir`}
          tone="info"
        />
        <KpiCard
          label="En venta"
          value={formatNumber(kpis.onSale)}
          hint="canPurchase = true"
          tone="success"
        />
        <KpiCard
          label="Órdenes"
          value={formatNumber(kpis.orders)}
          hint="Suma de las funciones"
        />
        <KpiCard
          label="Aforo total"
          value={formatNumber(kpis.capacity)}
          hint={
            series.template?.basePrice != null
              ? `Base ${formatCurrency(series.template.basePrice, 0)}`
              : 'Sin precio en plantilla'
          }
          tone="accent"
        />
      </Section>

      {tab === 'resumen' && (
        <Card variant="outline" padding="lg">
          <CardHeader
            title="Recurrencia"
            description={series.recurrence?.summary ?? 'Sin regla almacenada'}
          />
          <p className={styles.hint}>
            Zona horaria: <strong>{timezone}</strong>
            {series.venue?.name ? (
              <>
                {' '}
                · Recinto: <strong>{series.venue.name}</strong>
              </>
            ) : null}
            {series.template?.capacity != null ? (
              <>
                {' '}
                · Aforo plantilla: <strong>{formatNumber(series.template.capacity)}</strong>
              </>
            ) : null}
          </p>
          {series.events.length === 0 ? (
            <EmptyState
              title="Sin funciones"
              description="Extiende la serie desde la pestaña Gestión para agregar fechas."
              illustration="inbox"
              size="sm"
            />
          ) : (
            <p className={styles.hint} style={{ marginTop: '1rem' }}>
              Próxima función:{' '}
              <strong>
                {(() => {
                  const now = Date.now();
                  const upcoming = series.events
                    .filter((event) => new Date(event.startsAt).getTime() > now)
                    .sort(
                      (a, b) =>
                        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
                    )[0];
                  const target =
                    upcoming ??
                    [...series.events].sort(
                      (a, b) =>
                        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
                    )[0];
                  return new Date(target.startsAt).toLocaleString('es-MX', {
                    dateStyle: 'full',
                    timeStyle: 'short',
                    timeZone: timezone,
                  });
                })()}
              </strong>
            </p>
          )}
        </Card>
      )}

      {tab === 'funciones' && (
        <Card variant="outline" padding="none">
          {series.events.length === 0 ? (
            <EmptyState
              title="Sin funciones en esta serie"
              description="Cuando existan fechas aparecerán aquí con estado de venta y aforo."
              illustration="inbox"
            />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Hora</th>
                    <th scope="col">Estado venta</th>
                    <th scope="col">Órdenes</th>
                    <th scope="col">Aforo</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {series.events.map((event) => (
                    <tr key={event.id}>
                      <td>{event.seriesOrder ?? '—'}</td>
                      <td>
                        {new Date(event.startsAt).toLocaleDateString('es-MX', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          timeZone: timezone,
                        })}
                      </td>
                      <td>
                        {new Date(event.startsAt).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: timezone,
                        })}
                      </td>
                      <td>
                        <Badge tone={saleStateTone(event.sale.state)} dot>
                          {SALE_STATE_LABELS[event.sale.state]}
                        </Badge>
                      </td>
                      <td>{formatNumber(event.counts.orders)}</td>
                      <td>{formatNumber(event.totalCapacity)}</td>
                      <td>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => router.push(`/events/${event.id}`)}
                        >
                          Abrir
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'gestion' && (
        <Card variant="outline" padding="lg">
          {!canWrite ? (
            <EmptyState
              title="Sin permiso event:write"
              description="Solo lectura: no puedes extender ni cambiar el estado."
              illustration="error"
              tone="danger"
            />
          ) : (
            <>
              <CardHeader
                title="Extender y estado"
                description="Agrega fechas siguiendo la regla guardada o cambia el estado del programa."
              />
              <div className={styles.toolbar}>
                <label className={styles.field}>
                  Agregar fechas
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={extendCount}
                    onChange={(e) => setExtendCount(Number(e.target.value) || 1)}
                  />
                </label>
                <Button
                  type="button"
                  loading={busy}
                  disabled={!series.recurrence}
                  onClick={() => void extend()}
                >
                  Extender serie
                </Button>
                <label className={styles.field}>
                  Estado
                  <select
                    value={series.status}
                    onChange={(e) => void changeStatus(e.target.value as EventSeriesStatus)}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!series.recurrence && (
                <p className={styles.hint} style={{ marginTop: '0.75rem' }}>
                  Esta serie no tiene regla de recurrencia almacenada; no se puede extender
                  automáticamente.
                </p>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
