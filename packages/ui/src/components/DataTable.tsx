'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import { cx } from '../lib/cx';
import { clamp } from '../lib/scale';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import styles from './DataTable.module.scss';

export type SortDirection = 'asc' | 'desc';

/** Estado de ordenamiento de la tabla. */
export interface SortState {
  key: string;
  direction: SortDirection;
}

/** Definicion de una columna. */
export interface DataTableColumn<T> {
  /** Identificador unico; se usa como clave de ordenamiento y de ancho. */
  key: string;
  header: ReactNode;
  /** Contenido de la celda. Sin el se muestra `row[key]` convertido a texto. */
  render?: (row: T, rowIndex: number) => ReactNode;
  /**
   * Valor usado para ordenar. Sin el, la columna no es ordenable aunque
   * `sortable` sea `true`.
   */
  sortValue?: (row: T) => string | number;
  /** Ancho inicial en px. Por defecto 160. */
  width?: number;
  /** Ancho minimo al redimensionar, en px. Por defecto 72. */
  minWidth?: number;
  /** Alineacion del contenido. Usa `right` para importes. */
  align?: 'left' | 'center' | 'right';
  /** Permite redimensionar arrastrando el borde. Por defecto `true`. */
  resizable?: boolean;
  /** Etiqueta accesible cuando el `header` es solo un icono. */
  headerLabel?: string;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  data: readonly T[];
  /** Clave estable por fila. Debe ser unica y no depender del indice. */
  rowKey: (row: T) => string;
  /** Descripcion accesible de la tabla. Obligatoria. */
  label: string;

  /** Ordenamiento controlado. */
  sort?: SortState | null;
  /** Ordenamiento inicial cuando no esta controlado. */
  defaultSort?: SortState | null;
  /** Notifica el nuevo ordenamiento. Recibe `null` al desactivarlo. */
  onSortChange?: (sort: SortState | null) => void;

  /** Habilita la columna de casillas de seleccion. */
  selectable?: boolean;
  /** Claves seleccionadas (controlado). */
  selectedKeys?: readonly string[];
  onSelectionChange?: (keys: string[]) => void;

  /** Contenido desplegable de una fila. Su presencia activa la columna de expansion. */
  renderExpanded?: (row: T) => ReactNode;

  /** Alto del area desplazable en px. Por defecto 460. */
  maxHeight?: number;
  /** Alto de cada fila en px. Debe ser uniforme. Por defecto 40. */
  rowHeight?: number;
  /** Filas dibujadas fuera de la ventana visible. Por defecto 6. */
  overscan?: number;
  /** A partir de cuantas filas se activa la virtualizacion. Por defecto 60. */
  virtualizeFrom?: number;

  /** Muestra esqueletos en lugar de datos. */
  loading?: boolean;
  /** Numero de esqueletos mientras carga. Por defecto 8. */
  loadingRows?: number;
  /** Mensaje de error. Su presencia sustituye al contenido. */
  error?: string | null;
  /** Accion de reintento mostrada junto al error. */
  onRetry?: () => void;
  /** Estado vacio a medida. */
  empty?: ReactNode;

  /** Se dispara al hacer click o pulsar Enter sobre una fila. */
  onRowClick?: (row: T) => void;
  /** Densidad vertical. Por defecto `default`. */
  density?: 'compact' | 'default';
  /** Fija la cabecera al hacer scroll. Por defecto `true`. */
  stickyHeader?: boolean;
  className?: string;
}

const DEFAULT_WIDTH = 160;
const DEFAULT_MIN_WIDTH = 72;
const SELECT_WIDTH = 40;
const EXPAND_WIDTH = 36;

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es-MX', { numeric: true, sensitivity: 'base' });
}

/**
 * Tabla de datos con virtualizacion por ventana, ordenamiento, redimension de
 * columnas, seleccion multiple y filas expandibles.
 *
 * La virtualizacion es propia (sin librerias): se calcula el rango visible a
 * partir del scroll y se compensa con espaciadores, de modo que renderizar
 * 50 000 filas cuesta lo mismo que renderizar 20.
 *
 * Se expone como `role="table"` con `aria-rowcount` sobre el total real, para
 * que un lector de pantalla anuncie la posicion correcta pese a que solo exista
 * en el DOM la ventana visible.
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  label,
  sort: controlledSort,
  defaultSort = null,
  onSortChange,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  renderExpanded,
  maxHeight = 460,
  rowHeight = 40,
  overscan = 6,
  virtualizeFrom = 60,
  loading = false,
  loadingRows = 8,
  error = null,
  onRetry,
  empty,
  onRowClick,
  density = 'default',
  stickyHeader = true,
  className,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(maxHeight);

  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort);
  const sort = controlledSort === undefined ? internalSort : controlledSort;

  const [internalSelection, setInternalSelection] = useState<readonly string[]>([]);
  const selection = selectedKeys ?? internalSelection;
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  const lastClickedIndex = useRef<number | null>(null);
  // Shift+click selecciona un rango; el evento `change` no expone el modificador.
  const shiftHeld = useRef(false);

  const rowPx = density === 'compact' ? Math.max(28, rowHeight - 8) : rowHeight;

  // ------------------------------------------------------------------ orden

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((item) => item.key === sort.key);
    const accessor = column?.sortValue;
    if (!accessor) return data;
    const factor = sort.direction === 'asc' ? 1 : -1;
    // `toSorted` no esta en el objetivo de compilacion: copiamos antes de ordenar.
    return [...data].sort((a, b) => factor * compareValues(accessor(a), accessor(b)));
  }, [data, sort, columns]);

  const applySort = useCallback(
    (key: string) => {
      const column = columns.find((item) => item.key === key);
      if (!column?.sortValue) return;
      const next: SortState | null =
        sort?.key !== key
          ? { key, direction: 'asc' }
          : sort.direction === 'asc'
            ? { key, direction: 'desc' }
            : null;
      if (controlledSort === undefined) setInternalSort(next);
      onSortChange?.(next);
    },
    [columns, sort, controlledSort, onSortChange],
  );

  // ------------------------------------------------------------- seleccion

  const commitSelection = useCallback(
    (keys: string[]) => {
      if (selectedKeys === undefined) setInternalSelection(keys);
      onSelectionChange?.(keys);
    },
    [selectedKeys, onSelectionChange],
  );

  const toggleRow = useCallback(
    (key: string, index: number, shiftKey: boolean) => {
      const anchor = lastClickedIndex.current;
      if (shiftKey && anchor !== null) {
        const from = Math.min(anchor, index);
        const to = Math.max(anchor, index);
        const range = sortedData.slice(from, to + 1).map(rowKey);
        const merged = new Set(selectionSet);
        const shouldSelect = !selectionSet.has(key);
        for (const item of range) {
          if (shouldSelect) merged.add(item);
          else merged.delete(item);
        }
        commitSelection(Array.from(merged));
      } else {
        const merged = new Set(selectionSet);
        if (merged.has(key)) merged.delete(key);
        else merged.add(key);
        commitSelection(Array.from(merged));
      }
      lastClickedIndex.current = index;
    },
    [selectionSet, sortedData, rowKey, commitSelection],
  );

  const allKeys = useMemo(() => sortedData.map(rowKey), [sortedData, rowKey]);
  const allSelected = allKeys.length > 0 && allKeys.every((key) => selectionSet.has(key));
  const someSelected = !allSelected && allKeys.some((key) => selectionSet.has(key));

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // ------------------------------------------------------------- expansion

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ---------------------------------------------------------- anchos y grid

  const columnWidth = useCallback(
    (column: DataTableColumn<T>) => widths[column.key] ?? column.width ?? DEFAULT_WIDTH,
    [widths],
  );

  const gridTemplate = useMemo(() => {
    const parts: string[] = [];
    if (selectable) parts.push(`${SELECT_WIDTH}px`);
    if (renderExpanded) parts.push(`${EXPAND_WIDTH}px`);
    for (const column of columns) parts.push(`${columnWidth(column)}px`);
    return parts.join(' ');
  }, [columns, columnWidth, selectable, renderExpanded]);

  const resizeColumn = useCallback((column: DataTableColumn<T>, nextWidth: number) => {
    setWidths((current) => ({
      ...current,
      [column.key]: Math.max(column.minWidth ?? DEFAULT_MIN_WIDTH, Math.round(nextWidth)),
    }));
  }, []);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, column: DataTableColumn<T>) => {
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = columnWidth(column);
      handle.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent): void => {
        resizeColumn(column, startWidth + (moveEvent.clientX - startX));
      };
      const onUp = (): void => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [columnWidth, resizeColumn],
  );

  const resizeWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>, column: DataTableColumn<T>) => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        resizeColumn(column, columnWidth(column) + step);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        resizeColumn(column, columnWidth(column) - step);
      }
    },
    [columnWidth, resizeColumn],
  );

  // --------------------------------------------------------- virtualizacion

  const virtualize = sortedData.length >= virtualizeFrom;

  /**
   * Desplazamiento acumulado por fila. Con filas expandidas la altura deja de
   * ser uniforme, asi que se construye la tabla de offsets; sin expansiones se
   * usa la aritmetica directa, que es O(1).
   */
  const offsets = useMemo(() => {
    if (expanded.size === 0) return null;
    const result = new Float64Array(sortedData.length + 1);
    for (let i = 0; i < sortedData.length; i += 1) {
      const row = sortedData[i];
      const key = row === undefined ? '' : rowKey(row);
      const extra = expanded.has(key) ? rowPx * 3 : 0;
      result[i + 1] = (result[i] ?? 0) + rowPx + extra;
    }
    return result;
  }, [sortedData, expanded, rowPx, rowKey]);

  const totalHeight = offsets ? (offsets[sortedData.length] ?? 0) : sortedData.length * rowPx;

  const findIndexAt = useCallback(
    (position: number): number => {
      if (!offsets) return Math.floor(position / rowPx);
      let low = 0;
      let high = sortedData.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if ((offsets[middle + 1] ?? 0) <= position) low = middle + 1;
        else high = middle;
      }
      return low;
    },
    [offsets, rowPx, sortedData.length],
  );

  const range = useMemo(() => {
    if (!virtualize) return { start: 0, end: sortedData.length, padTop: 0 };
    const start = clamp(findIndexAt(scrollTop) - overscan, 0, Math.max(0, sortedData.length - 1));
    const end = clamp(
      findIndexAt(scrollTop + viewportHeight) + overscan + 1,
      start,
      sortedData.length,
    );
    const padTop = offsets ? (offsets[start] ?? 0) : start * rowPx;
    return { start, end, padTop };
  }, [
    virtualize,
    findIndexAt,
    scrollTop,
    viewportHeight,
    overscan,
    sortedData.length,
    offsets,
    rowPx,
  ]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setViewportHeight(node.clientHeight));
    observer.observe(node);
    setViewportHeight(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  // ------------------------------------------------------------------ vista

  const columnCount = columns.length + (selectable ? 1 : 0) + (renderExpanded ? 1 : 0);

  const header = (
    <div
      className={cx(styles.row, styles.headerRow, stickyHeader && styles.sticky)}
      role="row"
      aria-rowindex={1}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {selectable ? (
        <div className={cx(styles.cell, styles.checkboxCell)} role="columnheader">
          <input
            ref={headerCheckboxRef}
            type="checkbox"
            checked={allSelected}
            onChange={() => commitSelection(allSelected ? [] : allKeys)}
            aria-label={allSelected ? 'Deseleccionar todas las filas' : 'Seleccionar todas las filas'}
          />
        </div>
      ) : null}

      {renderExpanded ? (
        <div className={cx(styles.cell, styles.expandCell)} role="columnheader">
          <span className={styles.srOnly}>Detalle</span>
        </div>
      ) : null}

      {columns.map((column) => {
        const sortable = Boolean(column.sortValue);
        const active = sort?.key === column.key;
        return (
          <div
            key={column.key}
            className={cx(styles.cell, styles.headerCell, styles[column.align ?? 'left'])}
            role="columnheader"
            aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
          >
            {sortable ? (
              <button
                type="button"
                className={cx(styles.sortButton, active && styles.sortActive)}
                onClick={() => applySort(column.key)}
                aria-label={`Ordenar por ${column.headerLabel ?? String(column.header)}`}
              >
                <span className={styles.headerText}>{column.header}</span>
                <svg className={styles.sortIcon} viewBox="0 0 10 10" aria-hidden="true">
                  {active && sort.direction === 'desc' ? (
                    <path d="M2.5 4 5 6.5 7.5 4" />
                  ) : (
                    <path d="M2.5 6 5 3.5 7.5 6" />
                  )}
                </svg>
              </button>
            ) : (
              <span className={styles.headerText}>{column.header}</span>
            )}

            {(column.resizable ?? true) ? (
              <span
                className={styles.resizer}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Ajustar ancho de ${column.headerLabel ?? String(column.header)}`}
                aria-valuenow={columnWidth(column)}
                tabIndex={0}
                onPointerDown={(event) => startResize(event, column)}
                onKeyDown={(event) => resizeWithKeyboard(event, column)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );

  let body: ReactNode;

  if (error) {
    body = (
      <EmptyState
        className={styles.state}
        size="sm"
        tone="danger"
        illustration="error"
        title="No pudimos cargar los datos"
        description={error}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Reintentar
            </Button>
          ) : null
        }
      />
    );
  } else if (loading) {
    body = (
      <div className={styles.loading} aria-hidden="true">
        {Array.from({ length: Math.max(1, loadingRows) }, (_unused, index) => (
          <div
            key={index}
            className={styles.row}
            style={{ gridTemplateColumns: gridTemplate, height: rowPx }}
          >
            {Array.from({ length: columnCount }, (_cell, cellIndex) => (
              <div key={cellIndex} className={styles.cell}>
                <Skeleton shape="text" width={cellIndex === 0 ? '70%' : '52%'} delay={index * 60} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  } else if (sortedData.length === 0) {
    body =
      empty ?? (
        <EmptyState
          className={styles.state}
          size="sm"
          tone="neutral"
          illustration="search"
          title="Sin resultados"
          description="Ajusta los filtros o amplia el rango de fechas para ver informacion aqui."
        />
      );
  } else {
    const visible = sortedData.slice(range.start, range.end);
    body = (
      // Los envoltorios de la ventana virtual se marcan como presentacion para
      // que las filas sigan siendo hijas directas de la tabla en el arbol de
      // accesibilidad.
      <div
        role="presentation"
        style={{ height: virtualize ? totalHeight : undefined, position: 'relative' }}
      >
        <div role="presentation" style={{ transform: `translateY(${range.padTop}px)` }}>
          {visible.map((row, offset) => {
            const index = range.start + offset;
            const key = rowKey(row);
            const isSelected = selectionSet.has(key);
            const isExpanded = expanded.has(key);

            return (
              <div key={key} className={styles.rowGroup} role="presentation">
                <div
                  className={cx(
                    styles.row,
                    styles.bodyRow,
                    isSelected && styles.selected,
                    onRowClick && styles.clickable,
                  )}
                  role="row"
                  aria-rowindex={index + 2}
                  style={{ gridTemplateColumns: gridTemplate, height: rowPx }}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {selectable ? (
                    <div className={cx(styles.cell, styles.checkboxCell)} role="cell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => {
                          shiftHeld.current = event.shiftKey;
                        }}
                        onKeyDown={(event) => {
                          shiftHeld.current = event.shiftKey;
                        }}
                        onChange={() => toggleRow(key, index, shiftHeld.current)}
                        aria-label={`Seleccionar fila ${index + 1}`}
                      />
                    </div>
                  ) : null}

                  {renderExpanded ? (
                    <div className={cx(styles.cell, styles.expandCell)} role="cell">
                      <button
                        type="button"
                        className={cx(styles.expandButton, isExpanded && styles.expandOpen)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? 'Ocultar detalle' : 'Mostrar detalle'}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(key);
                        }}
                      >
                        <svg viewBox="0 0 10 10" aria-hidden="true">
                          <path d="M3.5 2 6.5 5 3.5 8" />
                        </svg>
                      </button>
                    </div>
                  ) : null}

                  {columns.map((column) => (
                    <div
                      key={column.key}
                      className={cx(styles.cell, styles[column.align ?? 'left'])}
                      role="cell"
                    >
                      <span className={styles.cellContent}>
                        {column.render
                          ? column.render(row, index)
                          : String(row[column.key] ?? '')}
                      </span>
                    </div>
                  ))}
                </div>

                {isExpanded && renderExpanded ? (
                  <div className={styles.expandedPanel} role="row">
                    <div className={styles.expandedCell} role="cell">
                      {renderExpanded(row)}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const containerStyle: CSSProperties = { maxHeight };

  return (
    <div className={cx(styles.wrap, styles[density], className)}>
      <div
        ref={scrollRef}
        className={styles.scroller}
        style={containerStyle}
        onScroll={onScroll}
        role="table"
        aria-label={label}
        aria-rowcount={sortedData.length + 1}
        aria-colcount={columnCount}
        aria-busy={loading || undefined}
      >
        <div className={styles.grid} role="presentation" style={{ minWidth: 'max-content' }}>
          {header}
          {body}
        </div>
      </div>

      {selectable && selection.length > 0 ? (
        <div className={styles.selectionBar} role="status">
          <span>
            {selection.length} {selection.length === 1 ? 'fila seleccionada' : 'filas seleccionadas'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => commitSelection([])}>
            Limpiar seleccion
          </Button>
        </div>
      ) : null}
    </div>
  );
}
