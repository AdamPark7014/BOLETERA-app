'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecurrenceRule, Weekday } from '@boletera/shared';
import { describeRecurrence } from '@boletera/shared';
import { previewSchedule, type SchedulePreview, type SeriesTemplate } from '@/lib/scheduling-api';
import styles from './ScheduleBuilder.module.scss';

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'M' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 0, label: 'D' },
];

const CONFLICT_LABELS: Record<string, string> = {
  VENUE_OVERLAP: 'Traslape',
  TURNAROUND: 'Margen corto',
  BLACKOUT: 'Recinto bloqueado',
  DUPLICATE: 'Duplicado',
};

export type ScheduleMode = 'single' | 'recurring';

export type ScheduleBuilderValue = {
  mode: ScheduleMode;
  rule: RecurrenceRule;
};

type Props = {
  venueId: string;
  timezone: string;
  template: Partial<SeriesTemplate>;
  value: ScheduleBuilderValue;
  onChange: (value: ScheduleBuilderValue) => void;
  onPreview?: (preview: SchedulePreview | null) => void;
  turnaroundMinutes?: number;
  excludeSeriesId?: string;
};

/**
 * Recurrence editor with a live server-side preview: every keystroke re-expands
 * the rule in the API so the operator sees the exact dates and venue conflicts
 * before anything is written.
 */
export function ScheduleBuilder({
  venueId,
  timezone,
  template,
  value,
  onChange,
  onPreview,
  turnaroundMinutes,
  excludeSeriesId,
}: Props) {
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const { mode, rule } = value;
  const patchRule = useCallback(
    (patch: Partial<RecurrenceRule>) => onChange({ mode, rule: { ...rule, ...patch } }),
    [mode, rule, onChange],
  );

  const summary = useMemo(() => {
    if (mode === 'single') return null;
    try {
      return describeRecurrence(rule);
    } catch {
      return null;
    }
  }, [mode, rule]);

  const canPreview = Boolean(venueId && rule.startLocal);

  useEffect(() => {
    if (!canPreview) {
      setPreview(null);
      onPreview?.(null);
      return;
    }
    const effectiveRule: RecurrenceRule =
      mode === 'single'
        ? { frequency: 'DAILY', startLocal: rule.startLocal, timezone, count: 1 }
        : { ...rule, timezone };

    const id = ++requestId.current;
    const timer = setTimeout(() => {
      setLoading(true);
      previewSchedule({
        rule: effectiveRule,
        venueId,
        template,
        turnaroundMinutes,
        excludeSeriesId,
      })
        .then((data) => {
          // Ignore responses from superseded keystrokes.
          if (id !== requestId.current) return;
          setPreview(data);
          setError(null);
          onPreview?.(data);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setPreview(null);
          onPreview?.(null);
          setError(err instanceof Error ? err.message : 'No se pudo calcular la programación');
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 350);

    return () => clearTimeout(timer);
    // `template` is a fresh object each render; its JSON is the real dependency.
  }, [
    canPreview,
    mode,
    venueId,
    timezone,
    turnaroundMinutes,
    excludeSeriesId,
    JSON.stringify(rule),
    JSON.stringify(template),
  ]);

  function toggleWeekday(day: Weekday) {
    const current = rule.byWeekday ?? [];
    const next = current.includes(day)
      ? current.filter((item) => item !== day)
      : [...current, day];
    patchRule({ byWeekday: next.length ? next : undefined });
  }

  function toggleException(localDate: string) {
    const current = rule.exceptions ?? [];
    const next = current.includes(localDate)
      ? current.filter((item) => item !== localDate)
      : [...current, localDate];
    patchRule({ exceptions: next.length ? next : undefined });
  }

  const limitMode = rule.untilLocal ? 'until' : 'count';

  return (
    <div className={styles.wrap}>
      <div className={styles.modes} role="tablist" aria-label="Tipo de programación">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={mode === 'single' ? styles.modeOn : styles.modeOff}
          onClick={() => onChange({ mode: 'single', rule })}
        >
          Fecha única
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'recurring'}
          className={mode === 'recurring' ? styles.modeOn : styles.modeOff}
          onClick={() => onChange({ mode: 'recurring', rule })}
        >
          Serie / recurrente
        </button>
      </div>

      <div className={styles.grid}>
        <label>
          {mode === 'single' ? 'Fecha y hora' : 'Primera función'}
          <input
            type="datetime-local"
            value={rule.startLocal}
            onChange={(e) => patchRule({ startLocal: e.target.value })}
          />
          <small>Hora local del recinto ({timezone})</small>
        </label>

        {mode === 'recurring' && (
          <>
            <label>
              Frecuencia
              <select
                value={rule.frequency}
                onChange={(e) =>
                  patchRule({ frequency: e.target.value as RecurrenceRule['frequency'] })
                }
              >
                <option value="DAILY">Diaria</option>
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensual</option>
              </select>
            </label>

            <label>
              Repetir cada
              <input
                type="number"
                min={1}
                max={12}
                value={rule.interval ?? 1}
                onChange={(e) => patchRule({ interval: Number(e.target.value) || 1 })}
              />
              <small>
                {rule.frequency === 'DAILY' && 'días'}
                {rule.frequency === 'WEEKLY' && 'semanas (2 = quincenal)'}
                {rule.frequency === 'MONTHLY' && 'meses'}
              </small>
            </label>

            {rule.frequency === 'WEEKLY' && (
              <div className={styles.fullField}>
                <span className={styles.fieldLabel}>Días de la semana</span>
                <div className={styles.weekdays}>
                  {WEEKDAYS.map((day, i) => {
                    const on = (rule.byWeekday ?? []).includes(day.value);
                    return (
                      <button
                        key={`${day.value}-${i}`}
                        type="button"
                        aria-pressed={on}
                        className={on ? styles.dayOn : styles.dayOff}
                        onClick={() => toggleWeekday(day.value)}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
                <small>Si no eliges ninguno se usa el día de la primera función.</small>
              </div>
            )}

            {rule.frequency === 'MONTHLY' && (
              <>
                <label>
                  Patrón mensual
                  <select
                    value={rule.monthlyMode ?? 'DAY_OF_MONTH'}
                    onChange={(e) =>
                      patchRule({ monthlyMode: e.target.value as 'DAY_OF_MONTH' | 'NTH_WEEKDAY' })
                    }
                  >
                    <option value="DAY_OF_MONTH">Mismo día del mes</option>
                    <option value="NTH_WEEKDAY">Día de la semana (ej. último viernes)</option>
                  </select>
                </label>
                {(rule.monthlyMode ?? 'DAY_OF_MONTH') === 'NTH_WEEKDAY' && (
                  <label>
                    Ocurrencia
                    <select
                      value={String(rule.nth ?? 1)}
                      onChange={(e) =>
                        patchRule({ nth: Number(e.target.value) as RecurrenceRule['nth'] })
                      }
                    >
                      <option value="1">Primero</option>
                      <option value="2">Segundo</option>
                      <option value="3">Tercero</option>
                      <option value="4">Cuarto</option>
                      <option value="-1">Último</option>
                    </select>
                  </label>
                )}
              </>
            )}

            <label>
              Terminar
              <select
                value={limitMode}
                onChange={(e) =>
                  e.target.value === 'until'
                    ? patchRule({ untilLocal: rule.startLocal.slice(0, 10), count: undefined })
                    : patchRule({ untilLocal: undefined, count: rule.count ?? 8 })
                }
              >
                <option value="count">Después de N funciones</option>
                <option value="until">En una fecha límite</option>
              </select>
            </label>

            {limitMode === 'count' ? (
              <label>
                Nº de funciones
                <input
                  type="number"
                  min={1}
                  max={preview?.limits.maxOccurrences ?? 366}
                  value={rule.count ?? 8}
                  onChange={(e) => patchRule({ count: Number(e.target.value) || 1 })}
                />
              </label>
            ) : (
              <label>
                Hasta
                <input
                  type="date"
                  value={rule.untilLocal ?? ''}
                  onChange={(e) => patchRule({ untilLocal: e.target.value })}
                />
              </label>
            )}
          </>
        )}
      </div>

      {summary && <p className={styles.summary}>{summary}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.previewHead}>
        <strong>
          {loading
            ? 'Calculando fechas…'
            : preview
              ? `${preview.totals.occurrences} fecha(s) · ${preview.totals.capacity.toLocaleString('es-MX')} lugares`
              : 'Sin fechas'}
        </strong>
        {preview && preview.totals.blocking > 0 && (
          <span className={styles.badgeBlocking}>{preview.totals.blocking} con conflicto</span>
        )}
        {preview && preview.totals.withConflicts > preview.totals.blocking && (
          <span className={styles.badgeWarn}>
            {preview.totals.withConflicts - preview.totals.blocking} con aviso
          </span>
        )}
      </div>

      {preview && (
        <ul className={styles.occurrences}>
          {preview.occurrences.map((occurrence) => {
            const excluded = (rule.exceptions ?? []).includes(occurrence.localDate);
            return (
              <li
                key={occurrence.startsAt}
                className={
                  occurrence.blocking
                    ? styles.occBlocking
                    : occurrence.conflicts.length
                      ? styles.occWarn
                      : styles.occOk
                }
              >
                <div className={styles.occMain}>
                  <strong>
                    {new Date(occurrence.startsAt).toLocaleDateString('es-MX', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      timeZone: timezone,
                    })}
                  </strong>
                  <span>{occurrence.localTime}</span>
                  {occurrence.clamped && (
                    <span className={styles.tag} title="El día no existe en ese mes; se ajustó al último día">
                      ajustada
                    </span>
                  )}
                  {occurrence.source === 'EXTRA' && <span className={styles.tag}>extra</span>}
                </div>
                {occurrence.conflicts.length > 0 && (
                  <ul className={styles.conflictList}>
                    {occurrence.conflicts.map((conflict, i) => (
                      <li key={`${conflict.kind}-${i}`}>
                        <span className={styles.conflictKind}>
                          {CONFLICT_LABELS[conflict.kind] ?? conflict.kind}
                        </span>
                        {conflict.message}
                      </li>
                    ))}
                  </ul>
                )}
                {mode === 'recurring' && (
                  <button
                    type="button"
                    className={styles.skipBtn}
                    onClick={() => toggleException(occurrence.localDate)}
                  >
                    {excluded ? 'Restaurar' : 'Omitir'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mode === 'recurring' && (rule.exceptions?.length ?? 0) > 0 && (
        <p className={styles.exceptions}>
          Omitidas: {rule.exceptions!.join(', ')}{' '}
          <button type="button" onClick={() => patchRule({ exceptions: undefined })}>
            limpiar
          </button>
        </p>
      )}
    </div>
  );
}
