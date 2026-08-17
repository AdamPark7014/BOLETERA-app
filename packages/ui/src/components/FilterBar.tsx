'use client';

import { useCallback, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { Popover } from './Popover';
import { SearchInput } from './SearchInput';
import styles from './FilterBar.module.scss';

/** Opcion seleccionable dentro de un filtro. */
export interface FilterOption {
  value: string;
  label: string;
  /** Numero de resultados que produciria la opcion. */
  count?: number;
}

/** Definicion de un filtro con su lista de opciones. */
export interface FilterDefinition {
  id: string;
  label: string;
  options: readonly FilterOption[];
  /** Permite seleccionar varias opciones a la vez. Por defecto `true`. */
  multiple?: boolean;
}

/** Seleccion actual: un arreglo de valores por cada filtro. */
export type FilterSelection = Readonly<Record<string, readonly string[]>>;

export interface FilterBarProps {
  filters: readonly FilterDefinition[];
  /** Seleccion actual. El componente es siempre controlado. */
  value: FilterSelection;
  onChange: (next: FilterSelection) => void;
  /** Cuadro de busqueda integrado a la izquierda. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** Controles adicionales al final de la barra (orden, densidad, exportar). */
  children?: ReactNode;
  className?: string;
}

function toggle(current: readonly string[], option: string, multiple: boolean): string[] {
  if (!multiple) return current[0] === option ? [] : [option];
  return current.includes(option)
    ? current.filter((item) => item !== option)
    : [...current, option];
}

/**
 * Barra de filtros con menus desplegables, chips de filtros activos y limpieza
 * rapida. Mantiene el estado fuera del componente para que la pantalla pueda
 * sincronizarlo con la URL.
 */
export function FilterBar({ filters, value, onChange, search, children, className }: FilterBarProps) {
  const activeCount = filters.reduce((total, filter) => total + (value[filter.id]?.length ?? 0), 0);

  const setFilter = useCallback(
    (filterId: string, next: readonly string[]) => {
      const draft: Record<string, readonly string[]> = { ...value };
      if (next.length === 0) {
        delete draft[filterId];
      } else {
        draft[filterId] = next;
      }
      onChange(draft);
    },
    [value, onChange],
  );

  const clearAll = useCallback(() => onChange({}), [onChange]);

  return (
    <div className={cx(styles.bar, className)}>
      <div className={styles.controls}>
        {search ? (
          <SearchInput
            className={styles.search}
            inputSize="sm"
            value={search.value}
            onValueChange={search.onChange}
            placeholder={search.placeholder ?? 'Buscar...'}
            fullWidth={false}
          />
        ) : null}

        {filters.map((filter) => {
          const selected = value[filter.id] ?? [];
          const multiple = filter.multiple ?? true;
          return (
            <Popover
              key={filter.id}
              label={filter.label}
              placement="bottom"
              alignment="start"
              trigger={({ open }) => (
                <button
                  type="button"
                  className={cx(
                    styles.trigger,
                    selected.length > 0 && styles.triggerActive,
                    open && styles.triggerOpen,
                  )}
                >
                  <span>{filter.label}</span>
                  {selected.length > 0 ? (
                    <span className={styles.triggerCount}>{selected.length}</span>
                  ) : null}
                  <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M3 4.5 6 7.5 9 4.5" />
                  </svg>
                </button>
              )}
            >
              <ul className={styles.options}>
                {filter.options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <li key={option.value}>
                      <label className={styles.option}>
                        <input
                          type={multiple ? 'checkbox' : 'radio'}
                          name={filter.id}
                          checked={checked}
                          onChange={() => setFilter(filter.id, toggle(selected, option.value, multiple))}
                        />
                        <span className={styles.optionLabel}>{option.label}</span>
                        {option.count === undefined ? null : (
                          <span className={styles.optionCount}>{formatNumber(option.count)}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Popover>
          );
        })}

        {children}
      </div>

      {activeCount > 0 ? (
        <div className={styles.chips}>
          {filters.flatMap((filter) =>
            (value[filter.id] ?? []).map((selectedValue) => {
              const option = filter.options.find((item) => item.value === selectedValue);
              return (
                <span key={`${filter.id}:${selectedValue}`} className={styles.chip}>
                  <span className={styles.chipLabel}>
                    {filter.label}: {option?.label ?? selectedValue}
                  </span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Quitar filtro ${filter.label}: ${option?.label ?? selectedValue}`}
                    onClick={() =>
                      setFilter(
                        filter.id,
                        (value[filter.id] ?? []).filter((item) => item !== selectedValue),
                      )
                    }
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                      <path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" />
                    </svg>
                  </button>
                </span>
              );
            }),
          )}
          <button type="button" className={styles.clear} onClick={clearAll}>
            Limpiar todo
          </button>
        </div>
      ) : null}
    </div>
  );
}
