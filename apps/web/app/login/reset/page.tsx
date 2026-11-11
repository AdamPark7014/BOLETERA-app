'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { useSearchParams, useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const email = params.get('email') || '';
  const token = params.get('token') || '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setFailed(false);
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailed(true);
        setMsg(
          data.message || 'El enlace ya no es válido. Pide uno nuevo desde «Recuperar contraseña».'
        );
        return;
      }
      setMsg(data.message || 'Listo. Tu contraseña quedó actualizada, ya puedes entrar.');
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setFailed(true);
      setMsg('No pudimos guardar la contraseña. Revisa tu conexión e inténtalo otra vez.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles.simpleCard} onSubmit={onSubmit}>
      <h1>Crear contraseña nueva</h1>
      <p className={styles.sub}>
        Elige una contraseña de al menos 8 caracteres para la cuenta de abajo.
      </p>
      <Field id="reset-email" name="email" label="Correo" type="email" value={email} readOnly />
      <Field
        id="reset-password"
        name="password"
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        hint="Mínimo 8 caracteres."
        required
      />
      <TicketButton type="submit" disabled={loading}>
        {loading ? 'Guardando…' : 'Guardar contraseña'}
      </TicketButton>
      {msg && (
        <p className={styles.feedback} role={failed ? 'alert' : 'status'}>
          {msg}
        </p>
      )}
      <Link href="/login" className={styles.backLink}>
        Volver a iniciar sesión
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <Suspense
          fallback={
            <p className={styles.sub} role="status">
              Cargando…
            </p>
          }
        >
          <ResetForm />
        </Suspense>
      </main>
    </>
  );
}
