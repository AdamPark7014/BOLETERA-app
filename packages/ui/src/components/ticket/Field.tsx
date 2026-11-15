'use client';

import {
  forwardRef,
  useId,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../../lib/cx';
import type { Density } from '../../styles/tokens';
import { useTicketDensity } from './BlackTicketRoot';
import styles from './Field.module.scss';

export type FieldKind = 'text' | 'money' | 'search';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Siempre visible, encima del control. No flota. */
  label: string;
  /** Una pista, en terciario. No sustituye a la etiqueta. */
  hint?: string;
  /** Línea bajo el campo. Su presencia marca el control inválido. */
  error?: string;
  /** Alto 48 / 56 / 36. Si se omite, hereda el lienzo. */
  density?: Density;
  /** Texto, monto (`$`, tabular, a la derecha) o búsqueda. */
  kind?: FieldKind;
  /** Adorno a la derecha: unidad («min»), atajo. */
  trailing?: ReactNode;
}

/**
 * Campo del lenguaje visual. Fondo en pozo, filete en reposo,
 * anillo de foco en lugar del filete.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    label,
    hint,
    error,
    density,
    kind = 'text',
    trailing,
    className,
    id,
    disabled,
    required,
    type,
    inputMode,
    ...rest
  },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-field`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  // Si el formulario se envía con el campo vacío o inválido, el navegador
  // dispara `invalid`: en vez de su globo, se muestra el error aquí y en
  // español. Un `error` explícito siempre gana.
  const [nativeError, setNativeError] = useState<string | null>(null);
  const shownError = error ?? nativeError ?? undefined;
  const invalid = Boolean(shownError);
  const resolved = useTicketDensity(density);
  const describedBy = [hint && !invalid ? hintId : null, invalid ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cx(styles.wrapper, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div
        className={cx(
          styles.control,
          styles[resolved],
          kind === 'money' && styles.money,
          invalid && styles.invalid,
          disabled && styles.disabled
        )}
        data-density={resolved}
      >
        {kind === 'money' ? (
          <span className={styles.prefix} aria-hidden="true">
            $
          </span>
        ) : null}
        <input
          ref={ref}
          {...rest}
          id={inputId}
          className={styles.input}
          disabled={disabled}
          required={required}
          type={type ?? (kind === 'search' ? 'search' : 'text')}
          inputMode={inputMode ?? (kind === 'money' ? 'decimal' : undefined)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          onInvalid={(event: FormEvent<HTMLInputElement>) => {
            rest.onInvalid?.(event);
            event.preventDefault();
            const input = event.currentTarget;
            const v = input.validity;
            setNativeError(
              v.valueMissing
                ? 'Este dato es obligatorio.'
                : v.typeMismatch && input.type === 'email'
                  ? 'Ese correo no parece válido.'
                  : v.tooShort
                    ? `Usa al menos ${input.minLength} caracteres.`
                    : v.rangeUnderflow || v.rangeOverflow
                      ? 'Revisa el valor.'
                      : 'Revisa este dato.'
            );
            // El primer campo inválido del formulario recibe el foco.
            const first = input.form?.querySelector<HTMLInputElement>(':invalid');
            if (first === input) input.focus();
          }}
          onInput={(event) => {
            rest.onInput?.(event);
            if (nativeError && event.currentTarget.validity.valid) setNativeError(null);
          }}
        />
        {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
      </div>
      {hint && !invalid ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} className={styles.error} role="alert">
          {shownError}
        </p>
      ) : null}
    </div>
  );
});
