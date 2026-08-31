'use client';

import Link from 'next/link';
import { EmptyState, PageHeader } from '@boletera/ui';

/**
 * Patrocinios: la API no está cableada. Antes esta ruta inventaba KPIs/ROI con
 * datos vacíos o mocks — ahora es un aviso honesto sin teatro.
 */
export default function SponsorshipsUnavailablePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Comercial"
        title="Patrocinios"
        description="Gestión de paquetes, activaciones y ROI de sponsors"
      />
      <EmptyState
        title="Función no disponible"
        description="La API de patrocinios aún no está conectada. No se muestran contratos, pipeline ni ROI inventados."
        action={
          <Link href="/">
            Volver al panel
          </Link>
        }
      />
    </div>
  );
}
