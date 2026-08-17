'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
        data.message ||
          'Si ese correo está registrado, te enviamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.',
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
        <form className={styles.simpleCard} onSubmit={onSubmit}>
          <h1>Recuperar contraseña</h1>
          <p className={styles.sub}>
            Escribe el correo de tu cuenta y te mandamos un enlace para crear una
            contraseña nueva.
          </p>
          <label htmlFor="forgot-email">
            Correo electrónico
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Enviando…' : 'Enviar enlace'}
          </button>
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
