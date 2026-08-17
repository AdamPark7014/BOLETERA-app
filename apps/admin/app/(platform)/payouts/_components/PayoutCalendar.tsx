'use client';

import { Button, StatusDot } from '@boletera/ui';
import { formatMoney, formatMoneyCompact } from '../_lib/money';
import { PAYOUT_STATUS_META, WEEKDAY_LABELS } from '../_lib/payouts';
import type { CalendarMonth, PayoutRow } from '../_lib/types';
import styles from '../payouts.module.scss';

type PayoutCalendarProps = {
  month: CalendarMonth;
  selectedId: string | null;
  onSelect: (payout: PayoutRow) => void;
  onCursorChange: (next: Date) => void;
  onToday: () => void;
};

function shiftMonth(cursor: Date, months: number): Date {
  return new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
}

/**
 * Calendario de cierres: cada liquidación se ancla al final de su periodo, que
 * es la fecha comprometida de salida del dinero.
 */
export function PayoutCalendar({
  month,
  selectedId,
  onSelect,
  onCursorChange,
  onToday,
}: PayoutCalendarProps) {
  return (
    <section className={styles.card} aria-label="Calendario de liquidaciones">
      <header className={styles.cardHead}>
        <h2>Calendario de pagos</h2>
        <div className={styles.calendarNav}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Mes anterior"
            onClick={() => onCursorChange(shiftMonth(month.cursor, -1))}
          >
            ‹
          </Button>
          <span className={styles.calendarMonth}>{month.label}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Mes siguiente"
            onClick={() => onCursorChange(shiftMonth(month.cursor, 1))}
          >
            ›
          </Button>
          <Button variant="secondary" size="sm" onClick={onToday}>
            Hoy
          </Button>
        </div>
      </header>

      <table className={styles.calendar}>
        <caption className={styles.srOnly}>
          Liquidaciones de {month.label} agrupadas por fecha de cierre de periodo
        </caption>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((weekday) => (
              <th key={weekday} scope="col" abbr={weekday}>
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week) => (
            <tr key={week[0].key}>
              {week.map((day) => (
                <td
                  key={day.key}
                  className={[
                    styles.calendarCell,
                    day.inCurrentMonth ? '' : styles.calendarCellMuted,
                    day.isToday ? styles.calendarCellToday : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={day.isToday ? 'date' : undefined}
                >
                  <span className={styles.calendarDay}>{day.dayOfMonth}</span>
                  {day.payouts.length > 0 && (
                    <>
                      <span className={styles.calendarAmount}>
                        {formatMoneyCompact(day.amountCents)}
                      </span>
                      <ul className={styles.calendarEvents}>
                        {day.payouts.map((payout) => {
                          const meta = PAYOUT_STATUS_META[payout.status];
                          return (
                            <li key={payout.id}>
                              <button
                                type="button"
                                className={
                                  payout.id === selectedId
                                    ? `${styles.calendarEvent} ${styles.calendarEventActive}`
                                    : styles.calendarEvent
                                }
                                onClick={() => onSelect(payout)}
                              >
                                <StatusDot tone={meta.tone} size="sm" />
                                <span className={styles.srOnly}>{meta.label}: </span>
                                {formatMoney(payout.netCents)}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
