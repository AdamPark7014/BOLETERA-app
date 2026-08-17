import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatDateTime } from '../lib/format';
import styles from './Timeline.module.scss';

export type TimelineTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Hito de una {@link Timeline}. */
export interface TimelineItem {
  id: string;
  /** Encabezado del hito. */
  title: ReactNode;
  /** Detalle bajo el titulo. */
  description?: ReactNode;
  /** Momento del hito. Se formatea en es-MX. */
  timestamp?: Date | string | number;
  /** Color del marcador. Por defecto `neutral`. */
  tone?: TimelineTone;
  /** Icono dentro del marcador. Sustituye al punto. */
  icon?: ReactNode;
  /** Marca el hito como el estado actual (marcador con halo). */
  current?: boolean;
  /** Contenido libre bajo la descripcion (chips, botones, metadatos). */
  children?: ReactNode;
}

export interface TimelineProps extends HTMLAttributes<HTMLOListElement> {
  items: readonly TimelineItem[];
  /** Densidad. Por defecto `md`. */
  density?: 'sm' | 'md';
  /** Etiqueta accesible de la lista. */
  label?: string;
}

/**
 * Cronologia vertical de hitos: ciclo de vida de un evento, historial de un
 * pedido o pasos de una liquidacion. Se expone como lista ordenada para que un
 * lector de pantalla anuncie la posicion de cada hito.
 */
export function Timeline({
  items,
  density = 'md',
  label = 'Cronologia',
  className,
  ...rest
}: TimelineProps) {
  return (
    <ol
      className={cx(styles.timeline, styles[density], className)}
      aria-label={label}
      {...rest}
    >
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          <div className={styles.rail} aria-hidden="true">
            <span
              className={cx(
                styles.marker,
                styles[item.tone ?? 'neutral'],
                item.current && styles.current,
                item.icon ? styles.hasIcon : null,
              )}
            >
              {item.icon}
            </span>
            <span className={styles.line} />
          </div>

          <div className={styles.content}>
            <div className={styles.headline}>
              <span className={styles.title}>{item.title}</span>
              {item.timestamp === undefined ? null : (
                <time className={styles.time}>{formatDateTime(item.timestamp)}</time>
              )}
            </div>
            {item.description ? <p className={styles.description}>{item.description}</p> : null}
            {item.children ? <div className={styles.extra}>{item.children}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
