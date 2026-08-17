'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import { Toast, type ToastOptions, type ToastRecord } from './Toast';
import styles from './ToastProvider.module.scss';

/** API expuesta por {@link useToast}. */
export interface ToastApi {
  /** Encola una notificacion y devuelve su id, util para descartarla antes. */
  toast: (options: ToastOptions) => string;
  /** Retira una notificacion concreta. */
  dismiss: (id: string) => void;
  /** Vacia la cola (p. ej. al navegar a otra pantalla). */
  dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Acceso a la cola de notificaciones. Requiere un {@link ToastProvider} en un
 * ancestro; si no lo encuentra lanza, en lugar de fallar en silencio.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast debe usarse dentro de un <ToastProvider>.');
  }
  return api;
}

export type ToastPlacement = 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';

export interface ToastProviderProps {
  children: ReactNode;
  /** Esquina donde se apilan las notificaciones. Por defecto `bottom-right`. */
  placement?: ToastPlacement;
  /** Maximo de notificaciones simultaneas; las mas antiguas se descartan. Por defecto 4. */
  max?: number;
  /** Duracion por defecto en ms cuando la notificacion no la especifica. */
  defaultDuration?: number;
}

/**
 * Proveedor de notificaciones. Montalo una sola vez, lo mas cerca posible de la
 * raiz del layout: la region flotante usa `position: fixed` sin portal, asi que
 * no debe quedar dentro de un ancestro con `transform`.
 *
 * Las notificaciones informativas se anuncian en una region `polite` y las de
 * error en una `assertive`, para no interrumpir al usuario sin motivo.
 */
export function ToastProvider({
  children,
  placement = 'bottom-right',
  max = 4,
  defaultDuration = 5000,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    setToasts([]);
  }, []);

  const toast = useCallback(
    (options: ToastOptions): string => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      const record: ToastRecord = { ...options, id };

      setToasts((current) => [...current, record].slice(-Math.max(1, max)));

      const duration = options.duration ?? defaultDuration;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [max, defaultDuration, dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);

  const urgent = toasts.filter((item) => item.tone === 'danger');
  const polite = toasts.filter((item) => item.tone !== 'danger');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={cx(styles.viewport, styles[placement])}>
        <div className={styles.region} role="status" aria-live="polite" aria-relevant="additions">
          {polite.map((item) => (
            <Toast key={item.id} toast={item} onDismiss={dismiss} />
          ))}
        </div>
        <div className={styles.region} role="alert" aria-live="assertive" aria-relevant="additions">
          {urgent.map((item) => (
            <Toast key={item.id} toast={item} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
