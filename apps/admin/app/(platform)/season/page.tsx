'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ApiError, adminApi } from '@/lib/api';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';

type SeasonPass = {
  id: string;
  name: string;
  slug: string;
  seasonLabel: string;
  price: string | number;
  soldQuantity: number;
  maxQuantity: number;
  active: boolean;
  events: { event: { id: string; title: string } }[];
};

export default function SeasonPassesPage() {
  const session = useSession();
  const { token, orgId } = session;
  const [rows, setRows] = useState<SeasonPass[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [seasonLabel, setSeasonLabel] = useState('2026-2027');
  const [price, setPrice] = useState('4500');
  const [error, setError] = useState<unknown>(null);
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function reload() {
    if (!token || !orgId) return;
    setLoading(true);
    setError(null);
    // Antes: `fetch(...).then(r => r.json()).then(setRows)`. Con un 401 el cuerpo
    // del error entraba en `rows` y `rows.map` reventaba la pantalla entera.
    adminApi<SeasonPass[]>(`/season/org/${orgId}`, token)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (session.status === 'ready') reload();
    else if (session.status !== 'loading') setLoading(false);
  }, [orgId, token, session.status]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !orgId) return;
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    setSaving(true);
    setFormMsg(null);
    try {
      await adminApi(`/season/org/${orgId}`, token, {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
          seasonLabel,
          startsAt,
          endsAt,
          price: Number(price),
        }),
      });
      setName('');
      setSlug('');
      setFormMsg('Abono creado.');
      reload();
    } catch (err) {
      // El alta fallaba en silencio: sin `await` comprobado, el formulario se
      // limpiaba igual y el usuario creía haber creado el abono.
      setFormMsg(
        err instanceof ApiError
          ? `No se pudo crear: ${err.userMessage} (${err.status})`
          : 'No se pudo crear el abono.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return <ApiErrorView error={error} context="listar los abonos de temporada" onRetry={reload} />;
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Abonos / temporadas</h1>
          <p>Pases de temporada ligados a múltiples eventos del venue</p>
        </div>
      </header>

      <section className={platform.panel}>
        <form onSubmit={onCreate} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug" />
          <input
            value={seasonLabel}
            onChange={(e) => setSeasonLabel(e.target.value)}
            placeholder="Temporada"
            required
          />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Precio MXN" required />
          <button type="submit" className={platform.primaryBtn} disabled={saving}>
            {saving ? 'Creando…' : 'Crear abono'}
          </button>
          {formMsg && (
            <p role="status" style={{ margin: 0, fontSize: '0.875rem' }}>
              {formMsg}
            </p>
          )}
        </form>
      </section>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Temporada</th>
              <th>Precio</th>
              <th>Vendidos</th>
              <th>Eventos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.seasonLabel}</td>
                <td>${Number(r.price).toLocaleString('es-MX')}</td>
                <td>
                  {r.soldQuantity}/{r.maxQuantity}
                </td>
                <td>{r.events?.length ?? 0}</td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={5}>Sin abonos aún</td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && <LoadingView label="Cargando abonos…" />}
      </section>
    </div>
  );
}
