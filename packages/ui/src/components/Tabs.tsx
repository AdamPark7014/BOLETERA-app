'use client';

import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useControllableState } from '../lib/hooks';
import styles from './Tabs.module.scss';

/** Una pestana dentro de {@link Tabs}. */
export interface TabItem {
  /** Identificador estable; es el valor que reporta `onValueChange`. */
  id: string;
  label: ReactNode;
  /** Icono decorativo antes de la etiqueta. */
  icon?: ReactNode;
  /** Contador o etiqueta corta al final (p. ej. numero de resultados). */
  badge?: ReactNode;
  disabled?: boolean;
  /** Panel asociado. Si se omite, el consumidor renderiza el contenido. */
  content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Pestana activa (controlado). */
  value?: string;
  /** Pestana activa inicial (no controlado). Por defecto la primera. */
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Tratamiento visual. Por defecto `underline`. */
  variant?: 'underline' | 'pill';
  /** Etiqueta accesible de la lista de pestanas. */
  label?: string;
  /** Ocupa todo el ancho repartiendo las pestanas por igual. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * Pestanas conformes al patron WAI-ARIA `tablist` con activacion manual:
 * las flechas mueven el foco y Enter/Espacio activan, de modo que navegar con
 * teclado no dispara cargas de datos innecesarias.
 */
export function Tabs({
  items,
  value: controlledValue,
  defaultValue,
  onValueChange,
  variant = 'underline',
  label = 'Secciones',
  fullWidth = false,
  className,
}: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const firstId = items[0]?.id ?? '';
  const [value, setValue] = useControllableState(
    controlledValue,
    defaultValue ?? firstId,
    onValueChange,
  );

  const enabled = items.filter((item) => !item.disabled);
  const activeIndex = enabled.findIndex((item) => item.id === value);

  const focusTab = useCallback((id: string) => {
    listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (enabled.length === 0) return;
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

      if (delta !== 0) {
        event.preventDefault();
        const from = activeIndex < 0 ? 0 : activeIndex;
        const next = enabled[(((from + delta) % enabled.length) + enabled.length) % enabled.length];
        if (next) focusTab(next.id);
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        const first = enabled[0];
        if (first) focusTab(first.id);
      } else if (event.key === 'End') {
        event.preventDefault();
        const last = enabled[enabled.length - 1];
        if (last) focusTab(last.id);
      }
    },
    [enabled, activeIndex, focusTab],
  );

  const activeItem = items.find((item) => item.id === value);

  return (
    <div className={cx(styles.tabs, className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className={cx(styles.list, styles[variant], fullWidth && styles.fullWidth)}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              data-tab-id={item.id}
              aria-selected={selected}
              aria-controls={item.content ? `${baseId}-panel-${item.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx(styles.tab, selected && styles.selected)}
              onClick={() => setValue(item.id)}
            >
              {item.icon ? (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className={styles.label}>{item.label}</span>
              {item.badge !== undefined ? <span className={styles.badge}>{item.badge}</span> : null}
            </button>
          );
        })}
      </div>

      {activeItem?.content ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          tabIndex={0}
          className={styles.panel}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
