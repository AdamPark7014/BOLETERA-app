'use client';

import { useId, useRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useEscapeKey, useFocusTrap, useLockBodyScroll, useMounted } from '../lib/hooks';
import styles from './Modal.module.scss';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  /** Controla la visibilidad. El contenido se desmonta al cerrar. */
  open: boolean;
  /** Se invoca con Escape, click en el fondo y en el boton de cierre. */
  onClose: () => void;
  /** Titulo del dialogo. Se enlaza con `aria-labelledby`. */
  title?: string;
  /** Linea descriptiva bajo el titulo. Se enlaza con `aria-describedby`. */
  description?: string;
  /** Ancho maximo. Por defecto `md`. */
  size?: ModalSize;
  /** Zona inferior de acciones, separada por una linea. */
  footer?: ReactNode;
  /** Desactiva el cierre por Escape y por click en el fondo (flujos destructivos). */
  dismissible?: boolean;
  /** Oculta el boton de cierre de la esquina. */
  hideCloseButton?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Dialogo modal con trampa de foco, restauracion del foco previo, bloqueo de
 * scroll y cierre por Escape, conforme al patron WAI-ARIA `dialog`.
 *
 * Se renderiza en su posicion del arbol con `position: fixed`, sin portal: no
 * lo montes dentro de un ancestro con `transform` o `filter`, porque eso crea
 * un bloque contenedor y el overlay quedaria recortado.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  dismissible = true,
  hideCloseButton = false,
  className,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const id = useId();

  useFocusTrap(dialogRef, open);
  useLockBodyScroll(open);
  useEscapeKey(onClose, open && dismissible);

  if (!open || !mounted) return null;

  const titleId = title ? `${id}-title` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={styles.layer}>
      <div
        className={styles.backdrop}
        onClick={dismissible ? onClose : undefined}
        role="presentation"
      />
      <div
        ref={dialogRef}
        className={cx(styles.dialog, styles[size], className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {title || !hideCloseButton ? (
          <header className={styles.header}>
            <div className={styles.headerText}>
              {title ? (
                <h2 id={titleId} className={styles.title}>
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className={styles.description}>
                  {description}
                </p>
              ) : null}
            </div>
            {hideCloseButton ? null : (
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="Cerrar dialogo"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </header>
        ) : null}

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>
  );
}
