'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { StageArt, formatTime } from '@boletera/ui';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { SeatMapViewer } from '@/components/SeatMapViewer';
import { Countdown } from '@/components/home/Countdown';
import { availability, longWhen, priceLabel } from '@/lib/event-display';
import { EventPurchaseClient } from './EventPurchaseClient';
import { sortOffersForDisplay } from '@/lib/offer-order';
import { offerTones } from '@/lib/zone-tones';
import styles from './event.module.scss';
import ficha from './event-ficha.module.scss';

type Offer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string;
  allInPrice?: number;
  remainingQuantity?: number;
  isAvailable?: boolean;
  sortOrder?: number | null;
};

function zonePrice(offer: Offer): number {
  const value = Number(offer.allInPrice ?? offer.basePrice);
  return Number.isFinite(value) ? value : 0;
}

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
  allowResale,
  transferAllowed,
  refundable,
  nonTransferable,
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
  const orderedOffers = sortOffersForDisplay(offers);
  const tones = offerTones(orderedOffers);
  const [stage, setStage] = useState<'ficha' | 'zona'>('ficha');
  const place = [venueName, venueCity].filter(Boolean).join(', ');
  const announced = minPriceAllIn && minPriceAllIn > 0 ? minPriceAllIn : minPrice;
  const hasOffer = offers.length > 0;
  const stock = availability(orderedOffers);
  const doors = doorsAt ? formatTime(doorsAt) : null;
  const salesSoon =
    salesStartAt && new Date(salesStartAt).getTime() > Date.now() ? salesStartAt : null;
  const hero = bannerImage || image;
  const poster = image || bannerImage;
  const about = description?.trim() || '';
  const canBuy = hasOffer && !stock.soldOut;

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
          offers={orderedOffers}
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
          {stock.soldOut || stock.label.startsWith('Últimos') ? (
            <span className={styles.badge}>{stock.soldOut ? 'Agotado' : 'Últimos lugares'}</span>
          ) : null}
          <h1 className={styles.heroTitle} id="evento-title">
            {title}
          </h1>
          <p className={styles.heroLine}>
            {[longWhen(startsAt), place].filter(Boolean).join(' · ')}
            {doors ? ` · Puertas ${doors}` : ''}
          </p>
          {canBuy ? (
            <div className={styles.heroActions}>
              <button type="button" className={styles.primary} onClick={() => setStage('zona')}>
                Comprar boletos
              </button>
              {announced > 0 ? (
                <span className={styles.heroFrom}>desde {priceLabel(announced)}</span>
              ) : null}
            </div>
          ) : null}
          <div className={styles.heroLinks}>
            <a
              className={styles.textLink}
              href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${new Date(
                startsAt
              )
                .toISOString()
                .replace(/[-:]/g, '')
                .replace(/\.\d{3}/, '')}/${new Date(new Date(startsAt).getTime() + 3 * 3600_000)
                .toISOString()
                .replace(/[-:]/g, '')
                .replace(
                  /\.\d{3}/,
                  ''
                )}&details=${encodeURIComponent(about || title)}&location=${encodeURIComponent([venueName, venueAddress, venueCity].filter(Boolean).join(', '))}`}
              target="_blank"
              rel="noreferrer"
            >
              Agregar al calendario
            </a>
            {venueAddress || venueCity ? (
              <a
                className={styles.textLink}
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venueAddress, venueName, venueCity].filter(Boolean).join(', '))}`}
                target="_blank"
                rel="noreferrer"
              >
                Cómo llegar
              </a>
            ) : null}
          </div>
        </div>
        {salesSoon ? (
          <div className={styles.heroCount}>
            <Countdown target={salesSoon} label="La venta abre en" />
          </div>
        ) : null}
      </section>

      <div className={`${styles.fichaGrid}${canBuy ? ` ${ficha.fichaWithDock}` : ''}`}>
        <div className={styles.fichaMain}>
          {!hasOffer || stock.soldOut ? (
            <section className={styles.panel}>
              <h2 className={styles.h2}>{stock.soldOut ? 'Agotado' : 'Pronto a la venta'}</h2>
              <p className={styles.muted}>
                {stock.soldOut
                  ? 'Si se libera un boleto al precio original, te avisamos con un enlace de 60 minutos.'
                  : 'Te avisamos si se liberan lugares.'}
              </p>
              <WaitlistSignup eventId={eventId} eventTitle={title} />
            </section>
          ) : (
            <section className={styles.panel} aria-labelledby="zonas-title">
              <h2 className={styles.h2} id="zonas-title">
                Zonas
              </h2>
              {mapData ? (
                <div className={ficha.mapPreview} aria-label="Mapa del recinto">
                  <p className={ficha.mapPreviewLabel}>Mapa del recinto</p>
                  <div className={ficha.mapPreviewFrame}>
                    <SeatMapViewer
                      eventId={eventId}
                      mapData={mapData}
                      selected={[]}
                      onToggle={() => setStage('zona')}
                      offers={orderedOffers}
                      currency={currency}
                      compact
                    />
                  </div>
                </div>
              ) : null}
              <ul className={ficha.zoneCards}>
                {orderedOffers.map((offer) => {
                  const price = zonePrice(offer);
                  const out = offer.isAvailable === false || offer.remainingQuantity === 0;
                  const few =
                    !out && offer.remainingQuantity != null && offer.remainingQuantity <= 20;
                  const status = out ? 'Agotada: lista de espera' : few ? 'Últimos lugares' : null;
                  return (
                    <li key={offer.id}>
                      <button
                        type="button"
                        className={ficha.zoneCard}
                        disabled={out}
                        onClick={() => setStage('zona')}
                      >
                        <i
                          className={ficha.zoneSwatch}
                          style={{ background: tones.get(offer.id) }}
                          aria-hidden="true"
                        />
                        <span className={ficha.zoneCardCopy}>
                          <strong className={ficha.zoneName}>{offer.name || offer.zone}</strong>
                          {status ? <span className={ficha.zoneLeft}>{status}</span> : null}
                        </span>
                        <span className={ficha.zonePrice}>{priceLabel(price)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {about ? (
            <section className={styles.panel} aria-labelledby="acerca-title">
              <h2 className={styles.h2} id="acerca-title">
                Acerca del evento
              </h2>
              <p className={ficha.aboutBody}>{about}</p>
              <dl className={ficha.aboutMeta}>
                <div>
                  <dt>Inicio</dt>
                  <dd>{longWhen(startsAt)}</dd>
                </div>
                {doors ? (
                  <div>
                    <dt>Puertas</dt>
                    <dd>{doors}</dd>
                  </div>
                ) : null}
                {rating ? (
                  <div>
                    <dt>Clasificación</dt>
                    <dd>{rating}</dd>
                  </div>
                ) : null}
                {genre ? (
                  <div>
                    <dt>Género</dt>
                    <dd>{genre}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Accesibilidad</dt>
                  <dd>Consulta lugares accesibles al elegir asiento en el mapa.</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>

        <aside className={styles.fichaSide}>
          {poster && poster !== hero ? (
            <div className={styles.poster}>
              <Image
                src={poster}
                alt={`Póster de ${title}`}
                fill
                sizes="(max-width: 720px) 100vw, 420px"
                className={styles.cover}
              />
            </div>
          ) : null}
          <section className={styles.venue}>
            <strong className={styles.venueName}>{venueName ?? 'Recinto por confirmar'}</strong>
            {venueAddress || venueCity ? (
              <span className={styles.muted}>
                {[venueAddress, venueCity].filter(Boolean).join(', ')}
              </span>
            ) : null}
            {venueSlug ? (
              <Link href={`/venues/${venueSlug}`} className={styles.textLink}>
                Ver recinto
              </Link>
            ) : null}
            <details className={styles.policyAccord}>
              <summary>Políticas del evento</summary>
              <ul>
                <li>
                  {refundable === false
                    ? 'No reembolsable salvo cancelación del organizador.'
                    : 'Reembolsable según la política publicada.'}{' '}
                  <Link href="/terminos#reembolsos" className={styles.policyLink}>
                    Ver detalle
                  </Link>
                </li>
                <li>
                  {nonTransferable || transferAllowed === false
                    ? 'Este boleto no se puede transferir.'
                    : 'Puedes transferir el boleto a otra persona desde tu cuenta.'}
                </li>
                <li>
                  {allowResale === false
                    ? 'Sin reventa oficial para este evento.'
                    : 'Reventa oficial disponible con QR nuevo para el comprador.'}
                </li>
              </ul>
            </details>
          </section>
        </aside>
      </div>

      {canBuy ? (
        <div className={ficha.fichaDock}>
          <div className={ficha.fichaDockInner}>
            {announced > 0 ? (
              <span className={ficha.fichaDockFrom}>desde {priceLabel(announced)}</span>
            ) : (
              <span className={ficha.fichaDockFrom}>Elige tu zona</span>
            )}
            <button type="button" className={styles.primary} onClick={() => setStage('zona')}>
              Continuar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
