'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@boletera/ui';
import { ApiError, login, storeSession } from '@/lib/api';
import { AuthShell, MobileBrand, StatusBanner } from './_components/AuthShell';
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

const DEMO_ACCOUNTS =
  process.env.NODE_ENV === 'production'
    ? []
    : [
        { label: 'Administrador', email: 'admin@demo.boletera.com', password: 'Admin123!' },
        { label: 'Taquilla', email: 'taquilla@demo.boletera.com', password: 'Admin123!' },
      ];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { accessToken, user } = await login(email, password);
      storeSession(accessToken, user);
      router.push('/dashboard');
    } catch (err) {
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
    <AuthShell>
      <MobileBrand />

      <header className={styles.cardHeader}>
        <h1>Bienvenido de vuelta</h1>
        <p>Inicia sesión para acceder a tu panel de administración.</p>
      </header>

      <form onSubmit={submit} className={styles.form}>
        <Input
          id="admin-email"
          type="email"
          label="Email corporativo"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@empresa.com"
          required
          leading={<IconMail />}
        />

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="admin-password">Contraseña</label>
            <Link className={styles.forgot} href="/login/forgot">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <Input
            id="admin-password"
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            leading={<IconLock />}
            trailing={
              <button
                type="button"
                className={styles.eyeBtnInline}
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <IconEye open={showPass} />
              </button>
            }
          />
        </div>

        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Mantener sesión iniciada en este dispositivo</span>
        </label>

        {DEMO_ACCOUNTS.length > 0 && (
          <div className={styles.demo}>
            <span className={styles.demoLabel}>Acceso de demostración</span>
            <div className={styles.demoRow}>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className={styles.demoBtn}
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError('');
                  }}
                >
                  {account.label}
                </button>
              ))}
            </div>
            <small>Rellena el formulario; sigue haciendo falta pulsar «Entrar».</small>
          </div>
        )}

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        <Button type="submit" fullWidth loading={loading} loadingLabel="Verificando credenciales…">
          Entrar al panel
        </Button>
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
        ¿Eres organizador nuevo?{' '}
        <a href="mailto:soporte@boletera.com?subject=Acceso%20al%20panel">Contacta a tu administrador</a>
      </p>
    </AuthShell>
  );
}
