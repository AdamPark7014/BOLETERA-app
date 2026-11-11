'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { ParameterCard } from '@boletera/ui';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';

/**
 * Automatizaciones: antes era un cockpit localStorage con reglas inventadas.
 * Hasta que exista un motor real, solo un aviso honesto. No llama al API.
 */
export default function AutomationsUnavailablePage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <AutomatizacionesBody />
      </AdminFrame>
    </Suspense>
  );
}

function AutomatizacionesBody() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Automatizaciones</h1>
        <p className={styles.quiet}>Reglas de alerta, lista de espera y ritmo de venta.</p>
      </header>
      <div className={styles.stack}>
        <Param name="Motor de automatizaciones">
          <ParameterCard
            name="Función no disponible"
            value="Sin motor"
            effect="No hay motor de automatizaciones en producción. Esta pantalla no inventa reglas ni historial."
          />
        </Param>
        <p className={styles.tertiary}>
          <Link href="/" style={{ color: 'inherit' }}>
            Volver al panel
          </Link>
        </p>
      </div>
    </section>
  );
}
