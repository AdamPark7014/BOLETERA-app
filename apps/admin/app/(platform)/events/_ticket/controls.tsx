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

export function Stepper({
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
      <span className={styles.stepValue}>
        {value == null ? '—' : value}
        {unit && value != null ? unit : ''}
      </span>
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
      <span className={styles.bounds}>{max != null ? `${min}–${max}${unit ?? ''}` : `Mínimo ${min}`}</span>
    </div>
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
