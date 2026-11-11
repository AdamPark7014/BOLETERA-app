'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { storeSession } from '@/lib/api';
import { AuthShell, StatusBanner } from '../../_components/AuthShell';
import { oauthCallbackRedirectUri, resolveOauthProvider } from '../../_lib/oauth';
import styles from '../../login.module.scss';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

function OauthCallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const provider = resolveOauthProvider(params.get('provider'));
    if (!code) {
      setError('Falta el código del proveedor. Vuelve a intentarlo desde la pantalla de acceso.');
      return;
    }

    const redirectUri = oauthCallbackRedirectUri(provider, window.location.origin);
    void (async () => {
      try {
        const res = await fetch(`${API}/auth/oauth/${provider}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'El inicio de sesión con el proveedor falló.');
        }
        const data = (await res.json()) as {
          accessToken: string;
          user: { email: string; organizationId?: string | null; role?: string };
        };
        // Antes se escribía `boletera_org_id`, clave que no leía nadie: tras SSO
        // la organización quedaba sin resolver y toda pantalla que la exige
        // recibía 403. `storeSession` es ahora el único punto de escritura.
        storeSession(data.accessToken, {
          organizationId: data.user.organizationId ?? null,
          role: data.user.role ?? '',
        });
        router.replace('/dashboard');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de inicio de sesión con el proveedor.');
      }
    })();
  }, [params, router]);

  if (!error) return <p className={styles.quiet}>Completando el acceso con tu proveedor.</p>;
  return (
    <>
      <StatusBanner tone="error">{error}</StatusBanner>
      <p className={styles.foot}>
        <Link className={styles.inlineLink} href="/login">
          Volver a entrar
        </Link>
      </p>
    </>
  );
}

/**
 * `useSearchParams` obliga a renderizar en cliente: sin este límite de Suspense
 * el prerenderizado estático de la ruta falla y rompe el build de admin.
 */
export default function OauthCallbackPage() {
  return (
    <AuthShell title="Inicio de sesión único">
      <Suspense fallback={<p className={styles.quiet}>Completando el acceso con tu proveedor.</p>}>
        <OauthCallbackHandler />
      </Suspense>
    </AuthShell>
  );
}
