'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Input.module.scss';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Etiqueta visible. Se asocia al campo con `htmlFor`. */
  label?: string;
  /** Texto de ayuda permanente bajo el campo. */
  hint?: string;
  /** Mensaje de error. Su presencia activa el estado invalido. */
  error?: string;
  /** Densidad del control. Por defecto `md`. */
  inputSize?: InputSize;
  /** Adorno fijo a la izquierda (icono o simbolo de moneda). */
  leading?: ReactNode;
  /** Adorno fijo a la derecha (unidad, atajo, boton). */
  trailing?: ReactNode;
  /** Ocupa todo el ancho del contenedor. Por defecto `true`. */
  fullWidth?: boolean;
  /** Marca visual de campo obligatorio junto a la etiqueta. */
  requiredMark?: boolean;
}

/**
 * Campo de texto con etiqueta, ayuda y error correctamente enlazados via
 * `aria-describedby` y `aria-invalid`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    inputSize = 'md',
    leading,
    trailing,
    fullWidth = true,
    requiredMark = false,
    className,
    id,
    disabled,
    required,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const invalid = Boolean(error);

  const describedBy = cx(hint ? hintId : null, invalid ? errorId : null) || undefined;

  return (
    <div className={cx(styles.wrapper, fullWidth && styles.fullWidth, className)}>
      {label ? (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {requiredMark || required ? (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <div
        className={cx(
          styles.field,
          styles[inputSize],
          invalid && styles.invalid,
          disabled && styles.disabled,
        )}
      >
        {leading ? (
          <span className={styles.adornment} aria-hidden="true">
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={styles.input}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {trailing ? <span className={styles.adornment}>{trailing}</span> : null}
      </div>

      {hint && !invalid ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
