'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ParameterCard } from '@boletera/ui';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';

/**
 * Patrocinios: el API no está cableado. La pantalla no inventa contratos,
 * pipeline ni ROI; solo dice que la función no está disponible.
 */
export default function SponsorshipsUnavailablePage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <section>
          <header className={styles.sectionHead}>
            <h1 className={styles.sectionTitle}>Patrocinios</h1>
            <p className={styles.quiet}>Paquetes, activaciones y retorno de patrocinadores.</p>
          </header>
          <div className={styles.stack}>
            <Param name="Función no disponible">
              <ParameterCard
                name="Estado"
                value="Función no disponible"
                effect="La API de patrocinios aún no está conectada. No se muestran contratos, pipeline ni ROI inventados."
              />
            </Param>
            <p className={styles.tertiary}>
              <Link href="/events">Volver a eventos</Link>
            </p>
          </div>
        </section>
      </AdminFrame>
    </Suspense>
  );
}
