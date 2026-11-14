import { SiteHeader } from '@/components/SiteHeader';
import { getTenantHostHeaders } from '@/lib/api';
import { fetchTenantCurrent } from '@/lib/tenant';
import purchase from '@/components/purchase/purchase.module.scss';
import { PlanesClient } from './PlanesClient';
import type { PublicPlan } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

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
      <main id="contenido" className={purchase.column}>
        <div className={purchase.stack}>
          <p className={purchase.caption}>
            Membresías {state.kind === 'ok' ? state.organization || tenant.name : tenant.name}
          </p>
          <h1 className={purchase.title}>Membresías</h1>
          <p className={purchase.lead}>
            Elige un plan, págalo como pagas tus boletos y lo verás en tu cuenta con su vigencia y
            beneficios.
          </p>
        </div>

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
