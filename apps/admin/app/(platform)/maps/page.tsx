'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { applyLayoutTemplate, createVenue, listVenues } from '@/lib/platform-api';
import platform from '../_styles/platform.module.scss';

type VenueRow = {
  id: string;
  name: string;
  slug: string;
  city?: string;
  totalCapacity?: number;
  _count?: { events: number };
  layouts?: { id: string; version: number; updatedAt: string }[];
};

const TEMPLATES = [
  { id: 'blank' as const, label: 'En blanco', hint: 'Empieza desde cero en el estudio 3D' },
  { id: 'arena' as const, label: 'Arena', hint: 'Bowl con secciones alrededor del escenario' },
  { id: 'theater' as const, label: 'Teatro', hint: 'Platea frontal + balcones' },
  { id: 'stadium' as const, label: 'Estadio', hint: 'Capacidad alta por zonas' },
  { id: 'festival' as const, label: 'Festival', hint: 'GA + zonas perimetrales' },
];

export default function MapsCreatorPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('Ciudad de México');
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]['id']>('blank');

  async function refresh() {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    const list = await listVenues(token);
    setVenues(list);
  }

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) {
      setLoading(false);
      setError('Sesión no encontrada. Inicia sesión de nuevo.');
      return;
    }
    refresh()
      .catch(() => setError('No se pudieron cargar los mapas.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    if (!token || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const venue = await createVenue(token, {
        name: name.trim(),
        city: city.trim() || undefined,
        template,
      });
      if (template !== 'blank') {
        await applyLayoutTemplate(token, venue.id, template);
      }
      router.push(`/venues/${venue.id}/3d?studio=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el mapa');
      setCreating(false);
    }
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Creador de mapas</h1>
          <p>
            Diseña en 3D desde cero. La planta 2D se deriva automáticamente y queda sincronizada con
            los eventos del venue.
          </p>
        </div>
      </header>

      <section className={platform.panel} style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Nuevo mapa</h2>
        <form
          onSubmit={handleCreate}
          style={{ display: 'grid', gap: '0.75rem', maxWidth: 720 }}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#737373' }}>Nombre del venue</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Arena Norte, Teatro Principal…"
              style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #d4d4d4' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#737373' }}>Ciudad</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #d4d4d4' }}
            />
          </label>
          <div>
            <span style={{ fontSize: 12, color: '#737373' }}>Base inicial</span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 8,
                marginTop: 6,
              }}
            >
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  style={{
                    textAlign: 'left',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 8,
                    border: template === t.id ? '2px solid #e11d48' : '1px solid #e5e5e5',
                    background: template === t.id ? '#fff1f2' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 13 }}>{t.label}</strong>
                  <span style={{ fontSize: 11, color: '#737373' }}>{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
          {error && <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}
          <button type="submit" className={platform.primaryBtn} disabled={creating || !name.trim()}>
            {creating ? 'Creando…' : 'Crear y abrir estudio 3D'}
          </button>
        </form>
      </section>

      <section className={platform.panel}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Mapas existentes</h2>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Capacidad</th>
              <th>Eventos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4}>Cargando…</td>
              </tr>
            )}
            {!loading && venues.length === 0 && (
              <tr>
                <td colSpan={4}>Aún no hay mapas. Crea el primero arriba.</td>
              </tr>
            )}
            {venues.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.name}</strong>
                  <br />
                  <small style={{ color: '#737373' }}>
                    {v.city ?? '—'} · {v.slug}
                  </small>
                </td>
                <td>{(v.totalCapacity ?? 0).toLocaleString()}</td>
                <td>{v._count?.events ?? 0}</td>
                <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Link href={`/venues/${v.id}/3d?studio=1`} className={platform.primaryBtn}>
                    Estudio 3D
                  </Link>
                  <Link href={`/venues/${v.id}/map`} className={platform.ghostBtn}>
                    Vista planta
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
