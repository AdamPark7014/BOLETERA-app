import Image from 'next/image';
import Link from 'next/link';
import { StageArt } from '@boletera/ui';
import { advertisedPrice, availability, longWhen, priceLabel } from '@/lib/event-display';
import type { CardEvent } from './EventCard';
import styles from './home.module.scss';

/* ------------------------------------------------------------------ portada */

export function HomeHero({ event }: { event: CardEvent | null }) {
  if (!event) {
    return (
      <section className={styles.hero} aria-label="Black Ticket">
        <span className={styles.heroMedia}>
          <StageArt seed="black-ticket-home" fade={false} className={styles.heroImg} />
        </span>
        <span className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle}>Black Ticket</h1>
        </div>
      </section>
    );
  }

  const img = event.bannerImage || event.image;
  const price = advertisedPrice(event);
  const stock = availability(event.offers);
  const place = [event.venue?.name, event.venue?.city].filter(Boolean).join(', ');
  const scarce = stock.soldOut
    ? 'Agotado'
    : stock.label.startsWith('Últimos')
      ? 'Últimos lugares'
      : null;

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <span className={styles.heroMedia}>
        {img ? (
          <Image
            src={img}
            alt=""
            fill
            priority
            fetchPriority="high"
            sizes="(max-width: 720px) 100vw, 1330px"
            className={styles.heroImg}
          />
        ) : (
          <StageArt seed={event.slug} fade={false} className={styles.heroImg} />
        )}
      </span>
      <span className={styles.heroShade} />
      <div className={styles.heroCopy}>
        {scarce ? <span className={styles.badge}>{scarce}</span> : null}
        <h1 className={styles.heroTitle} id="hero-title">
          {event.title}
        </h1>
        <p className={styles.heroLine}>
          {longWhen(event.startsAt)}
          {place ? <span> · {place}</span> : null}
        </p>
        <Link href={`/events/${event.slug}`} className={styles.primary}>
          {stock.soldOut
            ? 'Ver evento'
            : price > 0
              ? `Boletos desde ${priceLabel(price)}`
              : 'Ver boletos'}
        </Link>
      </div>
    </section>
  );
}

export function HomeHeroSkeleton() {
  return <section className={`${styles.hero} ${styles.skel}`} aria-hidden="true" />;
}

/* --------------------------------------------------------------- membresía */

export function MembershipBand() {
  return (
    <section className={styles.member} aria-labelledby="membresia-title">
      <StageArt seed="membresia-black" fade={false} className={styles.memberArt} />
      <span className={styles.memberShade} />
      <div className={styles.memberCopy}>
        <h2 className={styles.memberTitle} id="membresia-title">
          Membresía Black
        </h2>
        <p className={styles.memberText}>Preventas y beneficios en tus eventos favoritos.</p>
        <Link href="/membresias" className={styles.secondary}>
          Ver planes
        </Link>
      </div>
    </section>
  );
}
