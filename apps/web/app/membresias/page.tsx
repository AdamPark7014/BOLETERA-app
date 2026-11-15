import { SiteHeader } from '@/components/SiteHeader';
import { API_BASE as API, getTenantHostHeaders } from '@/lib/api';
import { fetchTenantCurrent } from '@/lib/tenant';
import { StageArt } from '@boletera/ui';
import purchase from '@/components/purchase/purchase.module.scss';
import styles from './membresias.module.scss';
import { PlanesClient } from './PlanesClient';
import type { PublicPlan } from './types';

type PlansState =
  | { kind: 'ok'; plans: PublicPlan[]; organization: string }
  | { kind: 'error'; message: string };

/** Planes activos de la organización del sitio. Sin sesión: lo público del plan. */
async function loadPlans(slug: string): Promise<PlansState> {
  try {
    const res = await fetch(`${API}/memberships/public/${encodeURIComponent(slug)}/plans`, {
      headers: await getTenantHostHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return {
        kind: 'error',
        message: body?.message || `No pudimos cargar los planes (HTTP ${res.status}).`,
      };
    }
    const data = (await res.json()) as { organization?: { name?: string }; plans?: PublicPlan[] };
    return { kind: 'ok', plans: data.plans ?? [], organization: data.organization?.name ?? '' };
  } catch {
    return { kind: 'error', message: 'No pudimos cargar los planes. Revisa la conexión.' };
  }
}

export default async function MembresiasPage() {
  const tenant = await fetchTenantCurrent();
  const state = await loadPlans(tenant.slug);

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <section className={styles.hero}>
          <StageArt seed="membresia-black" fade={false} className={styles.heroArt} />
          <span className={styles.heroShade} />
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>Membresía Black</h1>
            <p className={styles.heroLead}>Preventas y beneficios en tus eventos favoritos.</p>
          </div>
        </section>

        {state.kind === 'error' ? (
          <div className={purchase.error} role="alert">
            <span>{state.message}</span>
          </div>
        ) : state.plans.length === 0 ? (
          <p className={purchase.lead}>Por ahora no hay planes a la venta.</p>
        ) : (
          <PlanesClient plans={state.plans} />
        )}
      </main>
    </>
  );
}
