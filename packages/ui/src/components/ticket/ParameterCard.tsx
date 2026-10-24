'use client';

import { useId, useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './ParameterCard.module.scss';

export type ParameterValueStyle = 'text' | 'tabular' | 'mono';

export interface ParameterCardProps {
  /** Nombre del parámetro, en hueso. */
  name: string;
  /** Valor actual. Se lee con la ficha cerrada. */
  value: ReactNode;
  /** Tabular si es cifra, mono si es código. */
  valueStyle?: ParameterValueStyle;
  /** Una línea: qué cambia si se toca. */
  effect: string;
  /** Control diseñado. Si el rol no edita, no se pasa. */
  children?: ReactNode;
  /** Parámetros de borde. Se abren aquí, no en otra pantalla. */
  advanced?: ReactNode;
  /**
   * Valor de un ajuste avanzado que mueve dinero, cupo o acceso.
   * Visible en terciario mientras la divulgación está cerrada.
   */
  closedNote?: string;
  className?: string;
}

/** Ficha de parámetro. Guardar no vive aquí: va una vez por sección. */
export function ParameterCard({
  name,
  value,
  valueStyle = 'text',
  effect,
  children,
  advanced,
  closedNote,
  className,
}: ParameterCardProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const valueClass =
    valueStyle === 'tabular' ? styles.tabular : valueStyle === 'mono' ? styles.mono : undefined;

  return (
    <section className={cx(styles.card, open && styles.isOpen, className)}>
      <div className={styles.head}>
        <p className={styles.name}>{name}</p>
        <p className={cx(styles.value, valueClass)}>{value}</p>
      </div>
      <p className={styles.effect}>{effect}</p>
      {children ? <div className={styles.control}>{children}</div> : null}
      {closedNote && !open ? <p className={styles.closedNote}>{closedNote}</p> : null}
      {advanced ? (
        <>
          <button
            type="button"
            className={styles.advancedButton}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
          >
            <span className={styles.marker} aria-hidden="true">
              ▸
            </span>
            Ajustes avanzados
          </button>
          <div id={panelId} className={cx(styles.panel, open && styles.open)} inert={!open}>
            <div className={styles.panelInner}>{advanced}</div>
          </div>
        </>
      ) : null}
    </section>
  );
}
