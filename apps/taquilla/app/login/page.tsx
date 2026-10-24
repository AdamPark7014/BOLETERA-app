'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, TicketButton } from '@boletera/ui';
import { getTaquillaToken, getTaquillaUser, loginRequest, saveTaquillaSession } from '@/lib/auth';
import { getSessionId, openShift } from '@/lib/pos';
import styles from './login.module.scss';

export default function TaquillaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terminalId, setTerminalId] = useState('TAQ-01');
  const [openingCash, setOpeningCash] = useState('0.00');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [alreadyOpen, setAlreadyOpen] = useState(false);
  const [cashierLabel, setCashierLabel] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionExpired(params.get('reason') === 'session-expired');
    const open = Boolean(getTaquillaToken() && getSessionId());
    setAlreadyOpen(open);
    const user = getTaquillaUser();
    setCashierLabel(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : '',
    );
  }, []);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (alreadyOpen) {
      router.replace('/venta');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { accessToken, user } = await loginRequest(email, password);
      if (!user?.organizationId) {
        throw new Error('Usuario sin organización asignada');
      }

      saveTaquillaSession(accessToken, {
        terminalLabel: terminalId,
        user,
        cashierId: user.id,
      });

      const float = Number(openingCash);
      await openShift({
        organizationId: user.organizationId,
        cashierId: user.id,
        openingCash: Number.isFinite(float) && float >= 0 ? float : 0,
        forceNew: false,
      });

      router.replace('/venta');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  const ready = alreadyOpen || (terminalId.trim().length > 0 && email.trim().length > 0 && password.length > 0);

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <p className={styles.wordmark}>Black Ticket</p>
        <p className={styles.clock}>{time}</p>
        <span className={styles.chip}>
          <span className={online ? styles.dotOn : styles.dotOff} aria-hidden="true" />
          {online ? 'En línea' : 'Sin red'}
        </span>
      </header>

      <form className={styles.column} onSubmit={(e) => void submit(e)}>
        <h1>{alreadyOpen ? 'Turno abierto' : 'Abrir turno'}</h1>
        {alreadyOpen ? (
          <p className={styles.read}>
            {cashierLabel || 'Cajero'} · fondo en esta terminal
          </p>
        ) : (
          <>
            <Field
              label="Terminal"
              value={terminalId}
              onChange={(e) => setTerminalId(e.target.value.toUpperCase())}
              hint="TAQ-01 · Mostrador"
              required
              autoComplete="off"
            />
            <Field
              label="Correo"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Field
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Field
              label="Fondo"
              kind="money"
              inputMode="decimal"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value.replace(/[^\d.]/g, ''))}
              hint="Puede ser $0.00"
              required
            />
          </>
        )}

        {sessionExpired ? <p className={styles.error}>La sesión expiró. Vuelve a entrar.</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}

        <TicketButton type="submit" fullWidth disabled={!ready || loading}>
          {loading ? 'Abriendo turno' : alreadyOpen ? 'Entrar al turno' : 'Abrir turno'}
        </TicketButton>
        <p className={styles.legend}>
          <kbd>↵</kbd> abre
        </p>
      </form>
    </main>
  );
}
