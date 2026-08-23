'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listVenues } from '@/lib/platform-api';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';

export default function VenuesPage() {
  const session = useSession();
  const [venues, setVenues] = useState<
    { id: string; name: string; slug: string; city?: string; totalCapacity?: number }[]
  >([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const token = session.token;

  useEffect(() => {
    if (!token) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // `listVenues(token).then(setVenues)` sin `catch`: cualquier 401/403 acababa
    // en un rechazo no capturado y una tabla vacía sin explicación.
    listVenues(token)
      .then(setVenues)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [token, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="listar los recintos"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Venues y mapas</h1>
          <p>Editor 2D, IA, vista 3D y publicación a eventos</p>
        </div>
      </header>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Capacidad</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.name}</strong>
                  <br />
                  <small style={{ color: 'var(--bl-gray-500)' }}>{v.slug}</small>
                </td>
                <td>{v.totalCapacity?.toLocaleString() ?? '—'}</td>
                <td style={{ display: 'flex', gap: '0.5rem' }}>
                  <Link href={`/venues/${v.id}/map`} className={platform.primaryBtn}>
                    Editor mapa
                  </Link>
                  <Link href={`/venues/${v.id}/3d`} className={platform.ghostBtn}>
                    3D
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && venues.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--bl-gray-600)' }}>
                  Tu organización todavía no tiene recintos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && <LoadingView label="Cargando recintos…" />}
      </section>
    </div>
  );
}
