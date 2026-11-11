'use client';

/**
 * Calendario: programación de eventos por mes, semana o agenda.
 *
 * Solo lectura. Pide el mes anterior, el visible y el siguiente a
 * `/events/manage/calendar/:mes/:año` (para que la semana que cruza meses salga
 * completa) y guarda vista, rango y filtros en la URL.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TicketButton } from '@boletera/ui';
import { HttpError } from '@/lib/http';
import { useEventCalendar } from '@/lib/queries/events';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount } from '../events/_ticket/read';
import local from './calendar.module.scss';

type CalendarView = 'month' | 'week' | 'timeline';
type Density = 'comfortable' | 'compact';

type CalendarItem = {
  id: string;
  title: string;
  startTime: string;
  venue: string;
  capacity: number;
  status: string;
  kind: string;
  date: string;
};

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: 'month', label: 'Mes' },
  { value: 'week', label: 'Semana' },
  { value: 'timeline', label: 'Agenda' },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Cómoda' },
  { value: 'compact', label: 'Compacta' },
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicado',
  SCHEDULED: 'Venta programada',
  RESCHEDULED: 'Reprogramado',
  LIVE: 'En venta',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

function statusLabel(status: string): string {
  if (!status) return 'Sin estado';
  return STATUS_LABEL[status] ?? status.replaceAll('_', ' ').toLocaleLowerCase('es-MX');
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseRange(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
    if (!Number.isNaN(parsed.getTime()) && localIso(parsed) === value) return parsed;
  }
  return new Date();
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay() === 0 ? 7 : date.getDay();
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), 1 - day);
}

function monthOffset(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' ? value[key] : '';
}

function numberField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : 0;
}

function normalizeCalendar(calendar: Record<string, unknown[]> | undefined): CalendarItem[] {
  if (!calendar) return [];
  return Object.entries(calendar).flatMap(([date, values]) =>
    values.flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = stringField(value, 'id');
      const title = stringField(value, 'title');
      if (!id || !title) return [];
      return [
        {
          id,
          title,
          date,
          startTime: stringField(value, 'startTime'),
          venue: stringField(value, 'venue'),
          capacity: numberField(value, 'capacity'),
          status: stringField(value, 'status'),
          kind: stringField(value, 'kind'),
        },
      ];
    })
  );
}

function formatRangeTitle(view: CalendarView, anchor: Date) {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return `${from.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(anchor);
}

function longDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { dateStyle: 'full' });
}

function errorText(error: unknown): string {
  if (error instanceof HttpError) {
    return error.status ? `Error ${error.status} · ${error.message}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'No se pudo consultar el calendario.';
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <CalendarioBody />
      </AdminFrame>
    </Suspense>
  );
}

function CalendarioBody() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando calendario.</p>;
  return <CalendarContent />;
}

function CalendarContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const viewParam = searchParams.get('view');
  const view: CalendarView = viewParam === 'week' || viewParam === 'timeline' ? viewParam : 'month';
  const density: Density = searchParams.get('density') === 'compact' ? 'compact' : 'comfortable';
  const statusFilter = searchParams.get('status') ?? '';
  const venueFilter = searchParams.get('venue') ?? '';
  const anchor = parseRange(searchParams.get('range'));

  const previousMonth = monthOffset(anchor, -1);
  const currentMonth = monthOffset(anchor, 0);
  const nextMonth = monthOffset(anchor, 1);
  const previousQuery = useEventCalendar(previousMonth.getMonth() + 1, previousMonth.getFullYear());
  const currentQuery = useEventCalendar(currentMonth.getMonth() + 1, currentMonth.getFullYear());
  const nextQuery = useEventCalendar(nextMonth.getMonth() + 1, nextMonth.getFullYear());

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value) next.set(key, value);
        else next.delete(key);
      });
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const defaults: Record<string, string | null> = {};
    if (!searchParams.get('view')) defaults.view = 'month';
    if (!searchParams.get('range')) defaults.range = localIso(new Date());
    if (Object.keys(defaults).length > 0) updateUrl(defaults);
  }, [searchParams, updateUrl]);

  const shiftRange = useCallback(
    (direction: number) => {
      const shifted =
        view === 'week' ? addDays(anchor, direction * 7) : monthOffset(anchor, direction);
      setSelectedDate(null);
      updateUrl({ range: localIso(shifted) });
    },
    [anchor, updateUrl, view]
  );

  // Atajos de teclado. «/» queda para el buscador del índice.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLElement && target.closest('[role="radiogroup"]'))
      )
        return;
      const key = event.key.toLocaleLowerCase('es-MX');
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        shiftRange(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        shiftRange(1);
      } else if (key === 't') {
        updateUrl({ range: localIso(new Date()) });
      } else if (key === 'm') {
        updateUrl({ view: 'month' });
      } else if (key === 'w') {
        updateUrl({ view: 'week' });
      } else if (key === 'l') {
        updateUrl({ view: 'timeline' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shiftRange, updateUrl]);

  const allEvents = useMemo(() => {
    const merged = [
      ...normalizeCalendar(previousQuery.data?.calendar),
      ...normalizeCalendar(currentQuery.data?.calendar),
      ...normalizeCalendar(nextQuery.data?.calendar),
    ];
    return Array.from(new Map(merged.map((event) => [event.id, event])).values());
  }, [currentQuery.data, nextQuery.data, previousQuery.data]);

  const monthStart = localIso(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const monthEnd = localIso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
  const weekStart = localIso(startOfWeek(anchor));
  const weekEnd = localIso(addDays(startOfWeek(anchor), 6));
  const visibleEvents = allEvents.filter((event) => {
    const inRange =
      view === 'week'
        ? event.date >= weekStart && event.date <= weekEnd
        : event.date >= monthStart && event.date <= monthEnd;
    return (
      inRange &&
      (!statusFilter || event.status === statusFilter) &&
      (!venueFilter || event.venue === venueFilter)
    );
  });

  const statusOptions = useMemo(() => {
    const values = Array.from(
      new Set(allEvents.map((event) => event.status).filter(Boolean))
    ).sort();
    return [
      { value: '', label: 'Todos los estados' },
      ...values.map((status) => ({
        value: status,
        label: `${statusLabel(status)} · ${allEvents.filter((event) => event.status === status).length}`,
      })),
    ];
  }, [allEvents]);

  const venueOptions = useMemo(() => {
    const values = Array.from(new Set(allEvents.map((event) => event.venue).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b, 'es-MX')
    );
    return [
      { value: '', label: 'Todos los recintos' },
      ...values.map((venue) => ({
        value: venue,
        label: `${venue} · ${allEvents.filter((event) => event.venue === venue).length}`,
      })),
    ];
  }, [allEvents]);

  const eventsByDay = new Map<string, CalendarItem[]>();
  visibleEvents.forEach((event) => {
    const events = eventsByDay.get(event.date) ?? [];
    events.push(event);
    eventsByDay.set(event.date, events);
  });
  eventsByDay.forEach((events) =>
    events.sort((a, b) => a.startTime.localeCompare(b.startTime, 'es-MX'))
  );

  const monthCells = useMemo(() => {
    const gridStart = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [anchor]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)),
    [anchor]
  );

  const queries = [previousQuery, currentQuery, nextQuery];
  const isPending = queries.some((query) => query.isPending);
  const failed = queries.find((query) => query.isError);
  const capacity = visibleEvents.reduce((total, event) => total + event.capacity, 0);
  const venues = new Set(visibleEvents.map((event) => event.venue).filter(Boolean)).size;
  const activeFilters = Number(Boolean(statusFilter)) + Number(Boolean(venueFilter));
  const today = localIso(new Date());
  const perCell = density === 'compact' ? 2 : 4;
  const selectedEvents = selectedDate ? (eventsByDay.get(selectedDate) ?? []) : [];

  const retry = () => {
    queries.forEach((query) => {
      void query.refetch();
    });
  };

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Calendario</h1>
        <p className={styles.quiet}>{formatRangeTitle(view, anchor)}</p>
      </header>

      <div className={styles.stack}>
        <div className={local.toolbar}>
          <TicketButton variant="ghost" aria-label="Rango anterior" onClick={() => shiftRange(-1)}>
            Anterior
          </TicketButton>
          <TicketButton
            variant="secondary"
            onClick={() => updateUrl({ range: localIso(new Date()) })}
          >
            Hoy
          </TicketButton>
          <TicketButton variant="ghost" aria-label="Rango siguiente" onClick={() => shiftRange(1)}>
            Siguiente
          </TicketButton>
          <Segment
            label="Vista del calendario"
            value={view}
            options={VIEW_OPTIONS}
            onChange={(value) => updateUrl({ view: value })}
          />
        </div>
        <p className={styles.tertiary}>
          ← → cambian el rango · T hoy · M mes · W semana · L agenda
        </p>

        <div className={local.filters}>
          <div>
            <p className={local.filterLabel}>Estado</p>
            <SheetSelect
              label="Estado"
              value={statusFilter}
              placeholder="Todos los estados"
              options={statusOptions}
              onChange={(value) => updateUrl({ status: value || null })}
            />
          </div>
          <div>
            <p className={local.filterLabel}>Recinto</p>
            <SheetSelect
              label="Recinto"
              value={venueFilter}
              placeholder="Todos los recintos"
              options={venueOptions}
              onChange={(value) => updateUrl({ venue: value || null })}
            />
          </div>
          <div>
            <p className={local.filterLabel}>Densidad</p>
            <Segment
              label="Densidad de eventos"
              value={density}
              options={DENSITY_OPTIONS}
              onChange={(value) => updateUrl({ density: value === 'comfortable' ? null : value })}
            />
          </div>
        </div>
        {activeFilters > 0 ? (
          <div>
            <TicketButton variant="ghost" onClick={() => updateUrl({ status: null, venue: null })}>
              Limpiar filtros ({activeFilters})
            </TicketButton>
          </div>
        ) : null}
      </div>

      {failed ? (
        <div className={`${styles.stack} ${local.block}`}>
          <p className={styles.danger} role="alert">
            No se pudo cargar el calendario. {errorText(failed.error)}
          </p>
          <div>
            <TicketButton variant="secondary" onClick={retry}>
              Reintentar
            </TicketButton>
          </div>
        </div>
      ) : isPending ? (
        <p className={`${styles.quiet} ${local.block}`}>Cargando calendario.</p>
      ) : (
        <>
          <ul className={`${styles.rows} ${local.block}`} aria-label="Cifras del rango visible">
            <li className={styles.row}>
              <p className={styles.rowTitle}>Eventos</p>
              <span />
              <p className={styles.figure}>{formatCount(visibleEvents.length)}</p>
            </li>
            <li className={styles.row}>
              <p className={styles.rowTitle}>Días con actividad</p>
              <span />
              <p className={styles.figure}>{formatCount(eventsByDay.size)}</p>
            </li>
            <li className={styles.row}>
              <p className={styles.rowTitle}>Recintos</p>
              <span />
              <p className={styles.figure}>{formatCount(venues)}</p>
            </li>
            <li className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Aforo programado</p>
                <p className={styles.rowMeta}>Capacidad declarada</p>
              </div>
              <span />
              <p className={styles.figure}>{formatCount(capacity)}</p>
            </li>
          </ul>

          {visibleEvents.length === 0 ? (
            <div className={`${styles.stack} ${local.block}`}>
              <p className={styles.quiet}>
                {activeFilters
                  ? 'No hay eventos con estos filtros.'
                  : 'No hay eventos programados en este rango.'}
              </p>
            </div>
          ) : null}

          {visibleEvents.length > 0 && view === 'month' ? (
            <div
              className={`${local.grid} ${local.block} ${density === 'compact' ? local.compact : ''}`}
              role="grid"
              aria-label={`Calendario de ${formatRangeTitle(view, anchor)}`}
            >
              {WEEKDAYS.map((day) => (
                <div key={day} className={local.weekday} role="columnheader">
                  {day}
                </div>
              ))}
              {monthCells.map((day) => {
                const date = localIso(day);
                const events = eventsByDay.get(date) ?? [];
                const classes = [
                  local.cell,
                  day.getMonth() !== anchor.getMonth() ? local.outside : '',
                  date === today ? local.today : '',
                  selectedDate === date ? local.selected : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    aria-label={`${day.toLocaleDateString('es-MX', { dateStyle: 'full' })}, ${events.length} eventos`}
                    aria-selected={selectedDate === date}
                    className={classes}
                    onClick={() => setSelectedDate(selectedDate === date ? null : date)}
                  >
                    <span className={local.dayNumber}>{day.getDate()}</span>
                    {events.length > 0 ? (
                      <span className={local.count}>{events.length}</span>
                    ) : null}
                    {events.slice(0, perCell).map((event) => (
                      <span key={event.id} className={local.item}>
                        {event.startTime ? <time>{event.startTime} </time> : null}
                        {event.title}
                      </span>
                    ))}
                    {events.length > perCell ? (
                      <span className={local.item}>+{events.length - perCell} más</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {visibleEvents.length > 0 && view === 'week' ? (
            <div
              className={`${local.week} ${local.block}`}
              aria-label={`Semana ${formatRangeTitle(view, anchor)}`}
            >
              {weekDays.map((day) => {
                const date = localIso(day);
                const events = eventsByDay.get(date) ?? [];
                return (
                  <section key={date} className={local.weekDay} aria-labelledby={`dia-${date}`}>
                    <p id={`dia-${date}`} className={local.weekHead}>
                      {day.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric' })}
                      {date === today ? ' · hoy' : ''}
                    </p>
                    {events.length === 0 ? <p className={styles.tertiary}>Sin eventos</p> : null}
                    {events.map((event) => (
                      <EventLine key={event.id} event={event} density={density} />
                    ))}
                  </section>
                );
              })}
            </div>
          ) : null}

          {visibleEvents.length > 0 && view === 'timeline' ? (
            <div className={`${styles.stack} ${local.block}`}>
              {Array.from(eventsByDay.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, events]) => (
                  <DayRows key={date} date={date} events={events} density={density} />
                ))}
            </div>
          ) : null}

          {view === 'month' && selectedDate ? (
            <div className={local.block}>
              <DayRows date={selectedDate} events={selectedEvents} density="comfortable" />
            </div>
          ) : null}
        </>
      )}

      <div className={`${styles.saveBar} ${local.footer}`}>
        <Link href="/events/series" className={local.link}>
          Ver series
        </Link>
        <TicketButton onClick={() => router.push('/events/new')}>Programar evento</TicketButton>
      </div>
    </section>
  );
}

function DayRows({
  date,
  events,
  density,
}: {
  date: string;
  events: CalendarItem[];
  density: Density;
}) {
  return (
    <section aria-label={longDay(date)}>
      <p className={styles.rowMeta}>{longDay(date)}</p>
      {events.length === 0 ? <p className={styles.tertiary}>Sin eventos para este día.</p> : null}
      <ul className={styles.rows}>
        {events.map((event) => (
          <li key={event.id} className={styles.row}>
            <div className={styles.rowMain}>
              <Link href={`/events/${event.id}`} className={local.eventLink}>
                {event.title}
              </Link>
              <p className={styles.rowMeta}>
                {[event.venue || 'Recinto por confirmar', statusLabel(event.status)]
                  .concat(density === 'comfortable' && event.kind ? [event.kind] : [])
                  .join(' · ')}
              </p>
            </div>
            <p className={styles.tertiary}>{event.startTime || 'Hora por confirmar'}</p>
            <p className={styles.figure}>{formatCount(event.capacity)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventLine({ event, density }: { event: CalendarItem; density: Density }) {
  return (
    <div>
      <Link href={`/events/${event.id}`} className={local.eventLink}>
        {event.title}
      </Link>
      <p className={styles.rowMeta}>
        {[event.startTime || 'Hora por confirmar', statusLabel(event.status)].join(' · ')}
      </p>
      {density === 'comfortable' ? (
        <p className={styles.rowMeta}>
          {event.venue || 'Recinto por confirmar'} · {formatCount(event.capacity)} lugares
        </p>
      ) : null}
    </div>
  );
}
