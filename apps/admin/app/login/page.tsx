'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
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
          ? 'Credenciales inválidas. Verifica tu correo y contraseña.'
          : err instanceof ApiError
            ? err.userMessage
            : 'No se pudo conectar con el servidor. Revisa tu conexión.'
      );
    } finally {
      setLoading(false);
    }
  }

  const ready = email.trim().length > 0 && password.length > 0;

  return (
    <AuthShell title="Entrar al panel" lead="Eventos, ventas y liquidaciones de tu organización.">
      <form onSubmit={(e) => void submit(e)} className={styles.form}>
        <Field
          id="admin-email"
          label="Correo"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          id="admin-password"
          label="Contraseña"
          type={showPass ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
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

        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Mantener sesión iniciada en este dispositivo</span>
        </label>

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        <TicketButton type="submit" fullWidth disabled={!ready || loading}>
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
                }}
              >
                {account.label}
              </TicketButton>
            ))}
          </div>
          <p className={styles.tertiary}>
            Rellena el formulario; sigue haciendo falta pulsar «Entrar».
          </p>
        </div>
      ) : null}

      <p className={styles.foot}>
        ¿Eres organizador nuevo?{' '}
        <a
          className={styles.inlineLink}
          href="mailto:soporte@boletera.com?subject=Acceso%20al%20panel"
        >
          Contacta a tu administrador
        </a>
      </p>
    </AuthShell>
  );
}
