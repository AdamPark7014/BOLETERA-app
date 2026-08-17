'use client';

import { useId, useRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useEscapeKey, useFocusTrap, useLockBodyScroll, useMounted } from '../lib/hooks';
import styles from './Drawer.module.scss';

export type DrawerSide = 'right' | 'left' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg';

export interface DrawerProps {
  /** Controla la visibilidad. El contenido se desmonta al cerrar. */
  open: boolean;
  /** Se invoca con Escape, click en el fondo y en el boton de cierre. */
  onClose: () => void;
  /** Titulo del panel. Se enlaza con `aria-labelledby`. */
  title?: string;
  /** Linea descriptiva bajo el titulo. */
  description?: string;
  /** Borde desde el que entra el panel. Por defecto `right`. */
  side?: DrawerSide;
  /** Anchura (o altura si `side` es `bottom`). Por defecto `md`. */
  size?: DrawerSize;
  /** Zona inferior fija para acciones. */
  footer?: ReactNode;
  /** Desactiva el cierre por Escape y click en el fondo. */
  dismissible?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Panel lateral modal para detalles y formularios largos sin perder el
 * contexto de la tabla que hay detras. Mismo contrato de accesibilidad que
 * {@link Modal}: trampa de foco, Escape y bloqueo de scroll.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  side = 'right',
  size = 'md',
  footer,
  dismissible = true,
  className,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const id = useId();

  useFocusTrap(panelRef, open);
  useLockBodyScroll(open);
  useEscapeKey(onClose, open && dismissible);

  if (!open || !mounted) return null;

  const titleId = title ? `${id}-title` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cx(styles.layer, styles[side])}>
      <div
        className={styles.backdrop}
        onClick={dismissible ? onClose : undefined}
        role="presentation"
      />
      <div
        ref={panelRef}
        className={cx(styles.panel, styles[`size-${size}`], className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
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
          <button type="button" className={styles.close} onClick={onClose} aria-label="Cerrar panel">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>
  );
}
