'use client';

import type { Ref } from 'react';
import { stockImageForCategory } from '@boletera/shared';
import { Field, StageArt, formatEventDate, formatTicketAmount, formatTime } from '@boletera/ui';
import { sellableOffersSorted, type OrderableOffer } from '@/lib/offer-order';
import styles from './EventPicker.module.scss';

export type EventPickerOffer = OrderableOffer;

export type EventPickerRow = {
  id: string;
  title: string;
  startsAt: string;
  category?: string | null;
  venue?: { name: string };
  offers?: EventPickerOffer[];
};

function whenLabel(startsAt: string): string {
  const d = new Date(startsAt);
  return `${formatEventDate(d)} · ${formatTime(d)}`;
}

type EventPickerProps = {
  events: EventPickerRow[];
  loading?: boolean;
  filter: string;
  onFilterChange: (value: string) => void;
  selectedId?: string;
  onSelect: (event: EventPickerRow) => void;
  filterInputRef?: Ref<HTMLInputElement>;
  showHotkeys?: boolean;
  heading?: string;
  searchPlaceholder?: string;
};

/** Selector de función compartido por `/venta` y `/eventos`. */
export function EventPicker({
  events,
  loading = false,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  filterInputRef,
  showHotkeys = false,
  heading = 'Elige función',
  searchPlaceholder = 'Nombre o recinto',
}: EventPickerProps) {
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? events.filter(
        (row) =>
          row.title.toLowerCase().includes(needle) ||
          (row.venue?.name ?? '').toLowerCase().includes(needle)
      )
    : events;

  return (
    <section className={styles.block} aria-label={heading}>
      <div className={styles.headRow}>
        <h2 className={styles.label}>{heading}</h2>
        <div className={styles.filter}>
          <Field
            ref={filterInputRef}
            kind="search"
            label="Buscar función"
            placeholder={searchPlaceholder}
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <ul className={styles.events} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className={styles.eventSkeleton} />
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>
          {needle
            ? 'Ninguna función coincide con esa búsqueda.'
            : 'No hay funciones en venta en esta taquilla.'}
        </p>
      ) : (
        <ul className={styles.events}>
          {filtered.map((row, i) => {
            const prices = sellableOffersSorted(row.offers)
              .map((o) => Number(o.basePrice))
              .filter((n) => Number.isFinite(n) && n > 0);
            const price = prices.length ? Math.min(...prices) : 0;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === selectedId ? styles.eventOn : styles.event}
                  onClick={() => onSelect(row)}
                >
                  <span className={styles.thumb}>
                    <StageArt seed={row.id} fade={false} />
                    <img src={stockImageForCategory(row.category, row.title)} alt="" />
                  </span>
                  <span className={styles.eventText}>
                    <strong>{row.title}</strong>
                    <small>{whenLabel(row.startsAt)}</small>
                    <small>
                      {row.venue?.name ?? 'Recinto por confirmar'}
                      {price > 0 ? ` · desde ${formatTicketAmount(price)}` : ''}
                    </small>
                  </span>
                  {showHotkeys && i < 9 ? <kbd>{i + 1}</kbd> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
