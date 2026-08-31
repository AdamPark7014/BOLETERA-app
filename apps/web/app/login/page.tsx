'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { useTenantBrand } from '@/components/TenantBrand';
import { saveSession } from '@/lib/auth';
import styles from './login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/**
 * Con la sesión caducando cada 2 h, volver al login dejó de ser excepcional:
 * el destino viaja en `?next=` para no perder el contexto. Solo se aceptan
 * rutas internas, para que nadie pueda usar el parámetro como redirección
 * abierta hacia otro dominio.
 */
function nextTarget(): string {
  if (typeof window === 'undefined') return '/cuenta';
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/cuenta';
}

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="m4 8 8 5 8-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 11V8a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 21c1-4 4-6 8-6s7 2 8 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const brand = useTenantBrand();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPass, setShowPass] = useState(false);
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
        // Nada de códigos crudos: el mensaje describe qué hacer.
        throw new Error(
          res.status === 401
            ? 'Correo o contraseña incorrectos. Revísalos e inténtalo otra vez.'
            : data.message ?? 'No pudimos completar la operación. Inténtalo de nuevo.',
        );
      }
      saveSession(data.accessToken, data.user);
      router.push(nextTarget());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.shell}>
          {/* Lado izquierdo: marketing (oculto en móvil, por eso no lleva el h1) */}
          <aside className={styles.left} aria-label="Por qué crear una cuenta">
            <p className={styles.kicker}>Tu cuenta {brand.name}</p>
            <p className={styles.leadHeadline}>
              Compra rápido,
              <br />
              guarda tus boletos,
              <br />
              <span className={styles.gradient}>nunca pierdas un show.</span>
            </p>
            <ul className={styles.perks}>
              <li>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
                Reserva y compra en segundos
              </li>
              <li>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
                Boletos digitales con QR
              </li>
              <li>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
                Preventa exclusiva para miembros
              </li>
              <li>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
                Reventa segura con vendedor verificado
              </li>
            </ul>
          </aside>

          {/* Derecha: formulario */}
          <section className={styles.right}>
            <div className={styles.card}>
              <div className={styles.tabs}>
                {/*
                 * Antes eran role="tab" sin tabpanel ni aria-controls: un patrón
                 * de pestañas a medias confunde más que ayudar. Son dos botones
                 * de alternancia y así se anuncian.
                 */}
                <button
                  type="button"
                  className={mode === 'login' ? styles.tabActive : styles.tab}
                  aria-pressed={mode === 'login'}
                  onClick={() => setMode('login')}
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  className={mode === 'register' ? styles.tabActive : styles.tab}
                  aria-pressed={mode === 'register'}
                  onClick={() => setMode('register')}
                >
                  Crear cuenta
                </button>
              </div>

              <header className={styles.cardHead}>
                {/*
                 * El h1 vive aquí y no en la columna de marketing: aquella se
                 * oculta por debajo de 900px y la página se quedaba sin nivel 1
                 * justo en móvil, que es la mayoría del tráfico.
                 */}
                <h1>{mode === 'login' ? 'Entra a tu cuenta' : 'Crea tu cuenta'}</h1>
                <p>
                  {mode === 'login'
                    ? 'Entra para ver tus boletos y comprar más rápido.'
                    : 'Crea tu cuenta gratuita para comprar y guardar tus boletos.'}
                </p>
              </header>

              <form onSubmit={submit} className={styles.form}>
                {mode === 'register' && (
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label htmlFor="first-name">Nombre</label>
                      <div className={styles.inputWrap}>
                        <span className={styles.icon} aria-hidden="true">
                          <IconUser />
                        </span>
                        <input
                          id="first-name"
                          name="firstName"
                          autoComplete="given-name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="last-name">Apellido</label>
                      <div className={styles.inputWrap}>
                        <input
                          id="last-name"
                          name="lastName"
                          autoComplete="family-name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.field}>
                  <label htmlFor="email">Correo electrónico</label>
                  <div className={styles.inputWrap}>
                    <span className={styles.icon} aria-hidden="true">
                      <IconMail />
                    </span>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nombre@correo.com"
                      required
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="password">Contraseña</label>
                    {mode === 'login' && (
                      <Link className={styles.forgot} href="/login/forgot">
                        ¿Olvidaste tu contraseña?
                      </Link>
                    )}
                  </div>
                  <div className={styles.inputWrap}>
                    <span className={styles.icon} aria-hidden="true">
                      <IconLock />
                    </span>
                    <input
                      id="password"
                      name="password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      aria-describedby={mode === 'register' ? 'password-hint' : undefined}
                      required
                    />
                    <button
                      type="button"
                      className={styles.eyeBtn}
                      onClick={() => setShowPass((v) => !v)}
                      aria-pressed={showPass}
                      aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                        {showPass && (
                          <path
                            d="m4 4 16 16"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        )}
                      </svg>
                    </button>
                  </div>
                  {mode === 'register' && (
                    <p id="password-hint" className={styles.hint}>
                      Mínimo 8 caracteres.
                    </p>
                  )}
                </div>

                {error && (
                  <div className={styles.error} role="alert">
                    {error}
                  </div>
                )}

                <Button type="submit" size="lg" className={styles.submit} disabled={loading}>
                  {loading ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" />
                      Procesando…
                    </>
                  ) : mode === 'login' ? (
                    'Entrar'
                  ) : (
                    'Crear cuenta gratis'
                  )}
                </Button>

                <div className={styles.divider}>
                  <span>o continúa con</span>
                </div>

                <div className={styles.socials}>
                  <button
                    type="button"
                    className={styles.socialBtn}
                    disabled
                    aria-describedby="socials-note"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        fill="#4285F4"
                        d="M22 12.2c0-.8-.1-1.4-.2-2H12v3.8h5.7c-.2 1.3-1 2.4-2.1 3.1v2.5h3.4c2-1.8 3-4.5 3-7.4Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3v2.5C4.8 19.8 8.1 22 12 22Z"
                      />
                      <path
                        fill="#FBBC04"
                        d="M6.5 14.1A6 6 0 0 1 6.2 12c0-.7.1-1.4.3-2.1V7.4H3a10 10 0 0 0 0 9.1l3.5-2.4Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.8 4.2 3 7.4l3.5 2.5C7.3 7.6 9.4 5.9 12 5.9Z"
                      />
                    </svg>
                    Google
                  </button>
                  <button
                    type="button"
                    className={styles.socialBtn}
                    disabled
                    aria-describedby="socials-note"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="#1877F2"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 5 3.7 9.1 8.4 9.9V15H8v-3h2.4V9.8C10.4 7.4 11.9 6 14.1 6c1 0 2.1.2 2.1.2v2.4h-1.2c-1.2 0-1.5.7-1.5 1.5V12h2.6l-.4 3h-2.2v6.9c4.7-.8 8.5-4.9 8.5-9.9z" />
                    </svg>
                    Facebook
                  </button>
                </div>
                {/* Un botón deshabilitado sin explicación deja al usuario a ciegas. */}
                <p id="socials-note" className={styles.hint}>
                  El acceso con Google y Facebook todavía no está disponible.
                </p>
              </form>

              <p className={styles.terms}>
                Al continuar aceptas los <Link href="/terminos">Términos</Link> y el{' '}
                <Link href="/privacidad">Aviso de privacidad</Link>.
              </p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
