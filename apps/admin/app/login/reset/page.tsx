'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Field, TicketButton } from '@boletera/ui';
import { AuthShell, StatusBanner } from '../_components/AuthShell';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const email = params.get('email') || '';
  const token = params.get('token') || '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMsg(null);
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Token inválido o expirado');
        return;
      }
      setMsg(data.message || 'Contraseña actualizada. Redirigiendo…');
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
        <Field id="reset-email" label="Correo" type="email" value={email} readOnly />
        <Field
          id="reset-password"
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          hint="Al menos 8 caracteres."
          required
        />

        {!token ? (
          <p className={styles.tertiary}>
            Este enlace no trae token. Ábrelo desde el correo de recuperación.
          </p>
        ) : null}
        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
        {msg ? <StatusBanner tone="success">{msg}</StatusBanner> : null}

        <TicketButton type="submit" fullWidth disabled={loading || password.length === 0}>
          {loading ? 'Guardando' : 'Guardar contraseña'}
        </TicketButton>
      </form>

      <p className={styles.foot}>
        <Link className={styles.inlineLink} href="/login">
          Volver a entrar
        </Link>
      </p>
    </>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <AuthShell
      title="Nueva contraseña"
      lead="Elige una contraseña segura de al menos 8 caracteres."
    >
      <Suspense fallback={<p className={styles.quiet}>Cargando.</p>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
