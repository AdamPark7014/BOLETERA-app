'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

/** `useLayoutEffect` en cliente, `useEffect` en SSR (evita el warning de hidratacion). */
export const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** `true` una vez montado en cliente. Necesario antes de crear portales. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Sigue `prefers-reduced-motion`. Devuelve `false` en el primer render del
 * servidor y se corrige tras la hidratacion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Estado que funciona igual controlado y no controlado.
 * Si `controlled` es `undefined` el hook administra su propio estado interno.
 */
export function useControllableState<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] {
  const [uncontrolled, setUncontrolled] = useState<T>(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : uncontrolled;

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setUncontrolled(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  return [value, setValue];
}

/** Valor que se actualiza tras `delay` ms de inactividad. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Ejecuta `handler` en pointerdown fuera del elemento referenciado. */
export function useOnClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const node = ref.current;
      if (!node) return;
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      savedHandler.current();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [ref, enabled]);
}

/** Ejecuta `handler` al presionar Escape mientras `enabled` sea `true`. */
export function useEscapeKey(handler: () => void, enabled = true): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') savedHandler.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** Congela el scroll del documento mientras haya una capa modal abierta. */
export function useLockBodyScroll(enabled: boolean): void {
  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [enabled]);
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Elementos enfocables y visibles dentro de `container`, en orden de documento. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
  );
}

/**
 * Atrapa el foco dentro de `ref` mientras `active` sea `true`, y lo devuelve al
 * elemento previo al cerrar. Requisito de WAI-ARIA para dialogos modales.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = getFocusableElements(container);
    (focusables[0] ?? container).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const current = getFocusableElements(container);
      if (current.length === 0) {
        event.preventDefault();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (!first || !last) return;

      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !container.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

/** Dimensiones observadas de un elemento. */
export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Mide un elemento con `ResizeObserver`. Es lo que hace responsivos a los
 * charts sin depender de una libreria de contenedores.
 * @param fallback Tamano usado antes de la primera medicion y en SSR.
 */
export function useElementSize<T extends HTMLElement>(
  fallback: ElementSize,
): [RefObject<T | null>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>(fallback);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = (width: number, height: number): void => {
      setSize((previous) =>
        Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height },
      );
    };

    const rect = node.getBoundingClientRect();
    measure(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentRect;
      measure(box.width, box.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/**
 * Indice activo navegable con flechas dentro de una coleccion de longitud `count`.
 * La navegacion es circular, como en los menus de Raycast.
 */
export function useRovingIndex(
  count: number,
  initial = 0,
): [number, Dispatch<SetStateAction<number>>, (delta: number) => void] {
  const [index, setIndex] = useState(initial);

  const move = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (count <= 0) return 0;
        return (((current + delta) % count) + count) % count;
      });
    },
    [count],
  );

  useEffect(() => {
    setIndex((current) => (current >= count ? Math.max(0, count - 1) : current));
  }, [count]);

  return [index, setIndex, move];
}
