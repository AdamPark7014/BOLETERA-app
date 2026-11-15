'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { StageArt } from '@boletera/ui';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { Countdown } from '@/components/home/Countdown';
import { availability, categoryLabel, longWhen, priceLabel, shortWhen } from '@/lib/event-display';
import { EventPurchaseClient } from './EventPurchaseClient';
import styles from './event.module.scss';

type Offer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string;
  allInPrice?: number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

export function EventStage({
  eventId,
  slug,
  title,
  description,
  startsAt,
  doorsAt,
  salesStartAt,
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
  venueSlug,
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
  doorsAt?: string | null;
  salesStartAt?: string | null;
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
  venueSlug?: string | null;
  minPrice: number;
  minPriceAllIn?: number;
  currency: string;
  focusZone: string | null;
  mapData: unknown;
}) {
  const [stage, setStage] = useState<'ficha' | 'zona'>('ficha');
  const place = [venueName, venueCity].filter(Boolean).join(', ');
  const announced = minPriceAllIn && minPriceAllIn > 0 ? minPriceAllIn : minPrice;
  const hasOffer = offers.length > 0;
  const minutes = Math.round((holdExpiration ?? 900) / 60);
  const stock = availability(offers);
  const doors = doorsAt
    ? new Date(doorsAt).toLocaleTimeString('es-MX', {
        timeZone: 'America/Mexico_City',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;
  const salesSoon =
    salesStartAt && new Date(salesStartAt).getTime() > Date.now() ? salesStartAt : null;
  const hero = bannerImage || image;
  const poster = image || bannerImage;

  if (stage === 'zona') {
    return (
      <div className={styles.buy}>
        <div className={styles.topbar}>
          <div className={styles.topInner}>
            <button
              type="button"
              className={styles.back}
              aria-label="Volver a la ficha del evento"
              onClick={() => setStage('ficha')}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <span className={styles.topThumb}>
              {poster ? (
                <Image src={poster} alt="" fill sizes="52px" className={styles.cover} />
              ) : (
                <StageArt seed={slug} fade={false} className={styles.cover} />
              )}
            </span>
            <div className={styles.topCopy}>
              <h1 className={styles.topTitle}>{title}</h1>
              <span className={styles.topMeta}>
                {longWhen(startsAt)}
                {place ? ` · ${place}` : ''}
                {doors ? ` · Puertas ${doors}` : ''}
              </span>
            </div>
            <span className={styles.holdPill}>
              <span className={styles.dot} aria-hidden="true" />
              Apartado al continuar
              <strong>{minutes} min</strong>
            </span>
          </div>
        </div>
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
          image={poster}
          allowResale={allowResale}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="evento-title">
        <span className={styles.heroMedia}>
          {hero ? (
            <Image
              src={hero}
              alt=""
              fill
              priority
              fetchPriority="high"
              sizes="(max-width: 720px) 100vw, 1330px"
              className={styles.cover}
            />
          ) : (
            <StageArt seed={slug} fade={false} className={styles.cover} />
          )}
        </span>
        <span className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <div className={styles.tags}>
            <span className={styles.tagGold}>
              {stock.soldOut ? 'AGOTADO' : salesSoon ? 'PRÓXIMAMENTE' : 'VENTA ABIERTA'}
            </span>
            <span className={styles.tagLine}>{categoryLabel(category).toUpperCase()}</span>
            {stock.label.startsWith('Últimos') ? (
              <span className={styles.tagLine}>{stock.label.toUpperCase()}</span>
            ) : null}
          </div>
          <h1 className={styles.heroTitle} id="evento-title">
            {title}
          </h1>
          <p className={styles.heroLine}>
            {[longWhen(startsAt), place].filter(Boolean).join(' · ')}
            {doors ? ` · Puertas ${doors}` : ''}
          </p>
          <div className={styles.heroActions}>
            {hasOffer && !stock.soldOut ? (
              <button type="button" className={styles.primary} onClick={() => setStage('zona')}>
                {announced > 0 ? `Ver boletos desde ${priceLabel(announced)}` : 'Elegir boletos'}
              </button>
            ) : null}
            {allowResale !== false ? (
              <Link href="/resale" className={styles.secondary}>
                Reventa oficial
              </Link>
            ) : null}
          </div>
        </div>
        {salesSoon ? (
          <div className={styles.heroCount}>
            <Countdown target={salesSoon} label="VENTA GENERAL EN" />
          </div>
        ) : null}
      </section>

      <div className={styles.fichaGrid}>
        <div className={styles.fichaMain}>
          {!hasOffer || stock.soldOut ? (
            <section className={styles.panel}>
              <h2 className={styles.h2}>{stock.soldOut ? 'Agotado' : 'Aún no hay boletos'}</h2>
              <p className={styles.muted}>
                Déjanos tu correo y te avisamos si se liberan lugares o abre una nueva fase.
              </p>
              <WaitlistSignup eventId={eventId} eventTitle={title} />
            </section>
          ) : (
            <section className={styles.panel} aria-labelledby="zonas-title">
              <div className={styles.panelHead}>
                <h2 className={styles.h2} id="zonas-title">
                  Zonas y precios
                </h2>
                <span className={styles.muted}>Precio final por boleto</span>
              </div>
              <ul className={styles.zoneList}>
                {offers.map((offer) => {
                  const price = Number(offer.allInPrice ?? offer.basePrice);
                  const out = offer.isAvailable === false || offer.remainingQuantity === 0;
                  return (
                    <li key={offer.id}>
                      <button
                        type="button"
                        className={styles.zoneRow}
                        disabled={out}
                        onClick={() => setStage('zona')}
                      >
                        <span className={styles.zoneName}>{offer.name || offer.zone}</span>
                        <span className={styles.zoneLeft}>
                          {out
                            ? 'Agotada'
                            : offer.remainingQuantity != null
                              ? `${offer.remainingQuantity} disponibles`
                              : ''}
                        </span>
                        <span className={styles.zonePrice}>{priceLabel(price)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className={styles.primaryWide} onClick={() => setStage('zona')}>
                Elegir boletos
              </button>
            </section>
          )}

          {description ? (
            <section className={styles.panel}>
              <h2 className={styles.h2}>Acerca del evento</h2>
              <p className={styles.body}>{description}</p>
              {genre || rating ? (
                <p className={styles.muted}>
                  {[genre ? `Género: ${genre}` : null, rating ? `Clasificación: ${rating}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className={styles.fichaSide}>
          <div className={styles.poster}>
            {poster ? (
              <Image
                src={poster}
                alt={`Póster de ${title}`}
                fill
                priority
                sizes="(max-width: 720px) 100vw, 420px"
                className={styles.cover}
              />
            ) : (
              <StageArt seed={slug} className={styles.cover} />
            )}
          </div>
          <section className={styles.panel}>
            <span className={styles.kicker}>Recinto</span>
            <strong className={styles.venueName}>{venueName ?? 'Por confirmar'}</strong>
            {venueAddress || venueCity ? (
              <span className={styles.muted}>
                {[venueAddress, venueCity].filter(Boolean).join(', ')}
              </span>
            ) : null}
            <span className={styles.muted}>{shortWhen(startsAt)}</span>
            {venueSlug ? (
              <Link href={`/venues/${venueSlug}`} className={styles.textLink}>
                Ver recinto y su cartelera
              </Link>
            ) : null}
          </section>
          <ul className={styles.conds} aria-label="Condiciones del boleto">
            <li>{refundable === false ? 'No reembolsable' : 'Reembolsable'}</li>
            <li>
              {nonTransferable || transferAllowed === false ? 'No transferible' : 'Transferible'}
            </li>
            <li>{allowResale === false ? 'Sin reventa' : 'Reventa oficial'}</li>
            <li>Apartado de {minutes} min</li>
            <li>Cargos e IVA incluidos</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
