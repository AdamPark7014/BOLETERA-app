'use client';

import Link from 'next/link';
import { EmptyState, PageHeader } from '@boletera/ui';

/**
 * Automatizaciones: antes era un cockpit localStorage con reglas inventadas.
 * Hasta que exista un motor real, solo un aviso honesto.
 */
export default function AutomationsUnavailablePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Operaciones"
        title="Automatizaciones"
        description="Reglas de alerta, waitlist y ritmo de venta"
      />
      <EmptyState
        title="Función no disponible"
        description="No hay motor de automatizaciones en producción. Esta pantalla no inventa reglas ni historial."
        action={
          <Link href="/">
            Volver al panel
          </Link>
        }
      />
    </div>
  );
}
