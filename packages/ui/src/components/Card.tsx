import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Card.module.scss';

export type CardVariant = 'elevated' | 'outline' | 'ghost';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Tratamiento de superficie. Por defecto `elevated`. */
  variant?: CardVariant;
  /** Relleno interno. Usa `none` cuando el contenido gestiona su propio padding. */
  padding?: CardPadding;
  /** Realza la tarjeta en hover. Marcalo solo si toda la tarjeta es accionable. */
  interactive?: boolean;
  children: ReactNode;
}

/** Contenedor de superficie base de todo el sistema. */
export function Card({
  variant = 'elevated',
  padding = 'md',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        styles.card,
        styles[variant],
        styles[`padding-${padding}`],
        interactive && styles.interactive,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Titulo de la tarjeta. */
  title: ReactNode;
  /** Linea secundaria bajo el titulo. */
  description?: ReactNode;
  /** Controles alineados a la derecha (filtros, menu, boton). */
  actions?: ReactNode;
  /** Nivel semantico del encabezado. Por defecto `h3`. */
  as?: 'h2' | 'h3' | 'h4';
}

/** Encabezado de tarjeta con titulo, descripcion y zona de acciones. */
export function CardHeader({
  title,
  description,
  actions,
  as: Heading = 'h3',
  className,
  ...rest
}: CardHeaderProps) {
  return (
    <div className={cx(styles.header, className)} {...rest}>
      <div className={styles.headerText}>
        <Heading className={styles.title}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

/** Pie de tarjeta separado por una linea, para totales o acciones secundarias. */
export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.footer, className)} {...rest}>
      {children}
    </div>
  );
}
