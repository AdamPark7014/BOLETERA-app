'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Field, TicketButton } from '@boletera/ui';
import { userFacingMessage } from '@/lib/errors';
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
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(
          res.status === 400 || res.status === 401 || res.status === 404
            ? 'El enlace no es válido o ya venció. Pide uno nuevo.'
            : userFacingMessage(data.message, res.status)
        );
        return;
      }
      setMsg('Contraseña actualizada.');
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

        <TicketButton type="submit" fullWidth disabled={loading}>
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
    <AuthShell title="Nueva contraseña">
      <Suspense fallback={<p className={styles.quiet}>Cargando.</p>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
