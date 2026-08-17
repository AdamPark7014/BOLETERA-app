'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, login, storeSession } from '@/lib/api';
import styles from './login.module.scss';

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="m4 8 8 5 8-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 11V8a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m3 3 18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6s-1 1.7-2.8 3.4M6.6 8C4 9.7 2 12 2 12s3.5 6 10 6c1.5 0 2.9-.3 4.1-.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Sparkline() {
  // Curva animada para el panel decorativo
  return (
    <svg className={styles.spark} viewBox="0 0 320 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fafafa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fafafa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,80 C40,70 60,40 100,45 C140,50 160,20 200,28 C240,36 260,55 320,30 L320,100 L0,100 Z"
        fill="url(#sparkGrad)"
      />
      <path
        d="M0,80 C40,70 60,40 100,45 C140,50 160,20 200,28 C240,36 260,55 320,30"
        fill="none"
        stroke="#fafafa"
        strokeOpacity="0.85"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    tick();
    const i = setInterval(tick, 30000);
    return () => clearInterval(i);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { accessToken, user } = await login(email, password);
      storeSession(accessToken, user);
      router.push('/dashboard');
    } catch (err) {
      // Un 500 o una caída de red no son "credenciales inválidas": decirlo así
      // manda al operador a revisar su contraseña cuando el problema es el servidor.
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Credenciales inválidas. Verifica tu email y contraseña.'
          : err instanceof ApiError
            ? err.userMessage
            : 'No se pudo conectar con el servidor. Revisa tu conexión.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.aurora} aria-hidden="true">
        <div className={styles.blob1} />
        <div className={styles.blob2} />
        <div className={styles.blob3} />
        <div className={styles.grid} />
      </div>

      <div className={styles.shell}>
        {/* PANEL IZQUIERDO — MARCA + STATS */}
        <aside className={styles.brand}>
          <div className={styles.brandTop}>
            <div className={styles.logoBlock}>
              <div className={styles.logoMark}>
                <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <rect width="32" height="32" rx="9" fill="#fafafa" />
                  <path d="M9 11h14M9 16h14M9 21h9" stroke="#0a0a0a" strokeWidth="2.2" strokeLinecap="round" />
                  <circle cx="22" cy="21" r="2.5" fill="#0a0a0a" />
                </svg>
              </div>
              <div>
                <p className={styles.logoText}>BOLETERA</p>
                <p className={styles.logoSub}>Administración</p>
              </div>
            </div>
            <span className={styles.badgeLive}>
              <span className={styles.dot} />
              {time}
            </span>
          </div>

          <div className={styles.brandHero}>
            <p className={styles.brandKicker}>Panel de organizador</p>
            <h2 className={styles.brandTitle}>
              Eventos, ventas
              <br />
              y liquidaciones.
            </h2>
            <p className={styles.brandCopy}>
              Inventario, taquilla, Banorte y reportes en un solo lugar.
            </p>
          </div>

          <div className={styles.statCards}>
            <div className={styles.statCard}>
              <span>Ventas hoy</span>
              <strong>$284,930</strong>
              <small className={styles.up}>▲ 12.4% vs ayer</small>
              <Sparkline />
            </div>
            <div className={styles.statRow}>
              <div className={styles.miniStat}>
                <span>Órdenes</span>
                <strong>1,283</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Terminales</span>
                <strong>24/26</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Scan rate</span>
                <strong>98.7%</strong>
              </div>
            </div>
          </div>

          <ul className={styles.features}>
            <li>
              <span className={styles.featDot} />
              Multi-canal: web · POS · API · admin
            </li>
            <li>
              <span className={styles.featDot} />
              Mapas 3D y holds en tiempo real
            </li>
            <li>
              <span className={styles.featDot} />
              Reportes, payouts y antifraude integrados
            </li>
          </ul>

          <p className={styles.brandFooter}>
            © {new Date().getFullYear()} Boletera · SOC 2 Type II · PCI-DSS L1
          </p>
        </aside>

        {/* PANEL DERECHO — FORMULARIO */}
        <section className={styles.panel}>
          <div className={styles.card}>
            <div className={styles.mobileBrand}>
              <div className={styles.logoMark}>
                <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <rect width="32" height="32" rx="9" fill="#0a0a0a" />
                  <path d="M9 11h14M9 16h14M9 21h9" stroke="#fafafa" strokeWidth="2.2" strokeLinecap="round" />
                  <circle cx="22" cy="21" r="2.5" fill="#fafafa" />
                </svg>
              </div>
              <div>
                <p className={styles.logoText}>BOLETERA</p>
                <p className={styles.logoSub}>Administración</p>
              </div>
            </div>

            <header className={styles.cardHeader}>
              <h1>Bienvenido de vuelta</h1>
              <p>Inicia sesión para acceder a tu panel de administración.</p>
            </header>

            <form onSubmit={submit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="admin-email">Email corporativo</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconMail />
                  </span>
                  <input
                    id="admin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@empresa.com"
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="admin-password">Contraseña</label>
                  <a className={styles.forgot} href="/login/forgot">
                    ¿Olvidaste tu contraseña?
                  </a>
                </div>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconLock />
                  </span>
                  <input
                    id="admin-password"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <IconEye open={showPass} />
                  </button>
                </div>
              </div>

              <label className={styles.remember}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Mantener sesión iniciada en este dispositivo</span>
              </label>

              {error && (
                <div className={styles.error} role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Verificando credenciales…
                  </>
                ) : (
                  <>
                    Entrar al panel
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            <div className={styles.divider}>
              <span>o continúa con</span>
            </div>

            <div className={styles.ssoRow}>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => {
                  const api = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
                  const redirect = `${window.location.origin}/login/oauth/callback?provider=google`;
                  window.location.href = `${api}/auth/oauth/google/start?redirect_uri=${encodeURIComponent(redirect)}`;
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22 12.2c0-.8-.1-1.4-.2-2H12v3.8h5.7c-.2 1.3-1 2.4-2.1 3.1v2.5h3.4c2-1.8 3-4.5 3-7.4Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3v2.5C4.8 19.8 8.1 22 12 22Z"
                  />
                  <path fill="#FBBC04" d="M6.5 14.1A6 6 0 0 1 6.2 12c0-.7.1-1.4.3-2.1V7.4H3a10 10 0 0 0 0 9.1l3.5-2.4Z" />
                  <path
                    fill="#EA4335"
                    d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.8 4.2 3 7.4l3.5 2.5C7.3 7.6 9.4 5.9 12 5.9Z"
                  />
                </svg>
                Google Workspace
              </button>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => {
                  const api = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
                  const redirect = `${window.location.origin}/login/oauth/callback?provider=microsoft`;
                  window.location.href = `${api}/auth/oauth/microsoft/start?redirect_uri=${encodeURIComponent(redirect)}`;
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" fill="#0078D4" />
                </svg>
                Microsoft 365
              </button>
            </div>

            <p className={styles.footer}>
              ¿Eres organizador nuevo? <a href="#">Solicita acceso al equipo</a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
