'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { TicketState } from '@boletera/ui';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
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
      </header>
      <TicketState
        kind="empty"
        title="Próximamente"
        body="Aquí podrás crear avisos automáticos de venta y lista de espera."
        action={
          <Link href="/" className={styles.panelLink}>
            Volver al panel
          </Link>
        }
      />
    </section>
  );
}
