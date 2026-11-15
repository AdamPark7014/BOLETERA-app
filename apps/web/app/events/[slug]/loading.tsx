import { TicketSkeleton } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import styles from './event.module.scss';

/** Esqueleto del evento con las alturas finales: portada, zonas y póster. */
export default function EventLoading() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <TicketSkeleton height={520} radius={24} label="Cargando el evento" />
        <div className={styles.fichaGrid}>
          <div className={styles.fichaMain}>
            <TicketSkeleton height={28} width={120} radius={8} />
            <TicketSkeleton height={256} />
          </div>
          <div className={styles.fichaSide}>
            <TicketSkeleton height={500} />
          </div>
        </div>
      </main>
    </>
  );
}
