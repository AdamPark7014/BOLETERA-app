import styles from './DiscoverySkeleton.module.scss';

/**
 * Esqueleto de la cartelera (sin hero: HomeHero ya está visible arriba).
 * Reproduce la geometría del panel de descubrimiento para evitar CLS.
 */
export function DiscoverySkeleton() {
  return (
    <div className={styles.wrap}>
      <p className="sr-only" role="status">
        Cargando la cartelera…
      </p>
      <div className={styles.shell} aria-hidden="true">
        <div className={styles.search} />
        <div className={styles.hubs}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={styles.hub} />
          ))}
        </div>
        <div className={styles.cats}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={styles.cat} />
          ))}
        </div>
        <div className={styles.listHead}>
          <span className={styles.listTitle} />
          <span className={styles.listTools} />
        </div>
        <ul className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className={styles.card}>
              <span className={styles.poster} />
              <span className={styles.cardCat} />
              <span className={styles.cardTitle} />
              <span className={styles.cardMeta} />
              <span className={styles.cardPrice} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
