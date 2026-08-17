import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Section.module.scss';

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Titulo de la seccion. Se enlaza con `aria-labelledby`. */
  title?: ReactNode;
  /** Linea de contexto bajo el titulo. */
  description?: ReactNode;
  /** Controles alineados a la derecha del titulo. */
  actions?: ReactNode;
  /** Nivel del encabezado. Por defecto `h2`. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  /** Reparte los hijos en una rejilla responsiva de N columnas. */
  columns?: 1 | 2 | 3 | 4;
  /** Separacion entre hijos. Por defecto `md`. */
  gap?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

/**
 * Agrupador con titulo dentro de una pantalla. Aporta el ritmo vertical y, con
 * `columns`, la rejilla responsiva que usan los dashboards.
 */
export function Section({
  title,
  description,
  actions,
  headingLevel: Heading = 'h2',
  columns,
  gap = 'md',
  className,
  children,
  ...rest
}: SectionProps) {
  const id = useId();
  const titleId = title ? `${id}-title` : undefined;

  return (
    <section className={cx(styles.section, className)} aria-labelledby={titleId} {...rest}>
      {title || actions ? (
        <div className={styles.header}>
          <div className={styles.text}>
            {title ? (
              <Heading id={titleId} className={styles.title}>
                {title}
              </Heading>
            ) : null}
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      ) : null}

      <div
        className={cx(
          styles.body,
          styles[`gap-${gap}`],
          columns ? styles.grid : null,
          columns ? styles[`cols-${columns}`] : null,
        )}
      >
        {children}
      </div>
    </section>
  );
}
