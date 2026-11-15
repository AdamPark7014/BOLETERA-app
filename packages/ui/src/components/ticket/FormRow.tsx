import type { ReactNode } from 'react';
import styles from './FormRow.module.scss';

export interface FormRowProps {
  /** El control con su propia etiqueta (`Field`, `select` etiquetado, `Stepper`…). */
  children: ReactNode;
  /** Opcional: una línea con el efecto del ajuste, en secundario. Nunca repite la etiqueta. */
  effect?: string;
  /** Opcional: valor vigente a la derecha cuando el control no lo muestra. */
  aside?: ReactNode;
  className?: string;
}

/**
 * Fila de formulario sin título propio. Sustituye a `ParameterCard` cuando la
 * ficha envolvía un `Field` (que ya trae etiqueta) y salía «Título — Título
 * [campo]». `ParameterCard` queda para ajustes de solo lectura o con valor
 * resumido + divulgación avanzada.
 */
export function FormRow({ children, effect, aside, className }: FormRowProps) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <div className={styles.control}>{children}</div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
      {effect ? <p className={styles.effect}>{effect}</p> : null}
    </div>
  );
}

export interface FormSectionProps {
  /** Título corto de la sección (una vez, no por campo). */
  title: string;
  children: ReactNode;
  /** Acción de la sección, normalmente Guardar. */
  footer?: ReactNode;
  className?: string;
}

/** Agrupa filas bajo un solo título, separadas por espacio, sin cajas anidadas. */
export function FormSection({ title, children, footer, className }: FormSectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.rows}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
}
