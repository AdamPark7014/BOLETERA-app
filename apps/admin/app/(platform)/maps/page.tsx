'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  KpiCard,
  PageHeader,
  Section,
  formatNumber,
  type DataTableColumn,
} from '@boletera/ui';
import { applyLayoutTemplate, createVenue, listVenues } from '@/lib/platform-api';
import styles from './maps.module.scss';

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

const FEATURES = [
  {
    title: 'Estudio 3D',
    description: 'Diseña asientos, zonas y circulación con vista inmersiva.',
  },
  {
    title: 'Planta 2D automática',
    description: 'La vista de planta se deriva del layout 3D y queda sincronizada.',
  },
  {
    title: 'Listo para eventos',
    description: 'El mapa del venue alimenta aforo, precios y venta en línea.',
  },
] as const;

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

  const stats = useMemo(() => {
    const totalCapacity = venues.reduce((sum, venue) => sum + (venue.totalCapacity ?? 0), 0);
    const totalEvents = venues.reduce((sum, venue) => sum + (venue._count?.events ?? 0), 0);
    const withLayout = venues.filter((venue) => (venue.layouts?.length ?? 0) > 0).length;
    return { total: venues.length, totalCapacity, totalEvents, withLayout };
  }, [venues]);

  const columns = useMemo<readonly DataTableColumn<VenueRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Venue',
        width: 260,
        sortValue: (row) => row.name,
        render: (row) => (
          <div className={styles.venueCell}>
            <strong>{row.name}</strong>
            <span className={styles.subtle}>
              {row.city ?? '—'} · {row.slug}
            </span>
          </div>
        ),
      },
      {
        key: 'capacity',
        header: 'Capacidad',
        width: 120,
        align: 'right',
        sortValue: (row) => row.totalCapacity ?? 0,
        render: (row) => (
          <span className={styles.numeric}>{formatNumber(row.totalCapacity ?? 0)}</span>
        ),
      },
      {
        key: 'events',
        header: 'Eventos',
        width: 110,
        align: 'right',
        sortValue: (row) => row._count?.events ?? 0,
        render: (row) => {
          const count = row._count?.events ?? 0;
          return (
            <Badge tone={count > 0 ? 'info' : 'neutral'} variant="soft" size="sm">
              {formatNumber(count)}
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        header: 'Acciones',
        width: 220,
        resizable: false,
        render: (row) => (
          <div className={styles.actions}>
            <Link href={`/venues/${row.id}/3d?studio=1`} className={styles.primaryLink}>
              Estudio 3D
            </Link>
            <Link href={`/venues/${row.id}/map`} className={styles.secondaryLink}>
              Vista planta
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Venues"
        title="Creador de mapas"
        description="Diseña en 3D desde cero. La planta 2D se deriva automáticamente y queda sincronizada con los eventos del venue."
      />

      <Section columns={4} gap="md" className={styles.kpiStrip}>
        <KpiCard label="Mapas" value={formatNumber(stats.total)} tone="accent" />
        <KpiCard label="Capacidad total" value={formatNumber(stats.totalCapacity)} />
        <KpiCard
          label="Eventos vinculados"
          value={formatNumber(stats.totalEvents)}
          tone={stats.totalEvents > 0 ? 'info' : 'neutral'}
        />
        <KpiCard
          label="Con layout activo"
          value={formatNumber(stats.withLayout)}
          hint="Venues con al menos un layout guardado"
        />
      </Section>

      <div className={styles.layout}>
        <section className={styles.createPanel} aria-labelledby="maps-create-title">
          <div>
            <h2 id="maps-create-title">Nuevo mapa</h2>
            <p className={styles.subtle}>
              Crea un venue y abre el estudio 3D con la plantilla que prefieras.
            </p>
          </div>

          <form className={styles.createForm} onSubmit={handleCreate}>
            <Input
              label="Nombre del venue"
              requiredMark
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Arena Norte, Teatro Principal…"
              autoComplete="off"
            />
            <Input
              label="Ciudad"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
            />
            <div className={styles.templateField}>
              <span className={styles.templateLabel}>Base inicial</span>
              <div className={styles.templateGrid} role="radiogroup" aria-label="Base inicial">
                {TEMPLATES.map((item) => {
                  const selected = template === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={selected ? `${styles.templateCard} ${styles.templateCardSelected}` : styles.templateCard}
                      onClick={() => setTemplate(item.id)}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error ? <p className={styles.errorBanner}>{error}</p> : null}

            <div className={styles.formActions}>
              <Button type="submit" loading={creating} loadingLabel="Creando…" disabled={!name.trim()}>
                Crear y abrir estudio 3D
              </Button>
            </div>
          </form>
        </section>

        <aside aria-label="Flujo del creador de mapas">
          <ul className={styles.featureList}>
            {FEATURES.map((feature, index) => (
              <li key={feature.title}>
                <span className={styles.featureIcon} aria-hidden="true">
                  {index + 1}
                </span>
                <div className={styles.featureCopy}>
                  <strong>{feature.title}</strong>
                  <span>{feature.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <Section
        title="Mapas existentes"
        description={
          loading
            ? 'Cargando venues…'
            : venues.length
              ? `${formatNumber(venues.length)} venue(s) con mapa disponible`
              : 'Aún no hay mapas creados'
        }
        className={styles.listPanel}
      >
        <DataTable
          label="Mapas existentes por venue"
          columns={columns}
          data={venues}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          defaultSort={{ key: 'name', direction: 'asc' }}
          empty={
            <EmptyState
              title="Aún no hay mapas"
              description="Crea el primero con el formulario de arriba. El estudio 3D se abrirá automáticamente al guardar."
            />
          }
        />
      </Section>
    </div>
  );
}
