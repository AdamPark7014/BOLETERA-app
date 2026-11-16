'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { looksSpanish, userFacingMessage } from '@/lib/errors';
import { AuthShell, StatusBanner } from '../_components/AuthShell';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const emailError = !email.trim()
    ? 'Escribe tu correo.'
    : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
      ? 'Ese correo no parece válido.'
      : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (emailError) {
      document.getElementById('forgot-email')?.focus();
      return;
    }
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
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        devResetUrl?: string;
      };
      if (!res.ok) {
        setError(userFacingMessage(data.message, res.status));
        return;
      }
      setMsg(
        data.message && looksSpanish(data.message)
          ? data.message
          : 'Si el correo está registrado, te enviamos un enlace.'
      );
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
    <AuthShell title="Recuperar contraseña">
      <form className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field
          id="forgot-email"
          label="Correo"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={showErrors ? emailError : undefined}
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

        <TicketButton type="submit" fullWidth disabled={loading}>
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
