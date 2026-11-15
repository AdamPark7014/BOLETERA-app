import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { StageArt } from '@boletera/ui';
import {
  advertisedPrice,
  availability,
  categoryLabel,
  dayMonth,
  longWhen,
  priceLabel,
} from '@/lib/event-display';
import { Countdown } from './Countdown';
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
          <p className={styles.heroLine}>Boletos oficiales con precio final desde la cartelera.</p>
        </div>
      </section>
    );
  }

  const img = event.bannerImage || event.image;
  const price = advertisedPrice(event);
  const stock = availability(event.offers);
  const place = [event.venue?.name, event.venue?.city].filter(Boolean).join(', ');

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
        <div className={styles.heroTags}>
          <span className={styles.tagGold}>
            {stock.soldOut
              ? 'AGOTADO'
              : stock.label.startsWith('Últimos')
                ? stock.label.toUpperCase()
                : 'VENTA ABIERTA'}
          </span>
          <span className={styles.tagLine}>{categoryLabel(event.category).toUpperCase()}</span>
        </div>
        <h1 className={styles.heroTitle} id="hero-title">
          {event.title}
        </h1>
        <p className={styles.heroLine}>
          {[place, longWhen(event.startsAt)].filter(Boolean).join(' · ')}
        </p>
        <div className={styles.heroActions}>
          <Link href={`/events/${event.slug}`} className={styles.primary}>
            {stock.soldOut
              ? 'Ver evento'
              : price > 0
                ? `Ver boletos desde ${priceLabel(price)}`
                : 'Ver boletos'}
          </Link>
          <a href="#cartelera" className={styles.secondary}>
            Ver cartelera
          </a>
        </div>
      </div>
      <div className={styles.heroCount}>
        <Countdown target={event.startsAt} label="LA FUNCIÓN EMPIEZA EN" />
      </div>
    </section>
  );
}

export function HomeHeroSkeleton() {
  return <section className={`${styles.hero} ${styles.skel}`} aria-hidden="true" />;
}

/* --------------------------------------------------------------- categorías */

const ICONS: Record<string, ReactNode> = {
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  palenque: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    </>
  ),
  sports: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l4.5 3.3-1.7 5.2H9.2L7.5 10.3z" />
    </>
  ),
  theater: (
    <>
      <path d="M4 4h16v8a8 8 0 01-16 0z" />
      <path d="M8.5 9h.01M15.5 9h.01M9 14c2 1.6 4 1.6 6 0" />
    </>
  ),
  festival: (
    <>
      <path d="M3 20L12 4l9 16z" />
      <path d="M12 4v16M8 20l4-7 4 7" />
    </>
  ),
  comedy: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14c2.2 2.4 5.8 2.4 8 0M9 9h.01M15 9h.01" />
    </>
  ),
  family: <path d="M12 21s-7-4.6-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.4-7 10-7 10z" />,
};

const PLANS = [
  { key: 'MUSIC', icon: 'music', label: 'Conciertos', href: '/categoria/MUSIC' },
  { key: 'PALENQUE', icon: 'palenque', label: 'Palenque', href: '/?q=palenque#cartelera' },
  { key: 'SPORTS', icon: 'sports', label: 'Deportes', href: '/categoria/SPORTS' },
  { key: 'THEATER', icon: 'theater', label: 'Teatro', href: '/categoria/THEATER' },
  { key: 'FESTIVAL', icon: 'festival', label: 'Festivales', href: '/categoria/FESTIVAL' },
  { key: 'COMEDY', icon: 'comedy', label: 'Comedia', href: '/categoria/COMEDY' },
  { key: 'FAMILY', icon: 'family', label: 'Familiares', href: '/categoria/FAMILY' },
];

export function CategoryPlans({ counts }: { counts: Record<string, number> }) {
  return (
    <section className={styles.section} aria-labelledby="planes-title">
      <h2 className={styles.h3} id="planes-title">
        Explora por plan
      </h2>
      <ul className={styles.plans}>
        {PLANS.map((plan) => {
          const n = counts[plan.key];
          return (
            <li key={plan.key}>
              <Link href={plan.href} className={styles.plan}>
                <svg
                  aria-hidden="true"
                  width="30"
                  height="30"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--gold)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICONS[plan.icon]}
                </svg>
                <span className={styles.planName}>{plan.label}</span>
                <span className={styles.planCount}>
                  {plan.key === 'PALENQUE'
                    ? 'Buscar funciones'
                    : n
                      ? `${n} ${n === 1 ? 'evento' : 'eventos'}`
                      : 'Próximamente'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* --------------------------------------------- ranking y bloque de membresía */

export function RankingAndMembership({ events }: { events: CardEvent[] }) {
  // El API no publica ventas: se ordena por menos boletos restantes (dato real).
  const ranked = events
    .map((event) => ({ event, stock: availability(event.offers) }))
    .filter((r) => !r.stock.soldOut && r.stock.remaining !== null)
    .sort((a, b) => (a.stock.remaining ?? 0) - (b.stock.remaining ?? 0))
    .slice(0, 5);

  return (
    <section className={`${styles.section} ${styles.split}`}>
      <div className={styles.rankCol}>
        <h2 className={styles.h3}>Quedan menos boletos</h2>
        {ranked.length === 0 ? (
          <p className={styles.empty}>Sin datos de disponibilidad por ahora.</p>
        ) : (
          <ol className={styles.rank}>
            {ranked.map(({ event, stock }, index) => {
              const img = event.image || event.bannerImage;
              const price = advertisedPrice(event);
              return (
                <li key={event.id}>
                  <Link href={`/events/${event.slug}`} className={styles.rankRow}>
                    <span className={styles.rankNum} data-first={index === 0 || undefined}>
                      {index + 1}
                    </span>
                    <span className={styles.rankThumb}>
                      {img ? (
                        <Image src={img} alt="" fill sizes="56px" className={styles.cardImg} />
                      ) : (
                        <StageArt seed={event.slug} fade={false} className={styles.cardImg} />
                      )}
                    </span>
                    <span className={styles.rankCopy}>
                      <strong>{event.title}</strong>
                      <span>
                        {[event.venue?.name, dayMonth(event.startsAt)].filter(Boolean).join(' · ')}
                        {stock.remaining !== null ? ` · quedan ${stock.remaining}` : ''}
                      </span>
                    </span>
                    {price > 0 ? (
                      <span className={styles.rankPrice}>{priceLabel(price)}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className={styles.member}>
        <StageArt seed="membresia-black" fade={false} className={styles.memberArt} />
        <span className={styles.memberShade} />
        <div className={styles.memberCopy}>
          <span className={styles.kicker}>Membresía Black</span>
          <span className={styles.memberTitle}>Hazte miembro</span>
          <span className={styles.memberText}>
            Planes con beneficios en preventas, accesos y eventos. Revisa qué incluye cada plan
            antes de pagar.
          </span>
          <Link href="/membresias" className={styles.white}>
            Conocer la membresía
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- garantías */

export function Guarantees() {
  const items = [
    {
      title: 'El precio que ves es el que pagas',
      body: 'Cargos e IVA incluidos desde la cartelera, no al final.',
      icon: (
        <>
          <path d="M4 7h16v10H4z" />
          <path d="M8 12h8" />
        </>
      ),
    },
    {
      title: 'Boleto que no se puede clonar',
      body: 'El QR cambia cada 15 segundos. Una captura no entra.',
      icon: (
        <>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <path d="M14 14h6v6h-6z" />
        </>
      ),
    },
    {
      title: '¿No puedes ir? Transfiere o revende',
      body: 'Reventa oficial dentro de Black Ticket, con boleto nuevo para quien compra.',
      icon: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
    },
  ];
  return (
    <section className={styles.guarantees} aria-label="Garantías">
      {items.map((item) => (
        <div key={item.title} className={styles.guarantee}>
          <span className={styles.guaranteeIcon}>
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {item.icon}
            </svg>
          </span>
          <span className={styles.guaranteeCopy}>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
