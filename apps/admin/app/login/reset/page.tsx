'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@boletera/ui';
import { AuthShell, MobileBrand, StatusBanner } from '../_components/AuthShell';
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
      <MobileBrand />

      <header className={styles.cardHeader}>
        <h1>Nueva contraseña</h1>
        <p>Elige una contraseña segura de al menos 8 caracteres.</p>
      </header>

      <form className={styles.form} onSubmit={onSubmit}>
        <Input id="reset-email" type="email" label="Email" value={email} readOnly />
        <Input
          id="reset-password"
          type="password"
          label="Nueva contraseña"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
        {msg ? <StatusBanner tone="success">{msg}</StatusBanner> : null}

        <Button type="submit" fullWidth loading={loading} loadingLabel="Guardando…">
          Guardar contraseña
        </Button>
      </form>

      <p className={styles.footer}>
        <Link href="/login">← Volver al inicio de sesión</Link>
      </p>
    </>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <AuthShell compact>
      <Suspense
        fallback={
          <>
            <MobileBrand />
            <p className={styles.cardHeader}>Cargando…</p>
          </>
        }
      >
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
