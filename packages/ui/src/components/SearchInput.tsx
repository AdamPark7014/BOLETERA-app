'use client';

import {
  forwardRef,
  useCallback,
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { cx } from '../lib/cx';
import styles from './SearchInput.module.scss';

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'value' | 'type'> {
  /** Texto actual. El componente es siempre controlado. */
  value: string;
  /**
   * Callback semantico con el texto ya extraido. Es la forma recomendada de
   * usar el componente; `onChange` sigue disponible para formularios que
   * necesiten el evento nativo.
   */
  onValueChange?: (value: string) => void;
  /** Densidad. Por defecto `md`. */
  inputSize?: 'sm' | 'md' | 'lg';
  /** Etiqueta accesible cuando no hay label visible. Por defecto "Buscar". */
  label?: string;
  /** Atajo mostrado a la derecha, p. ej. `⌘K`. Solo informativo. */
  shortcut?: string;
  /** Ocupa todo el ancho disponible. Por defecto `true`. */
  fullWidth?: boolean;
}

/**
 * Setter nativo del valor de un input. React sobrescribe la propiedad `value`
 * del elemento, asi que hay que usar el descriptor del prototipo para que el
 * evento sintetico se dispare al limpiar desde codigo.
 */
const nativeValueSetter = (input: HTMLInputElement, value: string): void => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
};

/**
 * Campo de busqueda con icono, boton de limpieza y cierre con Escape.
 * Acepta tanto `onValueChange` (recomendado) como el `onChange` nativo.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    inputSize = 'md',
    label = 'Buscar',
    shortcut,
    fullWidth = true,
    placeholder = 'Buscar...',
    className,
    id,
    onChange,
    onKeyDown,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-search`;
  const inputRef = useRef<HTMLInputElement>(null);

  const attachRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      onValueChange?.(event.target.value);
    },
    [onChange, onValueChange],
  );

  const clear = useCallback(() => {
    onValueChange?.('');
    const input = inputRef.current;
    if (input) {
      // Solo para consumidores que dependen del evento nativo: `onValueChange`
      // ya notifico el cambio por su cuenta.
      if (onChange) {
        nativeValueSetter(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.focus();
    }
  }, [onValueChange, onChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && value) {
        event.stopPropagation();
        clear();
      }
      onKeyDown?.(event);
    },
    [value, clear, onKeyDown],
  );

  return (
    <div
      className={cx(styles.wrapper, styles[inputSize], fullWidth && styles.fullWidth, className)}
      role="search"
    >
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 14 14" />
      </svg>
      <input
        ref={attachRef}
        id={inputId}
        type="search"
        className={styles.input}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          onClick={clear}
          aria-label="Limpiar busqueda"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
          </svg>
        </button>
      ) : null}
      {!value && shortcut ? (
        <kbd className={styles.shortcut} aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
});
