'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError, login, storeSession } from '@/lib/api';
import { AuthShell, StatusBanner } from './_components/AuthShell';
import { oauthStartUrl, type OauthProvider } from './_lib/oauth';
import styles from './login.module.scss';

const DEMO_ACCOUNTS =
  process.env.NODE_ENV === 'production'
    ? []
    : [
        { label: 'Administrador', email: 'admin@demo.boletera.com', password: 'Admin123!' },
        { label: 'Taquilla', email: 'taquilla@demo.boletera.com', password: 'Admin123!' },
      ];

function startSso(provider: OauthProvider) {
  window.location.href = oauthStartUrl(provider, window.location.origin);
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const fieldErrors = {
    email: !email.trim()
      ? 'Escribe tu correo.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
        ? 'Ese correo no parece válido.'
        : undefined,
    password: !password ? 'Escribe tu contraseña.' : undefined,
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    const firstInvalid = (Object.keys(fieldErrors) as (keyof typeof fieldErrors)[]).find(
      (key) => fieldErrors[key]
    );
    if (firstInvalid) {
      document.getElementById(`admin-${firstInvalid}`)?.focus();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { accessToken, user } = await login(email, password);
      storeSession(accessToken, user);
      // Navegación completa, no `router.push`: los dos proveedores de sesión
      // (`lib/use-session` y `components/Session`) leen el token solo al montar
      // y envuelven también /login. Con navegación de cliente seguían en
      // "sin sesión" y el shell devolvía al usuario al login sin mensaje.
      window.location.assign('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Credenciales inválidas. Verifica tu correo y contraseña.'
          : err instanceof ApiError
            ? err.userMessage
            : 'No se pudo conectar con el servidor. Revisa tu conexión.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Entrar al panel">
      <form onSubmit={(e) => void submit(e)} className={styles.form} noValidate>
        <Field
          id="admin-email"
          label="Correo"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={showErrors ? fieldErrors.email : undefined}
        />
        <Field
          id="admin-password"
          label="Contraseña"
          type={showPass ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={showErrors ? fieldErrors.password : undefined}
          trailing={
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPass ? 'Ocultar' : 'Mostrar'}
            </button>
          }
        />
        <p className={styles.linkRow}>
          <Link className={styles.inlineLink} href="/login/forgot">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        <TicketButton type="submit" fullWidth disabled={loading}>
          {loading ? 'Verificando' : 'Entrar'}
        </TicketButton>
      </form>

      <p className={styles.divider}>o continúa con</p>
      <div className={styles.pair}>
        <TicketButton variant="secondary" onClick={() => startSso('google')}>
          Google Workspace
        </TicketButton>
        <TicketButton variant="secondary" onClick={() => startSso('microsoft')}>
          Microsoft 365
        </TicketButton>
      </div>

      {DEMO_ACCOUNTS.length > 0 ? (
        <div className={styles.demo}>
          <p className={styles.quiet}>Acceso de demostración</p>
          <div className={styles.pair}>
            {DEMO_ACCOUNTS.map((account) => (
              <TicketButton
                key={account.email}
                variant="ghost"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                  setError('');
                  setShowErrors(false);
                }}
              >
                {account.label}
              </TicketButton>
            ))}
          </div>
        </div>
      ) : null}

      <p className={styles.foot}>
        ¿Sin acceso?{' '}
        <a
          className={styles.inlineLink}
          href="mailto:soporte@boletera.com?subject=Acceso%20al%20panel"
        >
          Escríbenos
        </a>
      </p>
    </AuthShell>
  );
}
