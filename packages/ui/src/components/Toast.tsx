'use client';

import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Toast.module.scss';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Datos de una notificacion emitida con `useToast().toast(...)`. */
export interface ToastOptions {
  /** Titulo breve. Es lo unico obligatorio. */
  title: string;
  /** Detalle opcional en una segunda linea. */
  description?: string;
  /** Color e icono semanticos. Por defecto `neutral`. */
  tone?: ToastTone;
  /**
   * Milisegundos antes del cierre automatico. `0` deja la notificacion fija,
   * lo apropiado para errores que exigen una accion del usuario.
   * Por defecto 5000.
   */
  duration?: number;
  /** Accion en linea, p. ej. "Deshacer" o "Ver pedido". */
  action?: { label: string; onClick: () => void };
}

/** Notificacion ya registrada en la cola del proveedor. */
export interface ToastRecord extends ToastOptions {
  id: string;
}

export interface ToastProps {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
  className?: string;
}

const ICONS: Record<ToastTone, ReactNode> = {
  neutral: <circle cx="8" cy="8" r="5.5" />,
  success: <path d="M2.5 8.5 6.5 12 13.5 4.5" />,
  warning: <path d="M8 3v6M8 12.2v.3" />,
  danger: <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />,
  info: <path d="M8 7.2v5M8 4.3v.3" />,
};

/**
 * Tarjeta de notificacion. Normalmente no se usa directamente: emitela con
 * `useToast()` y deja que {@link ToastProvider} la posicione y la retire.
 */
export function Toast({ toast, onDismiss, className }: ToastProps) {
  const tone = toast.tone ?? 'neutral';

  return (
    <div className={cx(styles.toast, styles[tone], className)}>
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {ICONS[tone]}
      </svg>

      <div className={styles.content}>
        <p className={styles.title}>{toast.title}</p>
        {toast.description ? <p className={styles.description}>{toast.description}</p> : null}
      </div>

      {toast.action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}

      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(toast.id)}
        aria-label={`Descartar notificacion: ${toast.title}`}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
        </svg>
      </button>
    </div>
  );
}
