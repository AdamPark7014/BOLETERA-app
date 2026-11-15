import type { CSSProperties, ReactNode } from 'react';
import styles from './TicketState.module.scss';

export type TicketStateKind = 'empty' | 'error' | 'soldout' | 'done';

export interface TicketStateProps {
  /** Vacío (nada que mostrar), error (algo falló), agotado o hecho. */
  kind?: TicketStateKind;
  /** Una frase corta y cálida, sin signos de exclamación. */
  title: string;
  /** Opcional: una línea de contexto, nunca instrucciones de uso. */
  body?: string;
  /** Una sola acción (enlace o botón ya estilado por quien llama). */
  action?: ReactNode;
  /** Alineación; por omisión centrado. */
  align?: 'center' | 'start';
  /** Alto mínimo para que el bloque ocupe el hueco del contenido final (sin saltos). */
  minHeight?: number;
  className?: string;
}

const ICONS: Record<TicketStateKind, ReactNode> = {
  empty: (
    <>
      <path d="M4 8.5h16v7H4z" />
      <path d="M9 8.5v7" strokeDasharray="1.5 2" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
  soldout: (
    <>
      <path d="M4 8.5h16v7H4z" />
      <path d="M6 18L18 6" />
    </>
  ),
  done: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.3l2.5 2.5 5-5.2" />
    </>
  ),
};

/**
 * Estado vacío / error / agotado / hecho de Black Ticket: icono fino, una
 * frase y, si hace falta, una acción. Se usa igual en web, admin y taquilla.
 */
export function TicketState({
  kind = 'empty',
  title,
  body,
  action,
  align = 'center',
  minHeight,
  className,
}: TicketStateProps) {
  const style: CSSProperties | undefined = minHeight ? { minHeight } : undefined;
  return (
    <div
      className={[styles.state, className].filter(Boolean).join(' ')}
      data-kind={kind}
      data-align={align}
      role={kind === 'error' ? 'alert' : 'status'}
      style={style}
    >
      <svg
        aria-hidden="true"
        className={styles.icon}
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[kind]}
      </svg>
      <p className={styles.title}>{title}</p>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

export interface TicketSkeletonProps {
  /** Alto final del contenido que reemplaza (evita saltos de diseño). */
  height: number | string;
  /** Ancho; por omisión 100 %. */
  width?: number | string;
  radius?: number;
  className?: string;
  /** Texto para lector de pantalla mientras carga. */
  label?: string;
}

/** Bloque de carga con la altura final y brillo suave (respeta movimiento reducido). */
export function TicketSkeleton({
  height,
  width = '100%',
  radius = 16,
  className,
  label,
}: TicketSkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ height, width, borderRadius: radius }}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label ? <span className={styles.srOnly}>{label}</span> : null}
    </span>
  );
}
