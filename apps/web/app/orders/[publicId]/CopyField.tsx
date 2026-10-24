'use client';

import { useEffect, useRef, useState } from 'react';
import { TicketButton } from '@boletera/ui';
import styles from './order.module.scss';

/**
 * Dato copiable de un toque.
 *
 * Una CLABE de 18 dígitos o una referencia OXXO se teclean a mano en la app del
 * banco o se dictan en la caja: transcribirlas desde la pantalla es la fuente
 * número uno de pagos que no se acreditan. El valor se muestra agrupado para
 * poder leerlo, pero se copia sin espacios, que es como lo espera el banco.
 */
export function CopyField({
  label,
  value,
  display,
  hint,
  primary = false,
}: {
  label: string;
  value: string;
  /** Versión legible (agrupada). Se copia siempre `value`. */
  display?: string;
  hint?: string;
  /** Una sola copia es el botón hueso. La otra queda en filete. */
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      // Safari sin gesto de usuario, http sin TLS, permisos denegados: el dato
      // sigue seleccionable a mano, así que se dice en vez de fallar en mudo.
      setFailed(true);
    }
  }

  return (
    <div className={styles.copyField}>
      <span className={styles.copyLabel}>{label}</span>
      <div className={styles.copyRow}>
        <code className={styles.copyValue}>{display ?? value}</code>
        <TicketButton
          type="button"
          variant={primary ? 'primary' : 'secondary'}
          onClick={() => void copy()}
          aria-label={primary ? 'Copiar referencia' : `Copiar ${label}`}
        >
          {copied ? 'Copiado' : primary ? 'Copiar referencia' : 'Copiar'}
        </TicketButton>
      </div>
      {hint && <span className={styles.copyHint}>{hint}</span>}
      <span role="status" aria-live="polite" className={styles.srOnly}>
        {copied ? `${label} copiado al portapapeles` : ''}
      </span>
      {failed && (
        <span className={styles.copyHint} role="alert">
          No pudimos copiarlo automáticamente. Selecciona el texto y cópialo a mano.
        </span>
      )}
    </div>
  );
}
