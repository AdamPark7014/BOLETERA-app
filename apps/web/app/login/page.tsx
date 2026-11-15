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
  const [showErrors, setShowErrors] = useState(false);
  const fieldErrors = {
    firstName: mode === 'register' && !firstName.trim() ? 'Escribe tu nombre.' : undefined,
    lastName: mode === 'register' && !lastName.trim() ? 'Escribe tu apellido.' : undefined,
    email: !email.trim()
      ? 'Escribe tu correo.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
        ? 'Ese correo no parece válido.'
        : undefined,
    password: !password
      ? 'Escribe tu contraseña.'
      : mode === 'register' && password.length < 8
        ? 'Usa al menos 8 caracteres.'
        : undefined,
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    const firstInvalid = (Object.keys(fieldErrors) as (keyof typeof fieldErrors)[]).find(
      (key) => fieldErrors[key]
    );
    if (firstInvalid) {
      document.getElementById(`login-${firstInvalid}`)?.focus();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login' ? { email, password } : { email, password, firstName, lastName };
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
            : (data.message ?? 'No se guardó. Revisa la conexión.')
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
        <h1 className={purchase.title}>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</h1>
        <form onSubmit={submit} className={purchase.stack} noValidate>
          {mode === 'register' ? (
            <>
              <Field
                id="login-firstName"
                label="Nombre"
                value={firstName}
                autoComplete="given-name"
                onChange={(e) => setFirstName(e.target.value)}
                error={showErrors ? fieldErrors.firstName : undefined}
                required
              />
              <Field
                id="login-lastName"
                label="Apellido"
                value={lastName}
                autoComplete="family-name"
                onChange={(e) => setLastName(e.target.value)}
                error={showErrors ? fieldErrors.lastName : undefined}
                required
              />
            </>
          ) : null}
          <Field
            id="login-email"
            label="Correo"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="nombre@dominio.com"
            onChange={(e) => setEmail(e.target.value)}
            error={showErrors ? fieldErrors.email : undefined}
            required
          />
          <Field
            id="login-password"
            label="Contraseña"
            type="password"
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            error={showErrors ? fieldErrors.password : undefined}
            required
            minLength={8}
          />
          {mode === 'login' ? (
            <Link href="/login/forgot" className={purchase.link}>
              Olvidé la contraseña
            </Link>
          ) : null}
          {error ? (
            <p className={purchase.error} role="alert">
              <span>{error}</span>
            </p>
          ) : null}
          <TicketButton type="submit" disabled={loading}>
            {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </TicketButton>
        </form>
        <div className={purchase.actions}>
          <button
            type="button"
            className={purchase.link}
            onClick={() => {
              setShowErrors(false);
              setError('');
              setMode((current) => (current === 'login' ? 'register' : 'login'));
            }}
          >
            {mode === 'login' ? '¿No tienes cuenta? Créala' : 'Ya tengo cuenta'}
          </button>
        </div>
      </main>
    </>
  );
}
