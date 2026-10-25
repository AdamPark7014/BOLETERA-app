'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, readNumber, readString } from '../events/_ticket/read';

type Venue = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  totalCapacity: number | null;
  accessibilitySeats: number | null;
  premiumSeats: number | null;
  generalSeats: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  image: string | null;
};

function readVenue(raw: unknown): Venue | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    slug: readString(row.slug),
    description: readString(row.description),
    address: readString(row.address),
    city: readString(row.city),
    state: readString(row.state),
    country: readString(row.country),
    postalCode: readString(row.postalCode),
    latitude: readNumber(row.latitude),
    longitude: readNumber(row.longitude),
    timezone: readString(row.timezone),
    totalCapacity: readNumber(row.totalCapacity),
    accessibilitySeats: readNumber(row.accessibilitySeats),
    premiumSeats: readNumber(row.premiumSeats),
    generalSeats: readNumber(row.generalSeats),
    phone: readString(row.phone),
    email: readString(row.email),
    website: readString(row.website),
    image: readString(row.image),
  };
}

function text(value: string | null): string {
  return value ?? '—';
}

function figure(value: number | null): string {
  return formatCount(value);
}

function coord(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('es-MX', { maximumFractionDigits: 6 });
}

export default function VenuesPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <RecintoBody />
      </AdminFrame>
    </Suspense>
  );
}

function RecintoBody() {
  const session = useSession();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'venues.view');

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>('/admin/venues', token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const venue = readVenue(item);
          return venue ? [venue] : [];
        });
        setVenues(next);
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Recinto</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir recintos" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando recintos.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Recinto</h1>
        <p className={styles.quiet}>
          Lo que el listado ya devuelve. Esta ruta no lo modifica y no trae blackouts.
        </p>
      </header>
      {venues.length === 0 ? <p className={styles.quiet}>No hay recintos.</p> : null}
      <div className={styles.stack}>
        {venues.map((venue) => {
          const open = openId === venue.id;
          return (
            <div key={venue.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : venue.id)}
              >
                <span>{venue.name}</span>
                <span className={styles.figure}>{figure(venue.totalCapacity)}</span>
              </button>
              {open ? <VenueCards venue={venue} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function VenueCards({ venue }: { venue: Venue }) {
  const cards: { name: string; value: string; style?: 'tabular' | 'mono'; effect: string }[] = [
    { name: 'Nombre del recinto', value: venue.name, effect: 'Nombre de la sala. Esta ruta no lo guarda.' },
    { name: 'Slug del recinto', value: text(venue.slug), style: 'mono', effect: 'Quedó al crear. Aquí se lee.' },
    { name: 'Descripción del recinto', value: text(venue.description), effect: 'Texto corto guardado.' },
    { name: 'Dirección', value: text(venue.address), effect: 'Calle y número.' },
    { name: 'Ciudad del recinto', value: text(venue.city), effect: 'Ciudad de la sala.' },
    { name: 'Estado del recinto', value: text(venue.state), effect: 'Entidad.' },
    { name: 'País del recinto', value: text(venue.country), effect: 'País.' },
    { name: 'Código postal del recinto', value: text(venue.postalCode), effect: 'CP.' },
    { name: 'Latitud', value: coord(venue.latitude), style: 'tabular', effect: 'Coordenada guardada.' },
    { name: 'Longitud', value: coord(venue.longitude), style: 'tabular', effect: 'Par de la latitud.' },
    { name: 'Zona horaria del recinto', value: text(venue.timezone), effect: 'Horas de la sala.' },
    { name: 'Aforo total', value: figure(venue.totalCapacity), style: 'tabular', effect: 'Cupo del recinto.' },
    { name: 'Butacas accesibles', value: figure(venue.accessibilitySeats), style: 'tabular', effect: 'Cupo accesible declarado.' },
    { name: 'Butacas premium', value: figure(venue.premiumSeats), style: 'tabular', effect: 'Cupo premium declarado.' },
    { name: 'Butacas generales', value: figure(venue.generalSeats), style: 'tabular', effect: 'Cupo general declarado.' },
    { name: 'Teléfono del recinto', value: text(venue.phone), effect: 'Contacto.' },
    { name: 'Correo del recinto', value: text(venue.email), effect: 'Contacto.' },
    { name: 'Sitio del recinto', value: text(venue.website), effect: 'Web.' },
    { name: 'Imagen del recinto', value: venue.image ?? 'Sin imagen', effect: 'Dirección de la foto, si hay.' },
  ];

  return (
    <div className={styles.stack}>
      {cards.map((card) => (
        <Param key={card.name} name={card.name}>
          <ParameterCard
            name={card.name}
            value={card.value}
            valueStyle={card.style}
            effect={card.effect}
          />
        </Param>
      ))}
    </div>
  );
}
