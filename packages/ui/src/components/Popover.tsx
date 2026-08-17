'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import {
  useControllableState,
  useEscapeKey,
  useIsomorphicLayoutEffect,
  useOnClickOutside,
} from '../lib/hooks';
import {
  computePosition,
  toBox,
  type Alignment,
  type Placement,
  type Position,
} from '../lib/position';
import styles from './Popover.module.scss';

export interface PopoverProps {
  /** Disparador. Recibe el estado abierto para reflejarlo visualmente. */
  trigger: (props: { open: boolean }) => ReactNode;
  /** Contenido del panel. Puede incluir controles enfocables. */
  children: ReactNode;
  /** Estado controlado. Omitelo para que el componente se administre solo. */
  open?: boolean;
  /** Notifica cada cambio de apertura. */
  onOpenChange?: (open: boolean) => void;
  /** Lado preferido. Por defecto `bottom`. */
  placement?: Placement;
  /** Alineacion a lo largo del lado. Por defecto `start`. */
  alignment?: Alignment;
  /** Etiqueta accesible del panel. */
  label?: string;
  /** Ancho del panel en px. Por defecto se ajusta al contenido. */
  width?: number;
  className?: string;
}

/**
 * Panel flotante anclado a un disparador, con volteo automatico, cierre por
 * Escape y por click fuera. A diferencia de {@link Tooltip}, su contenido si
 * puede recibir foco.
 */
export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom',
  alignment = 'start',
  label,
  width,
  className,
}: PopoverProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useControllableState(controlledOpen, false, onOpenChange);
  const [position, setPosition] = useState<Position | null>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  useOnClickOutside(rootRef, close, open);
  useEscapeKey(close, open);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const update = (): void => {
      setPosition(
        computePosition(
          toBox(anchor.getBoundingClientRect()),
          toBox(panel.getBoundingClientRect()),
          placement,
          alignment,
        ),
      );
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, placement, alignment]);

  // Al cerrar, el foco vuelve al disparador para no perder el hilo del teclado.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const focusable = anchorRef.current?.querySelector<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div className={cx(styles.root, className)} ref={rootRef}>
      <div
        ref={anchorRef}
        className={styles.anchor}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        role="presentation"
      >
        {trigger({ open })}
      </div>

      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          className={cx(styles.panel, position ? styles.placed : null)}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: width === undefined ? undefined : `${width}px`,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
