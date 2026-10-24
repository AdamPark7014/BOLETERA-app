'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TicketButton, formatTicketAmount } from '@boletera/ui';
import { EventPosterArt } from '@/components/EventPosterArt';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { EventPurchaseClient } from './EventPurchaseClient';
import styles from '@/components/purchase/purchase.module.scss';

type Offer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string;
  remainingQuantity?: number;
};

export function EventStage({
  eventId,
  slug,
  title,
  description,
  startsAt,
  genre,
  rating,
  image,
  bannerImage,
  category,
  allowResale,
  transferAllowed,
  refundable,
  nonTransferable,
  holdExpiration,
  offers,
  venueName,
  venueCity,
  venueAddress,
  minPrice,
  minPriceAllIn,
  currency,
  focusZone,
  mapData,
}: {
  eventId: string;
  slug: string;
  title: string;
  description: string | null;
  startsAt: string;
  genre?: string | null;
  rating?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  category?: string | null;
  allowResale?: boolean;
  transferAllowed?: boolean;
  refundable?: boolean;
  nonTransferable?: boolean;
  holdExpiration?: number;
  offers: Offer[];
  venueName?: string;
  venueCity?: string;
  venueAddress?: string | null;
  minPrice: number;
  minPriceAllIn?: number;
  currency: string;
  focusZone: string | null;
  mapData: unknown;
}) {
  const [stage, setStage] = useState<'ficha' | 'zona'>('ficha');
  const when = new Date(startsAt);
  const dateLabel = when.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeLabel = when.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const place = [venueName, venueCity].filter(Boolean).join(' · ');
  const announced = minPriceAllIn && minPriceAllIn > 0 ? minPriceAllIn : minPrice;
  const hasOffer = offers.length > 0;
  const minutes = Math.round((holdExpiration ?? 900) / 60);

  if (stage === 'zona') {
    return (
      <div className={styles.column}>
        <TicketButton type="button" variant="secondary" onClick={() => setStage('ficha')}>
          Atrás
        </TicketButton>
        <h1 className={styles.title}>{title}</h1>
        <EventPurchaseClient
          eventId={eventId}
          eventTitle={title}
          slug={slug}
          startsAt={startsAt}
          venueName={venueName}
          venueCity={venueCity}
          mapData={mapData}
          offers={offers}
          minPrice={minPrice}
          minPriceAllIn={minPriceAllIn}
          currency={currency}
          focusZone={focusZone}
        />
      </div>
    );
  }

  return (
    <div className={styles.column}>
      <div className={styles.stack}>
        <h1 className={styles.display}>{title}</h1>
        <p className={styles.meta}>
          {dateLabel} · {timeLabel}
          {place ? ` · ${place}` : ''}
        </p>
      </div>

      <div className={styles.poster}>
        <EventPosterArt
          event={{
            id: eventId,
            slug,
            title,
            category,
            image,
            bannerImage,
            startsAt,
          }}
          size="lg"
        />
      </div>

      {announced > 0 ? (
        <p className={styles.lead}>Desde {formatTicketAmount(announced)} · cargos incluidos</p>
      ) : null}

      {description ? <p className={styles.lead}>{description}</p> : null}

      <div className={styles.chips}>
        <span className={styles.chip}>{refundable === false ? 'No reembolsable' : 'Reembolsable'}</span>
        <span className={styles.chip}>
          {nonTransferable || transferAllowed === false ? 'No transferible' : 'Transferible'}
        </span>
        <span className={styles.chip}>{allowResale === false ? 'Sin reventa' : 'Reventa oficial'}</span>
        <span className={styles.chip}>Apartado · {minutes} min</span>
      </div>

      <details className={styles.disclose}>
        <summary>Ver condiciones</summary>
        {rating ? <p>Clasificación · {rating}</p> : null}
        {genre ? <p>Género · {genre}</p> : null}
        {venueAddress ? <p>{[venueName, venueAddress, venueCity].filter(Boolean).join(' · ')}</p> : null}
      </details>

      {hasOffer ? (
        <TicketButton type="button" onClick={() => setStage('zona')}>
          Elegir boletos
        </TicketButton>
      ) : (
        <WaitlistSignup eventId={eventId} eventTitle={title} />
      )}

      <Link href="/" className={styles.link}>
        Atrás
      </Link>
    </div>
  );
}
