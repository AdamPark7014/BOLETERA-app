import Image from 'next/image';
import Link from 'next/link';
import { StageArt } from '@boletera/ui';
import {
  advertisedPrice,
  dateBlock,
  eventStatusLabel,
  priceLabel,
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

/** Tarjeta única de cartelera: póster 3:4, fecha en bloque, título a 2 líneas. */
export function EventCard({ event }: { event: CardEvent }) {
  const price = advertisedPrice(event);
  const status = eventStatusLabel(event.offers);
  const img = event.image || event.bannerImage;
  const when = dateBlock(event.startsAt);
  const place = [event.venue?.name, event.venue?.city].filter(Boolean).join(' · ');

  return (
    <Link href={`/events/${event.slug}`} className={styles.card}>
      <span className={styles.cardMedia}>
        {img ? (
          <Image
            src={img}
            alt=""
            fill
            sizes="(max-width: 720px) 70vw, 280px"
            className={styles.cardImg}
          />
        ) : (
          <StageArt seed={event.slug} className={styles.cardImg} fade={false} />
        )}
        <time className={styles.cardDate} dateTime={event.startsAt}>
          <span className={styles.cardDay}>{when.day}</span>
          <span className={styles.cardMonth}>{when.month}</span>
        </time>
        {status.label ? (
          <span
            className={styles.cardBadge}
            data-kind={status.kind || undefined}
            data-out={status.kind === 'soldout' || undefined}
          >
            {status.label}
          </span>
        ) : null}
      </span>
      <span className={styles.cardBody}>
        <span className={styles.cardTitle}>{event.title}</span>
        {place ? <span className={styles.cardMeta}>{place}</span> : null}
        {status.kind !== 'soldout' && price > 0 ? (
          <span className={styles.cardPrice}>desde {priceLabel(price)}</span>
        ) : null}
      </span>
    </Link>
  );
}
