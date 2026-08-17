'use client';

import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useControllableState } from '../lib/hooks';
import styles from './SegmentedControl.module.scss';

/** Opcion de un {@link SegmentedControl}. */
export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Icono decorativo antes de la etiqueta. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  /** Valor seleccionado (controlado). */
  value?: T;
  /** Valor inicial (no controlado). Por defecto la primera opcion. */
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  /** Densidad. Por defecto `md`. */
  size?: 'sm' | 'md';
  /** Etiqueta accesible del grupo. */
  label: string;
  /** Reparte las opciones a lo ancho del contenedor. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * Selector exclusivo compacto para alternar rangos o vistas (hoy / 7 d / 30 d).
 * Implementa el patron `radiogroup`: una sola parada de tabulacion y flechas
 * para cambiar de opcion, que ademas selecciona.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value: controlledValue,
  defaultValue,
  onValueChange,
  size = 'md',
  label,
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  const baseId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const firstValue = options[0]?.value;
  const [value, setValue] = useControllableState<T | undefined>(
    controlledValue,
    defaultValue ?? firstValue,
    (next) => {
      if (next !== undefined) onValueChange?.(next);
    },
  );

  const enabled = options.filter((option) => !option.disabled);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const delta =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (delta === 0 || enabled.length === 0) return;

      event.preventDefault();
      const current = enabled.findIndex((option) => option.value === value);
      const from = current < 0 ? 0 : current;
      const next = enabled[(((from + delta) % enabled.length) + enabled.length) % enabled.length];
      if (!next) return;
      setValue(next.value);
      groupRef.current
        ?.querySelector<HTMLElement>(`[data-segment="${next.value}"]`)
        ?.focus({ preventScroll: true });
    },
    [enabled, value, setValue],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={cx(styles.group, styles[size], fullWidth && styles.fullWidth, className)}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            id={`${baseId}-${option.value}`}
            data-segment={option.value}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            className={cx(styles.segment, checked && styles.checked)}
            onClick={() => setValue(option.value)}
          >
            {option.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
