import type { CSSProperties } from 'react';
import styles from './EventPosterArt.module.scss';

export type PosterEvent = {
  id: string;
  slug: string;
  title: string;
  category?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  startsAt?: string;
  /** aspect-ratio CSS que viene de la metadata en BD, p. ej. "3/4", "16/9", "1/1" */
  posterAspect?: string | null;
};

function defaultAspect(category: string | null | undefined): string {
  switch (category) {
    case 'FESTIVAL':
      return '16/9';
    case 'SPORTS':
      return '1/1';
    case 'THEATER':
      return '2/3';
    case 'COMEDY':
      return '4/5';
    default:
      return '3/4';
  }
}

/**
 * Local hero assets first. Unsplash (`stockImageForCategory` / EVENT_STOCK_IMAGES)
 * stays in shared for seeds only — not first paint on the storefront.
 */
function localPosterForCategory(category?: string | null, seed?: string): string {
  const s = seed ?? '';
  switch (category) {
    case 'FESTIVAL':
      return '/hero/01-festival.jpg';
    case 'SPORTS':
      return '/hero/04-experience.jpg';
    case 'THEATER':
    case 'COMEDY':
      return '/hero/05-indie.jpg';
    case 'EXPERIENCE':
      return '/hero/04-experience.jpg';
    default:
      if (/electro|edm|dj/i.test(s)) return '/hero/03-electro.jpg';
      if (/indie|jazz|ballet/i.test(s)) return '/hero/05-indie.jpg';
      if (/fest|open.?air/i.test(s)) return '/hero/01-festival.jpg';
      return '/hero/02-concert.jpg';
  }
}

/** Ancho/alto intrínsecos para que el navegador reserve el hueco antes del CSS. */
function intrinsicSize(aspect: string) {
  const [w, h] = aspect.split('/').map((n) => Number(n.trim()));
  if (!Number.isFinite(w) || !Number.isFinite(h) || !w || !h) {
    return { width: 600, height: 800 };
  }
  const base = 600;
  return { width: base, height: Math.round((base * h) / w) };
}

export function EventPosterArt({
  event,
  size = 'md',
  showDate,
  priority,
}: {
  event: PosterEvent;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  showDate?: boolean;
  /** Solo para el póster principal del hero: evita el lazy-load del LCP. */
  priority?: boolean;
}) {
  const src =
    event.bannerImage ||
    event.image ||
    localPosterForCategory(event.category, event.slug || event.title);
  const d = event.startsAt ? new Date(event.startsAt) : null;
  const aspect = event.posterAspect || defaultAspect(event.category);
  const { width, height } = intrinsicSize(aspect);
  const style = {
    ['--poster-aspect']: aspect,
  } as CSSProperties;

  return (
    <div
      className={`${styles.poster} ${styles[size]}`}
      style={style}
      data-aspect={aspect}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={styles.photo}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
      {showDate && d && (
        <div className={styles.date}>
          <strong>{d.toLocaleDateString('es-MX', { day: '2-digit' })}</strong>
          <span>{d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')}</span>
        </div>
      )}
    </div>
  );
}
