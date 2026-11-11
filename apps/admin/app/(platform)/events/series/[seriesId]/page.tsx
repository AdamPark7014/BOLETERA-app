'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { SALE_STATE_LABELS } from '@boletera/shared';
import { ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import {
  extendSeries,
  getSeries,
  updateSeries,
  type EventSeriesStatus,
  type SeriesDetail,
} from '@/lib/scheduling-api';
import { useSession as usePermissions } from '@/lib/use-session';
import { AnonymousView, NoOrgView, useSession } from '../../_shared/api-state';
import { AdminFrame } from '../../_ticket/AdminFrame';
import { Param, Segment, Stepper } from '../../_ticket/controls';
import frame from '../../_ticket/frame.module.scss';
import { formatCount } from '../../_ticket/read';
import { describeFailure } from '../_lib/errors';
import { KIND_LABELS, STATUS_LABELS } from '../_lib/labels';
import styles from '../series.module.scss';

const STATUSES: EventSeriesStatus[] = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'];
const DETAIL_TABS = ['resumen', 'funciones', 'gestion'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function parseTab(value: string | null): DetailTab {
  if (value && (DETAIL_TABS as readonly string[]).includes(value)) return value as DetailTab;
  return 'resumen';
}

function formatUpcomingDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone,
  });
}

function failMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function SeriesDetailPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <SeriesDetailBody />
      </AdminFrame>
    </Suspense>
  );
}

function SeriesDetailBody() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const { can } = usePermissions();
  const canWrite = can('event:write');

  const tab = parseTab(searchParams.get('tab'));
  const setTab = useCallback(
    (next: DetailTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'resumen') params.delete('tab');
      else params.set('tab', next);
      const qs = params.toString();
      router.replace(qs ? `/events/series/${seriesId}?${qs}` : `/events/series/${seriesId}`, {
        scroll: false,
      });
    },
    [router, searchParams, seriesId]
  );

  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [extendCount, setExtendCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!seriesId) return;
    setLoading(true);
    setError(null);
    try {
      setSeries(await getSeries(seriesId));
    } catch (err) {
      setSeries(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  const ready = session.status === 'ready';
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const timezone = series?.timezone ?? 'America/Mexico_City';

  const kpis = useMemo(() => {
    if (!series) return { events: 0, upcoming: 0, onSale: 0, orders: 0, capacity: 0 };
    const now = Date.now();
    return {
      events: series.events.length,
      upcoming: series.events.filter((event) => new Date(event.startsAt).getTime() > now).length,
      onSale: series.events.filter((event) => event.sale.canPurchase).length,
      orders: series.events.reduce((sum, event) => sum + event.counts.orders, 0),
      capacity: series.events.reduce((sum, event) => sum + event.totalCapacity, 0),
    };
  }, [series]);

  const nextEventLabel = useMemo(() => {
    if (!series || series.events.length === 0) return null;
    const now = Date.now();
    const byDate = [...series.events].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    const target = byDate.find((event) => new Date(event.startsAt).getTime() > now) ?? byDate[0];
    return formatUpcomingDate(target.startsAt, timezone);
  }, [series, timezone]);

  async function changeStatus(status: EventSeriesStatus) {
    if (!seriesId || !canWrite) return;
    setActionError(null);
    setNotice(null);
    try {
      setSeries(await updateSeries(seriesId, { status }));
      setNotice(`Estado guardado · ${STATUS_LABELS[status]}`);
    } catch (err) {
      setActionError(failMessage(err, 'No se pudo actualizar.'));
    }
  }

  async function extend() {
    if (!seriesId || !canWrite) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await extendSeries(seriesId, { count: extendCount });
      setSeries(result.series);
      setNotice(`${formatCount(result.added)} fecha(s) agregadas`);
    } catch (err) {
      setActionError(failMessage(err, 'No se pudo extender la serie.'));
    } finally {
      setBusy(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading' || loading)
    return <p className={frame.quiet}>Cargando serie.</p>;

  if (error || !series) {
    const failure = describeFailure(error, `events/schedule/series/${seriesId}`);
    return (
      <section>
        <header className={frame.sectionHead}>
          <h1 className={frame.sectionTitle}>Serie no disponible</h1>
          <p className={styles.links}>
            <Link href="/events/series" className={styles.inlineLink}>
              Volver al catálogo
            </Link>
          </p>
        </header>
        <div className={styles.alert} role="alert">
          <p className={styles.subTitle}>No se pudo cargar la serie</p>
          <p className={frame.danger}>
            {error ? failure.title : 'La serie no existe o no tienes acceso.'}
          </p>
          {error ? (
            <p className={frame.mono}>
              GET /events/schedule/series/{seriesId} · {failure.status ?? 'sin respuesta'} ·{' '}
              {failure.detail}
            </p>
          ) : null}
          <div className={styles.actions}>
            <TicketButton variant="secondary" onClick={() => void load()}>
              Reintentar
            </TicketButton>
          </div>
        </div>
      </section>
    );
  }

  const tabs: { value: DetailTab; label: string }[] = [
    { value: 'resumen', label: 'Resumen' },
    { value: 'funciones', label: `Funciones · ${formatCount(series.events.length)}` },
    ...(canWrite ? [{ value: 'gestion' as const, label: 'Gestión' }] : []),
  ];
  const shownTab: DetailTab = tab === 'gestion' && !canWrite ? 'resumen' : tab;

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>{series.name}</h1>
        <p className={frame.quiet}>
          {KIND_LABELS[series.kind]} · {STATUS_LABELS[series.status]} · {formatCount(kpis.upcoming)}{' '}
          por venir · {formatCount(kpis.onSale)} en venta
        </p>
        <p className={frame.tertiary}>
          {series.description?.trim() ||
            `${series.venue?.name ?? 'Sin recinto'} · ${formatCount(series.events.length)} fechas · ${timezone}`}
        </p>
        <p className={styles.links}>
          <Link href="/events/series" className={styles.inlineLink}>
            Catálogo
          </Link>
          <Link href="/calendar" className={styles.inlineLink}>
            Calendario
          </Link>
        </p>
      </header>

      <div className={styles.block}>
        <div className={styles.figures}>
          <Param name="Fechas">
            <ParameterCard
              name="Fechas"
              value={formatCount(kpis.events)}
              valueStyle="tabular"
              effect={`${formatCount(kpis.upcoming)} por venir.`}
            />
          </Param>
          <Param name="En venta">
            <ParameterCard
              name="En venta"
              value={formatCount(kpis.onSale)}
              valueStyle="tabular"
              effect="Funciones que hoy se pueden comprar."
            />
          </Param>
          <Param name="Órdenes">
            <ParameterCard
              name="Órdenes"
              value={formatCount(kpis.orders)}
              valueStyle="tabular"
              effect="Suma de las funciones."
            />
          </Param>
          <Param name="Aforo total">
            <ParameterCard
              name="Aforo total"
              value={formatCount(kpis.capacity)}
              valueStyle="tabular"
              effect={
                series.template?.basePrice != null
                  ? `Base ${formatTicketAmount(series.template.basePrice)} MXN.`
                  : 'Sin precio en plantilla.'
              }
            />
          </Param>
        </div>
        <Segment label="Detalle de serie" value={shownTab} options={tabs} onChange={setTab} />
      </div>

      {shownTab === 'resumen' ? (
        <div className={styles.block}>
          <h2 className={styles.subTitle}>Recurrencia</h2>
          <p className={frame.quiet}>{series.recurrence?.summary ?? 'Sin regla almacenada.'}</p>
          <ul className={frame.rows}>
            <li className={frame.row}>
              <p className={frame.rowTitle}>Zona horaria</p>
              <span />
              <p className={frame.mono}>{timezone}</p>
            </li>
            <li className={frame.row}>
              <p className={frame.rowTitle}>Recinto</p>
              <span />
              <p className={frame.rowMeta}>{series.venue?.name ?? '—'}</p>
            </li>
            <li className={frame.row}>
              <p className={frame.rowTitle}>Aforo de plantilla</p>
              <span />
              <p className={frame.figure}>
                {series.template?.capacity != null ? formatCount(series.template.capacity) : '—'}
              </p>
            </li>
            <li className={frame.row}>
              <p className={frame.rowTitle}>Precio base</p>
              <span />
              <p className={frame.figure}>
                {series.template?.basePrice != null
                  ? formatTicketAmount(series.template.basePrice)
                  : '—'}
              </p>
            </li>
          </ul>
          {series.events.length === 0 ? (
            <p className={frame.tertiary}>
              Sin funciones. Extiende la serie desde Gestión para agregar fechas.
            </p>
          ) : (
            <p className={frame.quiet}>Próxima función: {nextEventLabel}</p>
          )}
        </div>
      ) : null}

      {shownTab === 'funciones' ? (
        <div className={styles.block}>
          {series.events.length === 0 ? (
            <p className={frame.quiet}>Sin funciones en esta serie.</p>
          ) : (
            <ul className={frame.rows}>
              {series.events.map((event) => (
                <li key={event.id} className={frame.row}>
                  <div className={frame.rowMain}>
                    <p className={frame.rowTitle}>
                      <Link href={`/events/${event.id}`} className={styles.inlineLink}>
                        {event.seriesOrder != null ? `#${event.seriesOrder} · ` : ''}
                        {new Date(event.startsAt).toLocaleDateString('es-MX', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          timeZone: timezone,
                        })}
                      </Link>
                    </p>
                    <p className={frame.rowMeta}>
                      {new Date(event.startsAt).toLocaleTimeString('es-MX', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: timezone,
                      })}{' '}
                      · {SALE_STATE_LABELS[event.sale.state]} · {formatCount(event.counts.orders)}{' '}
                      órdenes
                    </p>
                  </div>
                  <p className={frame.rowMeta}>Aforo</p>
                  <p className={frame.figure}>{formatCount(event.totalCapacity)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {shownTab === 'gestion' ? (
        <div className={styles.block}>
          <h2 className={styles.subTitle}>Extender y estado</h2>
          <Param name="Agregar fechas">
            <ParameterCard
              name="Agregar fechas"
              value={formatCount(extendCount)}
              valueStyle="tabular"
              effect={
                series.recurrence
                  ? 'Agrega fechas siguiendo la regla guardada.'
                  : 'Esta serie no tiene regla de recurrencia almacenada; no se puede extender automáticamente.'
              }
            >
              <Stepper
                value={extendCount}
                min={1}
                max={52}
                label="fechas"
                onChange={setExtendCount}
              />
            </ParameterCard>
          </Param>
          <div className={styles.actions}>
            <TicketButton disabled={!series.recurrence || busy} onClick={() => void extend()}>
              {busy ? 'Extendiendo' : 'Extender serie'}
            </TicketButton>
          </div>
          <Param name="Estado">
            <ParameterCard
              name="Estado"
              value={STATUS_LABELS[series.status]}
              effect="Se guarda al elegir. Borrador, activa, completada o archivada."
            >
              <Segment
                label="Estado"
                value={series.status}
                options={STATUSES.map((status) => ({
                  value: status,
                  label: STATUS_LABELS[status],
                }))}
                onChange={(next) => void changeStatus(next)}
              />
            </ParameterCard>
          </Param>
          {actionError ? (
            <p className={frame.danger} role="alert">
              {actionError}
            </p>
          ) : null}
          {notice ? (
            <p className={frame.quiet} role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
