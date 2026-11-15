import Image from 'next/image';
import Link from 'next/link';
import { StageArt } from '@boletera/ui';
import {
  advertisedPrice,
  availability,
  priceLabel,
  shortWhen,
  type OfferLite,
} from '@/lib/event-display';
import styles from './home.module.scss';

export type CardEvent = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  category?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  minPrice: number | string;
  minPriceAllIn?: number;
  venue?: { name: string; city: string };
  offers?: OfferLite[];
};

/** Tarjeta de evento: imagen, nombre, fecha y precio. Toda la tarjeta es el enlace. */
export function EventCard({ event }: { event: CardEvent }) {
  const price = advertisedPrice(event);
  const stock = availability(event.offers);
  const img = event.image || event.bannerImage;
  const scarce = stock.soldOut
    ? 'Agotado'
    : stock.label.startsWith('Últimos')
      ? 'Últimos lugares'
      : null;

  return (
    <Link href={`/events/${event.slug}`} className={styles.card}>
      <span className={styles.cardMedia}>
        {img ? (
          <Image
            src={img}
            alt=""
            fill
            sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 420px"
            className={styles.cardImg}
          />
        ) : (
          <StageArt seed={event.slug} className={styles.cardImg} fade={false} />
        )}
        {scarce ? (
          <span className={styles.cardBadge} data-out={stock.soldOut || undefined}>
            {scarce}
          </span>
        ) : null}
      </span>
      <span className={styles.cardBody}>
        <span className={styles.cardTitle}>{event.title}</span>
        <span className={styles.cardMeta}>
          {shortWhen(event.startsAt)}
          {event.venue?.name ? ` · ${event.venue.name}` : ''}
        </span>
        {!stock.soldOut && price > 0 ? (
          <span className={styles.cardPrice}>Desde {priceLabel(price)}</span>
        ) : null}
      </span>
    </Link>
  );
}
