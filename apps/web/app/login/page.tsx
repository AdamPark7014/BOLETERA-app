'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { saveSession } from '@/lib/auth';
import purchase from '@/components/purchase/purchase.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function nextTarget(): string {
  if (typeof window === 'undefined') return '/cuenta';
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/cuenta';
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { email, password, firstName, lastName };
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'Correo o contraseña incorrectos.'
            : data.message ?? 'No se guardó. Revisa la conexión.',
        );
      }
      saveSession(data.accessToken, data.user);
      router.push(nextTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se guardó. Revisa la conexión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={purchase.column}>
        <h1 className={purchase.title}>Entrar</h1>
        <form onSubmit={submit} className={purchase.stack}>
          {mode === 'register' ? (
            <>
              <Field label="Nombre" value={firstName} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} required />
              <Field label="Apellido" value={lastName} autoComplete="family-name" onChange={(e) => setLastName(e.target.value)} required />
            </>
          ) : null}
          <Field
            label="Correo"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="nombre@dominio.com"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="Contraseña"
            type="password"
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error ? (
            <p className={purchase.error} role="alert">
              <span>{error}</span>
            </p>
          ) : null}
          <TicketButton type="submit" disabled={loading || !email.trim() || !password.trim()}>
            {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </TicketButton>
        </form>
        <div className={purchase.actions}>
          <Link href="/login/forgot" className={purchase.link}>
            Olvidé la contraseña
          </Link>
          <button
            type="button"
            className={purchase.link}
            onClick={() => setMode((current) => (current === 'login' ? 'register' : 'login'))}
          >
            {mode === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta'}
          </button>
          <Link href="/" className={purchase.link}>
            Atrás
          </Link>
        </div>
      </main>
    </>
  );
}
