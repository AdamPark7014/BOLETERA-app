'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(
        typeof data.message === 'string' && /[áéíóúñ¿¡]/i.test(data.message)
          ? data.message
          : 'Si ese correo está registrado, te enviamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.'
      );
      if (data.devResetUrl) setDevUrl(data.devResetUrl);
    } catch {
      setMsg('No pudimos enviar la solicitud. Revisa tu conexión e inténtalo otra vez.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <form className={styles.simpleCard} onSubmit={onSubmit} noValidate>
          <h1>Recuperar contraseña</h1>
          <Field
            id="forgot-email"
            name="email"
            label="Correo"
            type="email"
            autoComplete="email"
            placeholder="nombre@dominio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={showErrors ? emailError : undefined}
            required
          />
          <TicketButton type="submit" disabled={loading}>
            {loading ? 'Enviando…' : 'Enviar enlace'}
          </TicketButton>
          {msg && (
            <p className={styles.feedback} role="status">
              {msg}
            </p>
          )}
          {devUrl && (
            <p className={styles.feedback}>
              Enlace de desarrollo:{' '}
              <Link href={devUrl.replace(/^https?:\/\/[^/]+/, '')}>{devUrl}</Link>
            </p>
          )}
          <Link href="/login" className={styles.backLink}>
            Volver a iniciar sesión
          </Link>
        </form>
      </main>
    </>
  );
}
