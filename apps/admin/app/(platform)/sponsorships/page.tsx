'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { TicketState } from '@boletera/ui';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import styles from '../events/_ticket/frame.module.scss';

/**
 * Patrocinios: el API no está cableado. La pantalla no inventa contratos,
 * pipeline ni ROI; solo avisa que llega después.
 */
export default function SponsorshipsUnavailablePage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <section>
          <header className={styles.sectionHead}>
            <h1 className={styles.sectionTitle}>Patrocinios</h1>
          </header>
          <TicketState
            kind="empty"
            title="Próximamente"
            body="Aquí verás paquetes y activaciones de patrocinadores."
            action={
              <Link href="/events" className={styles.panelLink}>
                Volver a eventos
              </Link>
            }
          />
        </section>
      </AdminFrame>
    </Suspense>
  );
}
