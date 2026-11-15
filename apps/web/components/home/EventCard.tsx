import Image from 'next/image';
import Link from 'next/link';
import { StageArt } from '@boletera/ui';
import {
  advertisedPrice,
  availability,
  categoryLabel,
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

/** Tarjeta grande de la maqueta: toda la tarjeta es el enlace al evento. */
export function EventCard({ event }: { event: CardEvent }) {
  const price = advertisedPrice(event);
  const stock = availability(event.offers);
  const img = event.image || event.bannerImage;
  const place = [event.venue?.name, event.venue?.city].filter(Boolean).join(', ');

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
        <span className={styles.cardShade} />
        <span className={styles.cardTag}>{categoryLabel(event.category)}</span>
        <span className={styles.cardTitle}>{event.title}</span>
      </span>
      <span className={styles.cardBody}>
        <span className={styles.cardWhen}>{shortWhen(event.startsAt)}</span>
        {place ? <span className={styles.cardPlace}>{place}</span> : null}
        <span className={styles.cardFoot}>
          {stock.soldOut ? (
            <span className={styles.cardSoldOut}>Agotado</span>
          ) : price > 0 ? (
            <span className={styles.cardPrice}>
              <small>Desde</small>
              {priceLabel(price)}
            </span>
          ) : (
            <span className={styles.cardPrice}>
              <small>Precio por anunciar</small>
            </span>
          )}
          {stock.label && !stock.soldOut ? (
            <span className={styles.cardStock} data-low={stock.label !== 'Disponible' || undefined}>
              {stock.label}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}
