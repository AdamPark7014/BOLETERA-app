'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EVENT_STOCK_IMAGES } from '@boletera/shared';
import { Badge, Button, Input } from '@boletera/ui';
import { loginRequest, saveTaquillaSession } from '@/lib/auth';
import { openShift } from '@/lib/pos';
import styles from './login.module.scss';

const HERO_IMAGE = EVENT_STOCK_IMAGES.FESTIVAL;

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

function IconCash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
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
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionExpired(params.get('reason') === 'session-expired');
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
      <div className={styles.backdrop} style={{ backgroundImage: `url(${HERO_IMAGE})` }} aria-hidden="true" />

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="9" fill="var(--bl-accent)" />
                <path d="M9 11h14M9 16h14M9 21h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="22" cy="21" r="2.5" fill="#fff" />
              </svg>
            </span>
            BOLETERA · TAQUILLA
          </span>
        </div>
        <div className={styles.topRight}>
          <Badge tone={online ? 'success' : 'warning'} variant="soft" dot>
            {online ? 'En línea' : 'Sin conexión · ventas en cola'}
          </Badge>
          <span className={styles.clock}>
            <strong>{time}</strong>
            <small>{date}</small>
          </span>
        </div>
      </header>

      <div className={styles.shell}>
        <aside className={styles.hero} style={{ backgroundImage: `url(${HERO_IMAGE})` }}>
          <div className={styles.heroOverlay} />
          <div className={styles.heroContent}>
            <p className={styles.heroKicker}>Box office POS</p>
            <h1>
              Abre turno
              <br />
              y cobra en mostrador.
            </h1>
            <p className={styles.heroLead}>
              Fondo de caja, venta por zona, efectivo con cambio, reimpresión y corte.
            </p>
            <ul className={styles.heroFeatures}>
              <li>
                <span className={styles.featDot} />
                Venta rápida por zona y asiento
              </li>
              <li>
                <span className={styles.featDot} />
                Efectivo, tarjeta y cambio automático
              </li>
              <li>
                <span className={styles.featDot} />
                Corte de caja y auditoría por terminal
              </li>
            </ul>
          </div>
        </aside>

        <section className={styles.formPanel} data-theme="light">
          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <Badge tone="accent" variant="soft">
                Apertura de turno
              </Badge>
              <h2>Identifícate, cajero</h2>
              <p>Terminal, credencial y fondo inicial de caja.</p>
            </header>

            <form onSubmit={submit} className={styles.form}>
              <Input
                id="terminal"
                label="Terminal"
                value={terminalId}
                onChange={(e) => setTerminalId(e.target.value.toUpperCase())}
                placeholder="TAQ-01"
                required
                inputSize="lg"
                leading={<IconTerminal />}
                className={styles.monoField}
              />

              <Input
                id="cajero-email"
                type="email"
                label="Email del cajero"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cajero@boletera.com"
                required
                inputSize="lg"
                leading={<IconUser />}
              />

              <Input
                id="cajero-password"
                type="password"
                label="Contraseña"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                inputSize="lg"
                leading={<IconLock />}
              />

              <Input
                id="opening-cash"
                type="number"
                label="Fondo de caja (MXN)"
                min={0}
                step="0.01"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                required
                inputSize="lg"
                leading={<IconCash />}
              />

              {sessionExpired ? (
                <div className={styles.error} role="status">
                  <span>Tu sesión expiró. Vuelve a entrar con tu contraseña (demo: Admin123!).</span>
                </div>
              ) : null}

              {error ? (
                <div className={styles.error} role="alert">
                  <span>{error}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={loading}
                loadingLabel="Abriendo turno…"
              >
                Abrir turno
              </Button>
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
