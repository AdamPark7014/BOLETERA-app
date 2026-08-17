'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from '../lib/cx';
import { useIsomorphicLayoutEffect } from '../lib/hooks';
import { computePosition, toBox, type Placement, type Position } from '../lib/position';
import styles from './Tooltip.module.scss';

/** Props que el tooltip inyecta en su hijo. */
type TriggerProps = HTMLAttributes<HTMLElement> & {
  'aria-describedby'?: string;
  ref?: Ref<HTMLElement>;
};

export interface TooltipProps {
  /** Contenido de la etiqueta. Texto corto: no es un contenedor interactivo. */
  content: ReactNode;
  /** Lado preferido. Se voltea solo si no cabe. Por defecto `top`. */
  placement?: Placement;
  /** Retardo de apertura en ms, para no parpadear al pasar el cursor. Por defecto 250. */
  delay?: number;
  /** Desactiva el tooltip sin desmontar el hijo. */
  disabled?: boolean;
  /** Elemento disparador. Debe aceptar props DOM y ser enfocable. */
  children: ReactElement<TriggerProps>;
}

/**
 * Etiqueta contextual que aparece en hover y en foco de teclado, y se cierra
 * con Escape. Se enlaza al disparador con `aria-describedby`, por lo que el
 * hijo debe ser un elemento nativo enfocable (boton, enlace, input).
 */
export function Tooltip({
  content,
  placement = 'top',
  delay = 250,
  disabled = false,
  children,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      if (disabled) return;
      cancelTimer();
      if (immediate || delay <= 0) {
        setOpen(true);
        return;
      }
      timerRef.current = setTimeout(() => setOpen(true), delay);
    },
    [disabled, delay, cancelTimer],
  );

  const hide = useCallback(() => {
    cancelTimer();
    setOpen(false);
    setPosition(null);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const floating = floatingRef.current;
    if (!trigger || !floating) return;
    setPosition(
      computePosition(toBox(trigger.getBoundingClientRect()), toBox(floating.getBoundingClientRect()), placement),
    );
  }, [open, placement, content]);

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    'aria-describedby': open ? id : children.props['aria-describedby'],
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      children.props.onMouseEnter?.(event);
      show(false);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      children.props.onMouseLeave?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event);
      show(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event);
      hide();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      children.props.onKeyDown?.(event);
      if (event.key === 'Escape') hide();
    },
  } as Partial<TriggerProps>);

  return (
    <>
      {trigger}
      {open && !disabled ? (
        <div
          ref={floatingRef}
          id={id}
          role="tooltip"
          className={cx(styles.tooltip, position ? styles.placed : null)}
          style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
        >
          {content}
        </div>
      ) : null}
    </>
  );
}
