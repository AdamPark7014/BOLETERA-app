import { PageTitle, TicketState, formatEventDateTime, formatPrice } from '@boletera/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from './resale.module.scss';
import { BuyResaleButton } from './BuyResaleButton';

import { API_BASE as API } from '@/lib/api';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  return {
    title: `Reventa oficial | ${tenant.name}`,
    description:
      'Boletos de reventa verificados, con tope de precio y código QR nuevo para el comprador.',
  };
}

type Listing = {
  id: string;
  askingPrice: string | number;
  fee?: string | number;
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
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <PageTitle
          title="Reventa oficial"
          actions={
            <div className={styles.heroActions}>
              <Link href="/resale/vender" className={styles.ghost}>
                Vender mi boleto
              </Link>
              <Link href="/cuenta" className={styles.ghost}>
                Mis boletos
              </Link>
            </div>
          }
        />

        <section aria-labelledby="resale-list-title">
          <div className={styles.sectionHead}>
            <h2 id="resale-list-title">Disponibles ahora</h2>
          </div>

          {failed ? (
            <TicketState
              kind="error"
              title="No pudimos cargar los listados"
              body="Intenta de nuevo en unos minutos."
              action={
                <Link href="/resale/vender" className="bt-action">
                  Vender mi boleto
                </Link>
              }
            />
          ) : !listings.length ? (
            <TicketState
              kind="empty"
              title="Sin listados activos"
              body="Cuando alguien ponga un boleto en reventa aparecerá aquí con su precio y asiento."
              action={
                <Link href="/" className="bt-action">
                  Explorar la cartelera
                </Link>
              }
            />
          ) : (
            <ul className={styles.list}>
              {listings.map((l) => {
                const event = l.ticket?.event;
                const when = event?.startsAt ? new Date(event.startsAt) : null;
                const seat = [l.ticket?.section, l.ticket?.row, l.ticket?.seatNumber]
                  .filter(Boolean)
                  .join(' · ');
                // Precio final desde la lista: lo que se pide más el cargo por servicio.
                const price = Number(l.askingPrice) + (Number(l.fee) || 0);
                const original = l.priceComparison?.originalPrice;
                const markup = Number(l.priceComparison?.markup ?? 0);

                return (
                  <li key={l.id} className={styles.card}>
                    <div>
                      {l.status !== 'ACTIVE' ? (
                        <p className={styles.status}>
                          {LISTING_STATUS_LABEL[l.status] ?? l.status}
                        </p>
                      ) : null}
                      <h3>{event?.title || 'Evento'}</h3>
                      <p className={styles.meta}>
                        {when ? formatEventDateTime(when) : 'Fecha por confirmar'}
                        {seat ? ` · ${seat}` : ''}
                      </p>
                      {typeof original === 'number' && original > 0 && (
                        <p className={styles.compare}>
                          Precio original {formatPrice(original)}
                          {Number.isFinite(markup) && (
                            <> · {markup > 0 ? `+${markup}%` : `${markup}%`} respecto al original</>
                          )}
                        </p>
                      )}
                    </div>
                    <div className={styles.side}>
                      <strong>{formatPrice(price)}</strong>
                      {l.status === 'ACTIVE' ? (
                        <BuyResaleButton listingId={l.id} label="Comprar" />
                      ) : null}
                      {event?.slug ? (
                        <Link href={`/events/${event.slug}`} className={styles.eventLink}>
                          Ver evento
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
