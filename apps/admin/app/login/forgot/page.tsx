'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { AuthShell, StatusBanner } from '../_components/AuthShell';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setDevUrl(null);
    setError('');
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'No se pudo enviar la solicitud');
        return;
      }
      setMsg(data.message || 'Revisa tu correo si la cuenta existe.');
      if (data.devResetUrl) {
        const u = new URL(data.devResetUrl);
        setDevUrl(`/login/reset${u.search}`);
      }
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Recuperar contraseña"
      lead="Te enviamos un enlace si el correo está registrado en tu organización."
    >
      <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
        <Field
          id="forgot-email"
          label="Correo"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
        {msg ? <StatusBanner tone="success">{msg}</StatusBanner> : null}
        {devUrl ? (
          <StatusBanner tone="info">
            Enlace de desarrollo:{' '}
            <Link className={styles.inlineLink} href={devUrl}>
              abrir restablecimiento
            </Link>
          </StatusBanner>
        ) : null}

        <TicketButton type="submit" fullWidth disabled={loading || email.trim().length === 0}>
          {loading ? 'Enviando' : 'Enviar enlace'}
        </TicketButton>
      </form>

      <p className={styles.foot}>
        <Link className={styles.inlineLink} href="/login">
          Volver a entrar
        </Link>
      </p>
    </AuthShell>
  );
}
