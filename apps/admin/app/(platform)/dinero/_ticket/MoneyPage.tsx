'use client';

import { Suspense, useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import styles from '../../events/_ticket/frame.module.scss';
import { CargosSection } from './CargosSection';
import { ComisionesSection } from './ComisionesSection';
import { IvaSection } from './IvaSection';
import {
  readOrgMoney,
  readPricingRates,
  readResaleLimits,
  type OrgMoney,
  type PricingRates,
  type ResaleLimits,
} from './rates';

export type MoneySection = 'comisiones' | 'cargos' | 'iva';

const TITLE: Record<MoneySection, string> = {
  comisiones: 'Comisiones',
  cargos: 'Cargos',
  iva: 'IVA',
};

export function MoneyPage({ section }: { section: MoneySection }) {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <MoneyBody section={section} />
      </AdminFrame>
    </Suspense>
  );
}

function MoneyBody({ section }: { section: MoneySection }) {
  const session = useSession();
  const [org, setOrg] = useState<OrgMoney | null>(null);
  const [rates, setRates] = useState<PricingRates | null>(null);
  const [limits, setLimits] = useState<ResaleLimits | null>(null);
  const [limitsNote, setLimitsNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const orgId = session.status === 'ready' ? session.orgId : null;
  const canSee = hasCapability(session.role, 'finance.view');
  const canSave =
    session.role === 'ADMIN' || session.role === 'SUPER_ADMIN' || session.role === 'PROMOTER';

  useEffect(() => {
    if (!token || !orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const bearer = token;
    const id = orgId;
    let alive = true;
    setError(null);
    async function load() {
      if (section === 'comisiones') {
        const rawOrg = await adminApi<unknown>(`/organization/${id}`, bearer);
        const money = readOrgMoney(rawOrg);
        if (!money) throw new Error('La organización no trae las comisiones.');
        const rawLimits = await adminApi<unknown>('/resale/limits', bearer, { silent: true }).catch(
          () => null,
        );
        const parsedLimits = rawLimits ? readResaleLimits(rawLimits) : null;
        if (!alive) return;
        setOrg(money);
        setLimits(parsedLimits);
        setLimitsNote(
          parsedLimits
            ? null
            : 'No se leyeron los topes de reventa. La comisión de la organización sí está.',
        );
        return;
      }
      const rawRates = await adminApi<unknown>('/pricing/rates', bearer);
      const parsedRates = readPricingRates(rawRates);
      if (!parsedRates) throw new Error('No se leyeron las tasas.');
      if (section === 'cargos') {
        const rawOrg = await adminApi<unknown>(`/organization/${id}`, bearer);
        const money = readOrgMoney(rawOrg);
        if (!money) throw new Error('La organización no trae los cargos.');
        if (!alive) return;
        setOrg(money);
      }
      if (!alive) return;
      setRates(parsedRates);
    }
    void load()
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, orgId, canSee, section, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>{TITLE[section]}</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context={`abrir ${TITLE[section].toLowerCase()}`}
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (!token || !orgId || (loading && !org && !rates)) {
    return <p className={styles.quiet}>Cargando {TITLE[section].toLowerCase()}.</p>;
  }
  if (section === 'comisiones') {
    if (!org) return <p className={styles.quiet}>Cargando comisiones.</p>;
    return (
      <ComisionesSection
        orgId={orgId}
        org={org}
        limits={limits}
        limitsNote={limitsNote}
        token={token}
        canSave={canSave}
        onSaved={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (!rates || (section === 'cargos' && !org)) {
    return <p className={styles.quiet}>Cargando {TITLE[section].toLowerCase()}.</p>;
  }
  if (section === 'cargos' && org) {
    return (
      <CargosSection
        org={org}
        rates={rates}
        token={token}
        canSave={canSave}
        onSaved={setRates}
      />
    );
  }
  return <IvaSection rates={rates} token={token} canSave={canSave} onSaved={setRates} />;
}
