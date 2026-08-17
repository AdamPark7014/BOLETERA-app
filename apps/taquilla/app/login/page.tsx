'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginRequest, saveTaquillaSession } from '@/lib/auth';
import { openShift } from '@/lib/pos';
import styles from './login.module.scss';

function IconTerminal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 9l2 2-2 2M11 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function TaquillaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terminalId, setTerminalId] = useState('TAQ-01');
  const [openingCash, setOpeningCash] = useState('500');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

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
      const d = new Date();
      setTime(d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long' }));
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // `loginRequest` no pasa por el interceptor de 401: aquí un 401 significa
      // credenciales incorrectas, no sesión caducada.
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

      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.bg} aria-hidden="true" />
      <div className={styles.scan} aria-hidden="true" />

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#f4f4f5" />
              <path d="M9 11h14M9 16h14M9 21h9" stroke="#18181b" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="22" cy="21" r="2.5" fill="#18181b" />
            </svg>
            BOLETERA · TAQUILLA
          </span>
        </div>
        <div className={styles.topRight}>
          <span className={online ? styles.statusOn : styles.statusOff}>
            <span className={styles.dotSm} />
            {online ? 'En línea' : 'Sin conexión · ventas en cola'}
          </span>
          <span className={styles.clock}>
            <strong>{time}</strong>
            <small>{date}</small>
          </span>
        </div>
      </header>

      <div className={styles.shell}>
        <section className={styles.showcase}>
          <div className={styles.showcaseInner}>
            <p className={styles.kicker}>Box office POS</p>
            <h1>
              Abre turno
              <br />
              y cobra en mostrador.
            </h1>
            <p className={styles.lead}>
              Fondo de caja, venta por zona, efectivo con cambio, reimpresión y corte.
            </p>
          </div>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <span className={styles.cardBadge}>Apertura de turno</span>
              <h2>Identifícate, cajero</h2>
              <p>Terminal, credencial y fondo inicial de caja.</p>
            </header>

            <form onSubmit={submit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="terminal">Terminal</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconTerminal />
                  </span>
                  <input
                    id="terminal"
                    className={styles.mono}
                    value={terminalId}
                    onChange={(e) => setTerminalId(e.target.value.toUpperCase())}
                    placeholder="TAQ-01"
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="cajero-email">Email del cajero</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconUser />
                  </span>
                  <input
                    id="cajero-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cajero@boletera.com"
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="cajero-password">Contraseña</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconLock />
                  </span>
                  <input
                    id="cajero-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="opening-cash">Fondo de caja (MXN)</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>$</span>
                  <input
                    id="opening-cash"
                    type="number"
                    min={0}
                    step="0.01"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <div className={styles.error} role="alert">
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? 'Abriendo turno…' : 'Abrir turno'}
              </button>
            </form>

            <p className={styles.cardFooter}>
              Solo personal autorizado. Las ventas de esta terminal quedan auditadas.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
