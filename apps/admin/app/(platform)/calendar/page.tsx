'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getEventCalendar } from '@/lib/platform-api';
import {
  AnonymousView,
  ApiErrorView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';
import styles from './calendar.module.scss';

type DayEvent = {
  id: string;
  title: string;
  startTime: string;
  venue: string;
  status: string;
};

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/** Monday-first index: Mon=0 … Sun=6 */
function mondayIndex(year: number, month: number, day: number) {
  const d = new Date(year, month - 1, day).getDay();
  return d === 0 ? 6 : d - 1;
}

export default function CalendarPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [calendar, setCalendar] = useState<Record<string, DayEvent[]>>({});
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const session = useSession();
  const token = session.token;

  useEffect(() => {
    if (!token) return;
    setError(null);
    getEventCalendar(token, month, year)
      .then((data) => {
        setCalendar(data.calendar as typeof calendar);
        setTotal(data.totalEvents);
        setSelected(null);
      })
      .catch(setError);
  }, [month, year, token, nonce]);

  const cells = useMemo(() => {
    const totalDays = daysInMonth(year, month);
    const startPad = mondayIndex(year, month, 1);
    const out: { key: string; day: number | null; iso: string | null }[] = [];
    for (let i = 0; i < startPad; i++) out.push({ key: `pad-${i}`, day: null, iso: null });
    for (let d = 1; d <= totalDays; d++) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out.push({ key: iso, day: d, iso });
    }
    while (out.length % 7 !== 0) {
      out.push({ key: `end-${out.length}`, day: null, iso: null });
    }
    return out;
  }, [year, month]);

  const monthLabel = new Date(year, month - 1, 1).toLocaleString('es-MX', {
    month: 'long',
    year: 'numeric',
  });

  const selectedEvents = selected ? calendar[selected] ?? [] : [];
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  function shiftMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="cargar el calendario de eventos"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={platform.pageHeader}>
        <div>
          <h1>Calendario</h1>
          <p>
            {total} evento{total === 1 ? '' : 's'} en {monthLabel}
          </p>
        </div>
        <Link href="/events/new" className={platform.primaryBtn}>
          + Programar
        </Link>
      </header>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
            ←
          </button>
          <strong className={styles.monthTitle}>{monthLabel}</strong>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
            →
          </button>
          <button
            type="button"
            className={styles.todayBtn}
            onClick={() => {
              setMonth(now.getMonth() + 1);
              setYear(now.getFullYear());
              setSelected(todayIso);
            }}
          >
            Hoy
          </button>
        </div>

        <div className={styles.grid} role="grid" aria-label={`Calendario ${monthLabel}`}>
          {WEEKDAYS.map((w) => (
            <div key={w} className={styles.weekday} role="columnheader">
              {w}
            </div>
          ))}
          {cells.map((cell) => {
            if (!cell.day || !cell.iso) {
              return <div key={cell.key} className={styles.emptyCell} />;
            }
            const events = calendar[cell.iso] ?? [];
            const isToday = cell.iso === todayIso;
            const isSelected = cell.iso === selected;
            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                className={`${styles.dayCell} ${isToday ? styles.today : ''} ${isSelected ? styles.selected : ''}`}
                onClick={() => setSelected(cell.iso)}
              >
                <span className={styles.dayNum}>{cell.day}</span>
                <ul className={styles.dots}>
                  {events.slice(0, 3).map((ev) => (
                    <li key={ev.id} title={`${ev.startTime} ${ev.title}`}>
                      <span className={styles.dotTime}>{ev.startTime}</span>
                      <span className={styles.dotTitle}>{ev.title}</span>
                    </li>
                  ))}
                  {events.length > 3 && <li className={styles.more}>+{events.length - 3}</li>}
                </ul>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.detail}>
        <h2>{selected ? selected : 'Selecciona un día'}</h2>
        {!selected && <p className={styles.muted}>Haz clic en un día para ver los eventos.</p>}
        {selected && selectedEvents.length === 0 && (
          <p className={styles.muted}>Sin eventos este día.</p>
        )}
        <ul className={styles.eventList}>
          {selectedEvents.map((ev) => (
            <li key={ev.id}>
              <div>
                <strong>
                  {ev.startTime} · {ev.title}
                </strong>
                <span>
                  {ev.venue} · {ev.status}
                </span>
              </div>
              <Link href={`/events/${ev.id}`} className={platform.ghostBtn}>
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
