import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './EmptyState.module.scss';

/** Ilustraciones disponibles. Cada una comunica una situacion distinta. */
export type EmptyIllustration = 'seats' | 'search' | 'chart' | 'inbox' | 'error' | 'success';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Frase corta que nombra la situacion. */
  title: string;
  /** Explica por que no hay datos y que puede hacer el usuario. */
  description?: ReactNode;
  /** Ilustracion SVG. Por defecto `inbox`. */
  illustration?: EmptyIllustration;
  /** Sustituye la ilustracion por un nodo propio. */
  visual?: ReactNode;
  /** Accion principal. */
  action?: ReactNode;
  /** Accion secundaria (documentacion, importar, contactar). */
  secondaryAction?: ReactNode;
  /** Lista breve de sugerencias bajo la descripcion. */
  hints?: readonly string[];
  /** Densidad. `sm` para huecos dentro de una tarjeta. Por defecto `md`. */
  size?: 'sm' | 'md' | 'lg';
  /** Tono de la ilustracion. Por defecto `accent`. */
  tone?: 'accent' | 'neutral' | 'danger' | 'success';
}

/**
 * Ilustraciones inline: pocos trazos, heredan `currentColor` y por tanto el
 * tono y el tema. No se exportan como archivos para no anadir un paso de build.
 */
function Illustration({ name }: { name: EmptyIllustration }) {
  switch (name) {
    case 'seats':
      return (
        <>
          <rect className={styles.fillSoft} x="14" y="46" width="92" height="34" rx="8" />
          <path className={styles.strokeSoft} d="M24 46V32a8 8 0 0 1 8-8h56a8 8 0 0 1 8 8v14" />
          <circle className={styles.fillAccent} cx="38" cy="63" r="6" />
          <circle className={styles.fillAccent} cx="60" cy="63" r="6" />
          <circle className={styles.strokeAccent} cx="82" cy="63" r="6" />
          <path className={styles.strokeSoft} d="M8 84h104" />
        </>
      );
    case 'search':
      return (
        <>
          <circle className={styles.fillSoft} cx="52" cy="48" r="26" />
          <circle className={styles.strokeAccent} cx="52" cy="48" r="26" />
          <path className={styles.strokeAccent} d="M71 67 92 88" />
          <path className={styles.strokeSoft} d="M42 48h20M52 38v20" />
        </>
      );
    case 'chart':
      return (
        <>
          <rect className={styles.fillSoft} x="16" y="24" width="88" height="60" rx="8" />
          <path className={styles.strokeSoft} d="M28 72h64" />
          <path className={styles.strokeAccent} d="M32 66l16-14 12 9 14-19 14 11" />
          <circle className={styles.fillAccent} cx="74" cy="42" r="4" />
        </>
      );
    case 'error':
      return (
        <>
          <circle className={styles.fillSoft} cx="60" cy="54" r="28" />
          <path className={styles.strokeAccent} d="M60 40v18M60 66v.5" />
          <path className={styles.strokeSoft} d="M20 86h80" />
        </>
      );
    case 'success':
      return (
        <>
          <circle className={styles.fillSoft} cx="60" cy="54" r="28" />
          <path className={styles.strokeAccent} d="M47 55l9 9 18-20" />
          <path className={styles.strokeSoft} d="M20 86h80" />
        </>
      );
    case 'inbox':
      return (
        <>
          <path className={styles.fillSoft} d="M20 54h22l6 12h24l6-12h22v22a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z" />
          <path
            className={styles.strokeSoft}
            d="M20 54 32 26a6 6 0 0 1 6-4h44a6 6 0 0 1 6 4l12 28"
          />
          <path className={styles.strokeAccent} d="M20 54h22l6 12h24l6-12h22" />
        </>
      );
  }
}

/**
 * Estado vacio con ilustracion, explicacion y llamada a la accion. Nunca
 * deberia mostrarse solo un titulo: la descripcion debe decir por que esta
 * vacio y la accion, como llenarlo.
 */
export function EmptyState({
  title,
  description,
  illustration = 'inbox',
  visual,
  action,
  secondaryAction,
  hints,
  size = 'md',
  tone = 'accent',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, styles[size], styles[tone], className)} {...rest}>
      <div className={styles.visual}>
        {visual ?? (
          <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false" className={styles.art}>
            <Illustration name={illustration} />
          </svg>
        )}
      </div>

      <h3 className={styles.title}>{title}</h3>
      {description ? <p className={styles.description}>{description}</p> : null}

      {hints && hints.length > 0 ? (
        <ul className={styles.hints}>
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      ) : null}

      {action || secondaryAction ? (
        <div className={styles.actions}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
