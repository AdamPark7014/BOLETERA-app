'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearTaquillaSession,
  onReauthRequired,
  reauthenticateSameCashier,
  type ReauthRequest,
} from '@/lib/auth';
import styles from './Dialog.module.scss';

/**
 * Diálogo de reautenticación.
 *
 * El token del API dura 2 h y un turno de taquilla dura más. Cuando una llamada
 * devuelve 401, `apiFetch` abre este diálogo y REPITE la petición al terminar:
 * la venta en curso sigue en el estado de React y no se pierde nada. Perder una
 * venta a medias con fila esperando es inaceptable.
 */
export function ReauthDialog() {
  const router = useRouter();
  const [request, setRequest] = useState<ReauthRequest | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onReauthRequired((req) => setRequest(req)), []);

  useEffect(() => {
    if (request) {
      setPassword('');
      setError('');
      // Un tick para que el input exista antes de pedirle el foco.
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [request]);

  if (!request) return null;

  function finish(ok: boolean) {
    const resolve = request?.resolve;
    setRequest(null);
    setPassword('');
    setBusy(false);
    resolve?.(ok);
  }

  function abortSession() {
    finish(false);
    clearTaquillaSession();
    router.replace('/login?reason=session-expired');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!request || busy) return;
    if (!password.trim()) {
      setError('Escribe tu contraseña');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await reauthenticateSameCashier(request.email, password);
      finish(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reanudar la sesión');
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reauth-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          abortSession();
        }
      }}
    >
      <form className={styles.dialog} onSubmit={(e) => void submit(e)}>
        <p className={styles.eyebrow}>Sesión caducada</p>
        <h2 id="reauth-title" className={styles.title}>
          Vuelve a identificarte
        </h2>
        <p className={styles.lead}>
          La sesión del API caduca cada 2 horas. <strong>La venta en curso y el turno siguen
          abiertos</strong>: escribe tu contraseña ({request.email}) y la operación continúa.
        </p>

        <label className={styles.field}>
          <small>Cajero</small>
          <input value={request.email} readOnly tabIndex={-1} />
        </label>

        <label className={styles.field}>
          <small>Contraseña</small>
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" onClick={abortSession} disabled={busy}>
            Salir e ir al login
          </button>
          <button type="submit" className={styles.primary} disabled={busy || !password.trim()}>
            {busy ? 'Reanudando…' : 'Continuar'}
          </button>
        </div>
        <p className={styles.hint}>
          <kbd>Enter</kbd> continuar · <kbd>Esc</kbd> salir al login (demo: <kbd>Admin123!</kbd>)
        </p>
      </form>
    </div>
  );
}
