import styles from './DiscoverySkeleton.module.scss';

/**
 * Esqueleto de la cartelera. Reproduce la geometría real del panel (hero a
 * sangre, barra de búsqueda pegajosa, píldoras de ciudad, rejilla 4/3/2 con
 * pósters 3:4) para que al llegar los datos no se mueva nada: cualquier
 * diferencia de altura entre esqueleto y contenido se paga como CLS.
 */
export function DiscoverySkeleton() {
  return (
    <div className={styles.wrap}>
      <p className="sr-only" role="status">
        Cargando la cartelera…
      </p>
      <div className={styles.hero} aria-hidden="true">
        <div className={styles.heroCopy}>
          <span className={styles.brandMark} />
          <span className={styles.heroTitle} />
          <span className={styles.heroTitleShort} />
          <span className={styles.heroSupport} />
          <span className={styles.cta} />
        </div>
      </div>
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
