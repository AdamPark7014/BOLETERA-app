'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  SegmentedControl,
  Skeleton,
  formatNumber,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import type { BadgeTone } from '@boletera/ui';
import { useEventCalendar } from '@/lib/queries/events';
import styles from './enterprise.module.scss';

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

type StatusPresentation = {
  label: string;
  tone: BadgeTone;
  className: string;
};

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const VIEW_OPTIONS = [
  { value: 'month', label: 'Mes' },
  { value: 'week', label: 'Semana' },
  { value: 'timeline', label: 'Línea de tiempo' },
] as const;
const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Cómoda' },
  { value: 'compact', label: 'Compacta' },
] as const;

const STATUS_PRESENTATION: Record<string, Omit<StatusPresentation, 'className'>> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  PUBLISHED: { label: 'Publicado', tone: 'success' },
  SCHEDULED: { label: 'Venta programada', tone: 'info' },
  RESCHEDULED: { label: 'Reprogramado', tone: 'warning' },
  LIVE: { label: 'En venta', tone: 'success' },
  COMPLETED: { label: 'Finalizado', tone: 'neutral' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
};

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

function normalizeCalendar(
  calendar: Record<string, unknown[]> | undefined,
): CalendarItem[] {
  if (!calendar) return [];
  return Object.entries(calendar).flatMap(([date, values]) =>
    values.flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = stringField(value, 'id');
      const title = stringField(value, 'title');
      if (!id || !title) return [];
      return [{
        id,
        title,
        date,
        startTime: stringField(value, 'startTime'),
        venue: stringField(value, 'venue'),
        capacity: numberField(value, 'capacity'),
        status: stringField(value, 'status'),
        kind: stringField(value, 'kind'),
      }];
    }),
  );
}

function statusPresentation(status: string): StatusPresentation {
  const presentation = STATUS_PRESENTATION[status] ?? {
    label: status ? status.replaceAll('_', ' ').toLocaleLowerCase('es-MX') : 'Sin estado',
    tone: 'neutral' as const,
  };
  const classByStatus: Record<string, string> = {
    DRAFT: styles.statusDraft,
    PUBLISHED: styles.statusLive,
    SCHEDULED: styles.statusScheduled,
    RESCHEDULED: styles.statusRescheduled,
    LIVE: styles.statusLive,
    COMPLETED: styles.statusCompleted,
    CANCELLED: styles.statusCancelled,
  };
  return {
    ...presentation,
    className: classByStatus[status] ?? styles.statusUnknown,
  };
}

function formatRangeTitle(view: CalendarView, anchor: Date) {
  if (view === 'month') {
    return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(anchor);
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return `${from.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return `Agenda de ${new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(anchor)}`;
}

function CalendarSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Cargando calendario">
      <div className={styles.skeletonKpis}>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={104} radius={12} delay={index * 70} />
        ))}
      </div>
      <Skeleton height={52} radius={10} />
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 35 }, (_, index) => (
          <Skeleton key={index} height={92} radius={8} delay={(index % 7) * 45} />
        ))}
      </div>
    </div>
  );
}

function CalendarContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filterRef = useRef<HTMLDivElement>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const viewParam = searchParams.get('view');
  const view: CalendarView =
    viewParam === 'week' || viewParam === 'timeline' ? viewParam : 'month';
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
    [pathname, router, searchParams],
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
        view === 'week'
          ? addDays(anchor, direction * 7)
          : monthOffset(anchor, direction);
      setSelectedDate(null);
      updateUrl({ range: localIso(shifted) });
    },
    [anchor, updateUrl, view],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLElement && target.closest('[role="radiogroup"]'))
      ) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        shiftRange(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        shiftRange(1);
      } else if (event.key.toLocaleLowerCase('es-MX') === 't') {
        updateUrl({ range: localIso(new Date()) });
      } else if (event.key.toLocaleLowerCase('es-MX') === 'm') {
        updateUrl({ view: 'month' });
      } else if (event.key.toLocaleLowerCase('es-MX') === 'w') {
        updateUrl({ view: 'week' });
      } else if (event.key.toLocaleLowerCase('es-MX') === 'l') {
        updateUrl({ view: 'timeline' });
      } else if (event.key === '/') {
        event.preventDefault();
        filterRef.current?.focus();
      } else if (event.key === '?') {
        setShowShortcuts((current) => !current);
      } else if (event.key === 'Escape') {
        setShowShortcuts(false);
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

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const statusOptions = Array.from(
      new Set(allEvents.map((event) => event.status).filter(Boolean)),
    ).sort();
    const venueOptions = Array.from(
      new Set(allEvents.map((event) => event.venue).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right, 'es-MX'));

    return [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: statusOptions.map((status) => ({
          value: status,
          label: statusPresentation(status).label,
          count: allEvents.filter((event) => event.status === status).length,
        })),
      },
      {
        id: 'venue',
        label: 'Recinto',
        multiple: false,
        options: venueOptions.map((venue) => ({
          value: venue,
          label: venue,
          count: allEvents.filter((event) => event.venue === venue).length,
        })),
      },
    ];
  }, [allEvents]);

  const filterSelection = useMemo<FilterSelection>(() => {
    const draft: Record<string, readonly string[]> = {};
    if (statusFilter) draft.status = [statusFilter];
    if (venueFilter) draft.venue = [venueFilter];
    return draft;
  }, [statusFilter, venueFilter]);

  const statuses = useMemo(
    () => Array.from(new Set(allEvents.map((event) => event.status).filter(Boolean))).sort(),
    [allEvents],
  );

  const eventsByDay = new Map<string, CalendarItem[]>();
  visibleEvents.forEach((event) => {
    const events = eventsByDay.get(event.date) ?? [];
    events.push(event);
    eventsByDay.set(event.date, events);
  });
  eventsByDay.forEach((events) =>
    events.sort((left, right) => left.startTime.localeCompare(right.startTime, 'es-MX')),
  );

  const monthCells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [anchor]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)),
    [anchor],
  );

  const relevantQueries = [previousQuery, currentQuery, nextQuery];
  const isPending = relevantQueries.some((query) => query.isPending);
  const isError = relevantQueries.some((query) => query.isError);
  const selectedEvents = selectedDate ? eventsByDay.get(selectedDate) ?? [] : [];
  const capacity = visibleEvents.reduce((total, event) => total + event.capacity, 0);
  const activeFilters = Number(Boolean(statusFilter)) + Number(Boolean(venueFilter));
  const today = localIso(new Date());

  const retry = () => {
    relevantQueries.forEach((query) => {
      void query.refetch();
    });
  };

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Calendario operativo"
        description="Coordina la programación real de eventos, recintos y estados de venta."
        breadcrumbs={[{ label: 'Panel', href: '/dashboard' }, { label: 'Calendario' }]}
        actions={
          <div className={styles.headerActions}>
            <Link href="/events" className={styles.secondaryLink}>Eventos</Link>
            <Link href="/events/series" className={styles.secondaryLink}>Ver series</Link>
            <Link href="/events/new" className={styles.primaryLink}>Programar evento</Link>
          </div>
        }
      />

      {!isPending && !isError ? (
        <section className={styles.kpiStrip} aria-label="Indicadores del rango visible">
          <KpiCard
            label="Eventos"
            value={formatNumber(visibleEvents.length)}
            hint="En el rango visible"
          />
          <KpiCard
            label="Días con actividad"
            value={formatNumber(eventsByDay.size)}
            tone="info"
            hint="Con al menos un evento"
          />
          <KpiCard
            label="Recintos"
            value={formatNumber(
              new Set(visibleEvents.map((event) => event.venue).filter(Boolean)).size,
            )}
            hint="Recintos programados"
          />
          <KpiCard
            label="Aforo programado"
            value={formatNumber(capacity)}
            tone="success"
            hint="Capacidad declarada"
          />
        </section>
      ) : null}

      <section className={styles.calendarCard} aria-labelledby="calendar-range-title">
        <div className={styles.commandBar}>
          <div className={styles.rangeNavigation}>
            <Button variant="outline" size="sm" iconOnly aria-label="Rango anterior" onClick={() => shiftRange(-1)}>←</Button>
            <div className={styles.rangeTitle}>
              <span id="calendar-range-title">{formatRangeTitle(view, anchor)}</span>
              <small>← → para navegar · ? para atajos</small>
            </div>
            <Button variant="outline" size="sm" iconOnly aria-label="Rango siguiente" onClick={() => shiftRange(1)}>→</Button>
            <Button variant="secondary" size="sm" onClick={() => updateUrl({ range: localIso(new Date()) })}>Hoy</Button>
          </div>
          <SegmentedControl
            label="Vista del calendario"
            size="sm"
            value={view}
            options={VIEW_OPTIONS}
            onValueChange={(value) => updateUrl({ view: value })}
          />
        </div>

        <div
          ref={filterRef}
          className={styles.filters}
          aria-label="Filtros del calendario"
          tabIndex={-1}
        >
          <FilterBar
            filters={filterDefs}
            value={filterSelection}
            onChange={(next) => {
              updateUrl({
                status: next.status?.[0] ?? null,
                venue: next.venue?.[0] ?? null,
              });
            }}
          >
            <div className={styles.densityControl}>
              <span>Densidad</span>
              <SegmentedControl
                label="Densidad de eventos"
                size="sm"
                value={density}
                options={DENSITY_OPTIONS}
                onValueChange={(value) =>
                  updateUrl({ density: value === 'comfortable' ? null : value })
                }
              />
            </div>
          </FilterBar>
          {activeFilters > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateUrl({ status: null, venue: null })}
            >
              Limpiar filtros ({activeFilters})
            </Button>
          ) : null}
        </div>

        <div className={styles.legend} aria-label="Leyenda de estados">
          {statuses.map((status) => {
            const presentation = statusPresentation(status);
            return <Badge key={status} tone={presentation.tone} dot>{presentation.label}</Badge>;
          })}
        </div>

        {showShortcuts ? (
          <aside className={styles.shortcuts} aria-label="Atajos de teclado">
            <strong>Atajos</strong>
            <span><kbd>←</kbd><kbd>→</kbd> rango</span>
            <span><kbd>T</kbd> hoy</span>
            <span><kbd>M</kbd> mes</span>
            <span><kbd>W</kbd> semana</span>
            <span><kbd>L</kbd> línea de tiempo</span>
            <span><kbd>/</kbd> filtros</span>
          </aside>
        ) : null}

        {isPending ? <CalendarSkeleton /> : null}
        {!isPending && isError ? (
          <EmptyState
            title="No pudimos cargar el calendario"
            description="Revisa tu conexión e intenta consultar nuevamente los eventos."
            illustration="error"
            tone="danger"
            action={<Button onClick={retry}>Reintentar</Button>}
          />
        ) : null}
        {!isPending && !isError && visibleEvents.length === 0 ? (
          <EmptyState
            title={activeFilters ? 'No hay eventos con estos filtros' : 'No hay eventos programados'}
            description={activeFilters ? 'Ajusta los filtros para ampliar los resultados.' : 'Programa un evento para comenzar a operar este rango.'}
            illustration="inbox"
            action={<Link href="/events/new" className={styles.primaryLink}>Programar evento</Link>}
            secondaryAction={activeFilters ? <Button variant="ghost" onClick={() => updateUrl({ status: null, venue: null })}>Limpiar filtros</Button> : undefined}
          />
        ) : null}

        {!isPending && !isError && visibleEvents.length > 0 && view === 'month' ? (
          <div className={`${styles.monthGrid} ${styles[density]}`} role="grid" aria-label={`Calendario de ${formatRangeTitle(view, anchor)}`}>
            {WEEKDAYS.map((day) => <div key={day} className={styles.weekday} role="columnheader">{day}</div>)}
            {monthCells.map((day) => {
              const date = localIso(day);
              const events = eventsByDay.get(date) ?? [];
              const outside = day.getMonth() !== anchor.getMonth();
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  aria-label={`${day.toLocaleDateString('es-MX', { dateStyle: 'full' })}, ${events.length} eventos`}
                  aria-selected={selectedDate === date}
                  className={`${styles.dayCell} ${outside ? styles.outsideMonth : ''} ${date === today ? styles.today : ''} ${selectedDate === date ? styles.selected : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  <span className={styles.dayNumber}>{day.getDate()}</span>
                  <span className={styles.dayEvents}>
                    {events.slice(0, density === 'compact' ? 2 : 4).map((event) => {
                      const presentation = statusPresentation(event.status);
                      return (
                        <span key={event.id} className={`${styles.eventPill} ${presentation.className}`}>
                          <span>{event.startTime}</span>
                          <strong>{event.title}</strong>
                        </span>
                      );
                    })}
                    {events.length > (density === 'compact' ? 2 : 4) ? (
                      <span className={styles.moreEvents}>+{events.length - (density === 'compact' ? 2 : 4)} más</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {!isPending && !isError && visibleEvents.length > 0 && view === 'week' ? (
          <div className={`${styles.weekGrid} ${styles[density]}`} aria-label={`Semana ${formatRangeTitle(view, anchor)}`}>
            {weekDays.map((day) => {
              const date = localIso(day);
              const events = eventsByDay.get(date) ?? [];
              return (
                <section key={date} className={`${styles.weekColumn} ${date === today ? styles.today : ''}`} aria-labelledby={`day-${date}`}>
                  <header><span id={`day-${date}`}>{day.toLocaleDateString('es-MX', { weekday: 'long' })}</span><strong>{day.getDate()}</strong></header>
                  {events.length === 0 ? <span className={styles.noEvents}>Sin eventos</span> : events.map((event) => <EventCard key={event.id} event={event} density={density} />)}
                </section>
              );
            })}
          </div>
        ) : null}

        {!isPending && !isError && visibleEvents.length > 0 && view === 'timeline' ? (
          <div className={styles.timeline}>
            {Array.from(eventsByDay.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, events]) => (
              <section key={date} className={styles.timelineDay} aria-labelledby={`timeline-${date}`}>
                <div className={styles.timelineDate}>
                  <strong id={`timeline-${date}`}>{new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</strong>
                  <span>{new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long' })}</span>
                </div>
                <div className={styles.timelineEvents}>{events.map((event) => <EventCard key={event.id} event={event} density={density} />)}</div>
              </section>
            ))}
          </div>
        ) : null}
      </section>

      {view === 'month' && selectedDate ? (
        <section className={styles.dayDetail} aria-labelledby="selected-day-title">
          <div>
            <span className={styles.eyebrow}>Detalle del día</span>
            <h2 id="selected-day-title">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-MX', { dateStyle: 'full' })}</h2>
          </div>
          {selectedEvents.length ? (
            <div className={styles.detailEvents}>{selectedEvents.map((event) => <EventCard key={event.id} event={event} density="comfortable" />)}</div>
          ) : <p className={styles.noEvents}>Sin eventos para este día.</p>}
        </section>
      ) : null}
    </main>
  );
}

function EventCard({ event, density }: { event: CalendarItem; density: Density }) {
  const presentation = statusPresentation(event.status);
  return (
    <Link href={`/events/${event.id}`} className={`${styles.eventCard} ${presentation.className} ${styles[density]}`}>
      <div className={styles.eventCardTop}>
        <time>{event.startTime || 'Hora por confirmar'}</time>
        <Badge tone={presentation.tone} size="sm">{presentation.label}</Badge>
      </div>
      <strong>{event.title}</strong>
      <span>{event.venue || 'Recinto por confirmar'}</span>
      {density === 'comfortable' ? (
        <small>
          {formatNumber(event.capacity)} lugares · {event.kind || 'evento'}
        </small>
      ) : null}
    </Link>
  );
}

export default function CalendarEnterprise() {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <CalendarContent />
    </Suspense>
  );
}

