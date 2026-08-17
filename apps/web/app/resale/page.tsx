import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from './resale.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export const metadata: Metadata = {
  title: 'Reventa oficial | Boletera',
  description:
    'Boletos de reventa verificados, con tope de precio y código QR nuevo para el comprador.',
};

type Listing = {
  id: string;
  askingPrice: string | number;
  status: string;
  listedAt?: string;
  ticket?: {
    code?: string;
    section?: string | null;
    row?: string | null;
    seatNumber?: string | null;
    event?: {
      title?: string;
      slug?: string;
      startsAt?: string;
    };
  };
  priceComparison?: {
    originalPrice: number;
    resalePrice: number;
    markup: string;
  };
};

/** La API devuelve constantes en inglés; en pantalla van en español. */
const LISTING_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Disponible',
  PENDING: 'En revisión',
  SOLD: 'Vendido',
  CANCELLED: 'Retirado',
  EXPIRED: 'Vencido',
};

export default async function ResalePage() {
  let listings: Listing[] = [];
  let failed = false;
  try {
    const res = await fetch(`${API}/resale/listings?limit=40`, { cache: 'no-store' });
    if (!res.ok) throw new Error('resale');
    const data = await res.json();
    listings = Array.isArray(data) ? data : (data.listings ?? []);
  } catch {
    failed = true;
  }

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Mercado secundario</p>
          <h1>Reventa oficial</h1>
          <p className={styles.lead}>
            Boletos verificados con tope de precio. El comprador recibe un QR nuevo y el
            original se invalida.
          </p>
          <div className={styles.heroActions}>
            <Link href="/resale/vender" className={styles.primary}>
              Vender mi boleto
            </Link>
            <Link href="/cuenta" className={styles.ghost}>
              Mis boletos
            </Link>
          </div>
        </header>

        <ul className={styles.trust}>
          <li>
            <strong>Verificado</strong>
            <span>Solo boletos emitidos en BOLETERA</span>
          </li>
          <li>
            <strong>Precio controlado</strong>
            <span>Tope respecto al precio original del evento</span>
          </li>
          <li>
            <strong>QR seguro</strong>
            <span>Código nuevo al completar la compra</span>
          </li>
        </ul>

        <section aria-labelledby="resale-list-title">
          <div className={styles.sectionHead}>
            <h2 id="resale-list-title">Disponibles ahora</h2>
            {!failed && (
              <span>
                {listings.length} listado{listings.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {failed ? (
            <div className={styles.error} role="alert">
              <strong>No pudimos cargar los listados</strong>
              <p>
                Es un problema temporal. Vuelve a intentarlo en unos minutos; si querías
                publicar un boleto, puedes hacerlo de todos modos.
              </p>
              <Link href="/resale/vender">Vender mi boleto</Link>
            </div>
          ) : !listings.length ? (
            <div className={styles.empty}>
              <strong>Sin listados activos</strong>
              <p>
                Cuando alguien ponga un boleto en reventa aparecerá aquí con su precio y
                asiento.
              </p>
              <Link href="/">Explorar la cartelera</Link>
            </div>
          ) : (
            <ul className={styles.list}>
              {listings.map((l) => {
                const event = l.ticket?.event;
                const when = event?.startsAt ? new Date(event.startsAt) : null;
                const seat = [l.ticket?.section, l.ticket?.row, l.ticket?.seatNumber]
                  .filter(Boolean)
                  .join(' · ');
                const price = Number(l.askingPrice);
                const original = l.priceComparison?.originalPrice;
                const markup = Number(l.priceComparison?.markup ?? 0);

                return (
                  <li key={l.id} className={styles.card}>
                    <div>
                      <p className={styles.status}>
                        {LISTING_STATUS_LABEL[l.status] ?? l.status}
                      </p>
                      <h3>{event?.title || 'Evento'}</h3>
                      <p className={styles.meta}>
                        {when
                          ? when.toLocaleDateString('es-MX', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Fecha por confirmar'}
                        {seat ? ` · ${seat}` : ''}
                      </p>
                      {typeof original === 'number' && original > 0 && (
                        <p className={styles.compare}>
                          Precio original $
                          {original.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                          {Number.isFinite(markup) && (
                            <>
                              {' '}
                              · {markup > 0 ? `+${markup}%` : `${markup}%`} respecto al
                              original
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    <div className={styles.side}>
                      <strong>
                        ${price.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                        <span> MXN</span>
                      </strong>
                      {event?.slug ? (
                        <Link href={`/events/${event.slug}`}>Ver evento</Link>
                      ) : (
                        <span className={styles.id}>Listado #{l.id.slice(0, 8)}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
