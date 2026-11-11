'use client';

import { useState, type ReactNode } from 'react';
import { Field } from '@boletera/ui';
import styles from './controls.module.scss';

export function Param({ name, children }: { name: string; children: ReactNode }) {
  return <div data-param={name}>{children}</div>;
}

export function Switch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? styles.switchOn : styles.switch}
      onClick={() => onChange(!on)}
    >
      <span className={styles.knob} />
    </button>
  );
}

/** Acota un número tecleado a [min, max] y lo deja entero, como los botones − y +. */
function clampStep(next: number, min: number, max: number | null): number {
  const whole = Math.trunc(next);
  const floor = Math.max(min, whole);
  return max != null ? Math.min(max, floor) : floor;
}

export function Stepper({
  value,
  min,
  max,
  unit,
  label,
  editable = false,
  onChange,
}: {
  value: number | null;
  min: number;
  max: number | null;
  unit?: string;
  label: string;
  /**
   * Muestra un campo numérico entre − y + para escribir la cifra directo. Opcional para no cambiar
   * las pantallas que ya usan el Stepper de solo botones.
   */
  editable?: boolean;
  onChange: (next: number) => void;
}) {
  const atMin = value == null || value <= min;
  const atMax = max != null && value != null && value >= max;
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        aria-label={`Bajar ${label}`}
        disabled={atMin}
        onClick={() => onChange(Math.max(min, (value ?? min) - 1))}
      >
        −
      </button>
      {editable ? (
        <StepInput
          value={value}
          min={min}
          max={max}
          unit={unit}
          label={label}
          onChange={onChange}
        />
      ) : (
        <span className={styles.stepValue}>
          {value == null ? '—' : value}
          {unit && value != null ? unit : ''}
        </span>
      )}
      <button
        type="button"
        aria-label={`Subir ${label}`}
        disabled={atMax}
        onClick={() => {
          const next = value == null ? min : value + 1;
          onChange(max != null ? Math.min(max, next) : next);
        }}
      >
        +
      </button>
      <span className={styles.bounds}>
        {max != null ? `${min}–${max}${unit ?? ''}` : `Mínimo ${min}`}
      </span>
    </div>
  );
}

/**
 * Campo numérico del Stepper. Mientras se escribe, solo avisa cifras dentro del rango; al salir del campo
 * (o con Intro) acota lo escrito a [min, max]. Vacío o inválido vuelve al valor anterior; Esc lo descarta.
 */
function StepInput({
  value,
  min,
  max,
  unit,
  label,
  onChange,
}: {
  value: number | null;
  min: number;
  max: number | null;
  unit?: string;
  label: string;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? '' : String(value));

  function commit() {
    if (draft == null) return;
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    const next = clampStep(parsed, min, max);
    if (next !== value) onChange(next);
  }

  return (
    <span className={styles.stepField}>
      <input
        type="number"
        inputMode="numeric"
        className={styles.stepInput}
        aria-label={label}
        min={min}
        max={max ?? undefined}
        step={1}
        value={shown}
        placeholder="—"
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = text.trim() === '' ? Number.NaN : Number(text);
          if (
            Number.isInteger(parsed) &&
            parsed >= min &&
            (max == null || parsed <= max) &&
            parsed !== value
          ) {
            onChange(parsed);
          }
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            setDraft(null);
          }
        }}
        onWheel={(event) => event.currentTarget.blur()}
      />
      {unit ? (
        <span className={styles.stepUnit} aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </span>
  );
}

export function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.segment}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={selected ? styles.segmentOn : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SheetSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((option) => option.value === value);
  const many = options.length > 12;
  const needle = query.trim().toLowerCase();
  const shown =
    many && needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;

  return (
    <div>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((next) => !next)}
      >
        {current?.label ?? placeholder}
      </button>
      {open ? (
        <div className={styles.sheet} role="listbox" aria-label={label}>
          {many ? (
            <Field
              label="Buscar"
              kind="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          {shown.length === 0 ? <p>Nada con ese criterio.</p> : null}
          {shown.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className={styles.option}
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
