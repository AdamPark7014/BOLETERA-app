import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import styles from './Skeleton.module.scss';

export type SkeletonShape = 'rect' | 'text' | 'circle';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Geometria del bloque. Por defecto `rect`. */
  shape?: SkeletonShape;
  /** Ancho CSS. Numero = pixeles. Por defecto `100%`. */
  width?: number | string;
  /** Alto CSS. Numero = pixeles. Por defecto depende de `shape`. */
  height?: number | string;
  /** Radio explicito; sobrescribe el que impone `shape`. */
  radius?: number | string;
  /** Desfase del shimmer en ms, para escalonar filas contiguas. */
  delay?: number;
}

function toCssSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Bloque de carga con shimmer. El shimmer se desactiva automaticamente con
 * `prefers-reduced-motion` y queda como un bloque estatico.
 *
 * Los skeletons son `aria-hidden`: el estado de carga debe anunciarse una sola
 * vez en el contenedor (`aria-busy`), no una vez por bloque.
 */
export function Skeleton({
  shape = 'rect',
  width,
  height,
  radius,
  delay,
  className,
  style,
  ...rest
}: SkeletonProps) {
  const inlineStyle: CSSProperties = {
    ...style,
    width: toCssSize(width),
    height: toCssSize(height),
    borderRadius: toCssSize(radius),
    animationDelay: delay === undefined ? undefined : `${delay}ms`,
  };

  return (
    <div
      className={cx(styles.skeleton, styles[shape], className)}
      style={inlineStyle}
      aria-hidden="true"
      {...rest}
    />
  );
}

export interface SkeletonTextProps extends Omit<SkeletonProps, 'shape' | 'height'> {
  /** Numero de renglones. Por defecto 3. */
  lines?: number;
  /** Ancho del ultimo renglon, para simular un parrafo real. Por defecto `62%`. */
  lastLineWidth?: number | string;
}

/** Parrafo de carga: N renglones con el ultimo mas corto. */
export function SkeletonText({
  lines = 3,
  lastLineWidth = '62%',
  className,
  width,
  ...rest
}: SkeletonTextProps) {
  const count = Math.max(1, lines);
  return (
    <div className={cx(styles.paragraph, className)} aria-hidden="true">
      {Array.from({ length: count }, (_unused, index) => (
        <Skeleton
          key={index}
          shape="text"
          delay={index * 90}
          width={index === count - 1 && count > 1 ? lastLineWidth : width}
          {...rest}
        />
      ))}
    </div>
  );
}

export interface SkeletonCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Muestra un avatar circular junto al encabezado. */
  avatar?: boolean;
  /** Renglones del cuerpo. Por defecto 3. */
  lines?: number;
  /** Reserva un bloque alto para un chart o imagen. */
  media?: boolean;
}

/** Tarjeta de carga completa: encabezado, medios opcionales y cuerpo. */
export function SkeletonCard({
  avatar = false,
  lines = 3,
  media = false,
  className,
  ...rest
}: SkeletonCardProps) {
  return (
    <div className={cx(styles.card, className)} aria-hidden="true" {...rest}>
      <div className={styles.cardHeader}>
        {avatar ? <Skeleton shape="circle" width={36} height={36} /> : null}
        <div className={styles.cardHeading}>
          <Skeleton shape="text" width="42%" height={13} />
          <Skeleton shape="text" width="26%" height={11} delay={80} />
        </div>
      </div>
      {media ? <Skeleton height={132} radius={10} delay={120} /> : null}
      <SkeletonText lines={lines} />
    </div>
  );
}
