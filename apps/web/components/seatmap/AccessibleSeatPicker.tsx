'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { RenderSeat, SeatStatus } from './types';
import styles from './AccessibleSeatPicker.module.scss';

/**
 * Ruta equivalente al mapa para teclado y lector de pantalla.
 *
 * Un `<canvas>` es un rectángulo opaco para la tecnología de asistencia, así
 * que el mapa NO puede ser la única forma de elegir butaca. Esto no es un
 * adorno: es la misma compra, con la misma información (zona, fila, butaca,
 * precio y estado) y las mismas acciones.
 *
 * También es la respuesta al criterio de tamaño de objetivo (WCAG 2.2, 2.5.8):
 * aquí cada opción es una fila de ≥44 px, muy por encima del mínimo, y sirve
 * de «control equivalente» para cualquier butaca que en el mapa quede pequeña.
 *
 * Navegación: Zona → Fila → Butaca, cada nivel un `listbox` con flechas,
 * Inicio/Fin y Enter/Espacio. El detalle completo de la butaca va en el nombre
 * accesible de la opción (no en una región `aria-live` paralela: eso haría que
 * el lector dijera todo dos veces). La región viva se reserva para el
 * RESULTADO de la acción, que es lo que el foco no cuenta por sí solo.
 */

export type AccessibleSeatPickerProps = {
  seats: readonly RenderSeat[];
  /** Índices del array plano agrupados por sección, en orden de zona. */
  sectionOrder: readonly { id: string; name: string }[];
  seatIndexesBySection: Map<string, number[]>;
  statusAt: (index: number) => SeatStatus;
  selectedIds: readonly string[];
  maxSelect: number;
  currency: string;
  accessibleOnly: boolean;
  onAccessibleOnlyChange: (value: boolean) => void;
  onToggleSeat: (seatId: string) => void;
  /** Lleva el mapa visual a la butaca enfocada (mantiene ambos en sincronía). */
  onFocusSeat: (seatIndex: number) => void;
  /** Todavía se está paginando `/seats`: hay butacas sin estado confirmado. */
  loading: boolean;
};

const STATUS_TEXT: Record<SeatStatus, string> = {
  available: 'disponible',
  held: 'apartada por otra persona',
  sold: 'no disponible',
  blocked: 'bloqueada',
  selected: 'seleccionada por ti',
  unknown: 'cargando disponibilidad',
};

/** Orden natural: «Fila 2» antes que «Fila 10», y «A» antes que «AA». */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

function formatMoney(value: number, currency: string): string {
  if (!value) return 'sin precio publicado';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`;
}

export function AccessibleSeatPicker({
  seats,
  sectionOrder,
  seatIndexesBySection,
  statusAt,
  selectedIds,
  maxSelect,
  currency,
  accessibleOnly,
  onAccessibleOnlyChange,
  onToggleSeat,
  onFocusSeat,
  loading,
}: AccessibleSeatPickerProps) {
  const [sectionId, setSectionId] = useState<string>(sectionOrder[0]?.id ?? '');
  const [rowKey, setRowKey] = useState<string>('');
  const [announcement, setAnnouncement] = useState('');

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const sections = useMemo(() => {
    if (!accessibleOnly) return sectionOrder;
    return sectionOrder.filter((sec) =>
      (seatIndexesBySection.get(sec.id) ?? []).some((i) => seats[i].accessible),
    );
  }, [sectionOrder, accessibleOnly, seatIndexesBySection, seats]);

  useEffect(() => {
    if (!sections.length) return;
    if (!sections.some((s) => s.id === sectionId)) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  /** Filas de la zona activa, con sus butacas ya ordenadas. */
  const rows = useMemo(() => {
    const indexes = seatIndexesBySection.get(sectionId) ?? [];
    const byRow = new Map<string, number[]>();
    for (const i of indexes) {
      const seat = seats[i];
      if (accessibleOnly && !seat.accessible) continue;
      const key = seat.row?.trim() || 'Sin fila';
      const list = byRow.get(key);
      if (list) list.push(i);
      else byRow.set(key, [i]);
    }
    const out = [...byRow.entries()].map(([key, list]) => ({
      key,
      indexes: list.sort((a, b) => naturalCompare(seats[a].label, seats[b].label)),
    }));
    out.sort((a, b) => naturalCompare(a.key, b.key));
    return out;
  }, [seatIndexesBySection, sectionId, seats, accessibleOnly]);

  useEffect(() => {
    if (!rows.length) {
      setRowKey('');
      return;
    }
    if (!rows.some((r) => r.key === rowKey)) setRowKey(rows[0].key);
  }, [rows, rowKey]);

  const activeRow = rows.find((r) => r.key === rowKey);
  const seatIndexes = activeRow?.indexes ?? [];

  const describeSeat = useCallback(
    (index: number) => {
      const seat = seats[index];
      const status = selectedSet.has(seat.id) ? 'selected' : statusAt(index);
      const parts = [
        seat.row ? `Fila ${seat.row}` : null,
        `Asiento ${seat.label}`,
        seat.sectionName,
        formatMoney(seat.price, currency),
        STATUS_TEXT[status],
        seat.accessible ? 'lugar accesible' : null,
        seat.restricted ? 'vista restringida' : null,
        seat.premium ? 'vista premium' : null,
      ].filter(Boolean);
      return parts.join(', ');
    },
    [seats, selectedSet, statusAt, currency],
  );

  const toggle = useCallback(
    (index: number) => {
      const seat = seats[index];
      const status = statusAt(index);
      if (selectedSet.has(seat.id)) {
        onToggleSeat(seat.id);
        setAnnouncement(
          `Quitada ${seat.row ? `fila ${seat.row}, ` : ''}butaca ${seat.label}. ${
            selectedIds.length - 1
          } de ${maxSelect} seleccionadas.`,
        );
        return;
      }
      if (status !== 'available') {
        setAnnouncement(
          `No se puede seleccionar: ${describeSeat(index)}. Elige otra butaca de la lista.`,
        );
        return;
      }
      if (selectedIds.length >= maxSelect) {
        setAnnouncement(
          `Ya tienes el máximo de ${maxSelect} butacas. Quita alguna antes de agregar otra.`,
        );
        return;
      }
      onToggleSeat(seat.id);
      setAnnouncement(`Agregada ${describeSeat(index)}. ${selectedIds.length + 1} de ${maxSelect}.`);
    },
    [seats, statusAt, selectedSet, selectedIds.length, maxSelect, onToggleSeat, describeSeat],
  );

  return (
    <section className={styles.picker} aria-labelledby="seat-picker-title">
      <div className={styles.head}>
        <h3 id="seat-picker-title" className={styles.title}>
          Elegir butaca por lista
        </h3>
        <p className={styles.sub}>
          Alternativa completa al mapa: navega con las flechas y confirma con Enter.
        </p>
      </div>

      <label className={styles.accessibleToggle}>
        <input
          type="checkbox"
          checked={accessibleOnly}
          onChange={(e) => {
            onAccessibleOnlyChange(e.target.checked);
            setAnnouncement(
              e.target.checked
                ? 'Mostrando solo lugares accesibles.'
                : 'Mostrando todas las butacas.',
            );
          }}
        />
        <span>Solo lugares accesibles</span>
      </label>

      {loading && (
        <p className={styles.loadingNote}>
          Aún estamos cargando la disponibilidad. Las butacas sin estado confirmado aparecen como
          «cargando».
        </p>
      )}

      <div className={styles.columns}>
        <Listbox
          label="Zona"
          options={sections.map((sec) => ({
            key: sec.id,
            label: sec.name,
            description: `${(seatIndexesBySection.get(sec.id) ?? []).length} butacas`,
          }))}
          activeKey={sectionId}
          onActivate={(key) => setSectionId(key)}
        />
        <Listbox
          label="Fila"
          options={rows.map((row) => ({
            key: row.key,
            label: row.key === 'Sin fila' ? 'Sin fila' : `Fila ${row.key}`,
            description: `${row.indexes.length} butacas`,
          }))}
          activeKey={rowKey}
          onActivate={(key) => setRowKey(key)}
        />
        <Listbox
          label="Butaca"
          multiselect
          options={seatIndexes.map((index) => {
            const seat = seats[index];
            const status = selectedSet.has(seat.id) ? 'selected' : statusAt(index);
            return {
              key: seat.id,
              label: seat.label,
              description: formatMoney(seat.price, currency),
              ariaLabel: describeSeat(index),
              selected: selectedSet.has(seat.id),
              disabled: status !== 'available' && status !== 'selected',
              badge: seat.accessible ? '♿' : status === 'held' ? '⧗' : status === 'sold' ? '✕' : '',
              onFocus: () => onFocusSeat(index),
              onActivate: () => toggle(index),
            };
          })}
          activeKey={undefined}
          onActivate={() => undefined}
          emptyText={accessibleOnly ? 'No hay lugares accesibles en esta fila.' : 'Sin butacas.'}
        />
      </div>

      <p className={styles.liveRegion} role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

type Option = {
  key: string;
  label: string;
  description?: string;
  ariaLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: string;
  onFocus?: () => void;
  onActivate?: () => void;
};

/**
 * Listbox con tabindex móvil (el foco real se mueve entre opciones, que es lo
 * que hace que `:focus-visible` funcione y que el lector anuncie la opción).
 */
function Listbox({
  label,
  options,
  activeKey,
  onActivate,
  multiselect = false,
  emptyText,
}: {
  label: string;
  options: Option[];
  activeKey: string | undefined;
  onActivate: (key: string) => void;
  multiselect?: boolean;
  emptyText?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (multiselect) return;
    const idx = options.findIndex((o) => o.key === activeKey);
    if (idx >= 0) setFocusIndex(idx);
  }, [activeKey, options, multiselect]);

  const move = (next: number) => {
    if (!options.length) return;
    const clamped = Math.min(options.length - 1, Math.max(0, next));
    setFocusIndex(clamped);
    const el = listRef.current?.querySelectorAll<HTMLLIElement>('[role="option"]')[clamped];
    el?.focus();
    if (!multiselect) onActivate(options[clamped].key);
    else options[clamped].onFocus?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        move(index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        move(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(options.length - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(index + 10);
        break;
      case 'PageUp':
        e.preventDefault();
        move(index - 10);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (multiselect) options[index]?.onActivate?.();
        else onActivate(options[index].key);
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.column}>
      <p className={styles.columnLabel} id={`lb-${label}`}>
        {label}
      </p>
      {options.length === 0 ? (
        <p className={styles.emptyColumn}>{emptyText ?? 'Sin opciones.'}</p>
      ) : (
        <ul
          ref={listRef}
          className={styles.list}
          role="listbox"
          aria-labelledby={`lb-${label}`}
          aria-multiselectable={multiselect || undefined}
        >
          {options.map((option, index) => {
            const isActive = multiselect ? index === focusIndex : option.key === activeKey;
            return (
              <li
                key={option.key}
                role="option"
                aria-selected={multiselect ? Boolean(option.selected) : option.key === activeKey}
                aria-disabled={option.disabled || undefined}
                aria-label={option.ariaLabel}
                tabIndex={isActive ? 0 : -1}
                className={`${styles.option} ${option.selected ? styles.optionSelected : ''} ${
                  option.disabled ? styles.optionDisabled : ''
                }`}
                onKeyDown={(e) => onKeyDown(e, index)}
                onFocus={() => {
                  setFocusIndex(index);
                  option.onFocus?.();
                }}
                onClick={() => {
                  setFocusIndex(index);
                  if (multiselect) option.onActivate?.();
                  else onActivate(option.key);
                }}
              >
                <span className={styles.optionLabel}>
                  {option.badge ? (
                    <b className={styles.badge} aria-hidden>
                      {option.badge}
                    </b>
                  ) : null}
                  {option.label}
                </span>
                {option.description && (
                  <span className={styles.optionMeta}>{option.description}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
