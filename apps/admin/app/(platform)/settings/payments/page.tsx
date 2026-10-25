'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Param } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { asRecord, readString } from '../../events/_ticket/read';

const METHOD: Record<string, string> = {
  CARD: 'Tarjeta',
  SPEI: 'SPEI',
  OXXO: 'OXXO',
  CASH: 'Efectivo',
};

type Config = {
  mode: string;
  methods: string[];
  clabe: string | null;
  settlement: string | null;
};

function readConfig(payload: unknown): Config {
  const row = asRecord(payload);
  const methods = Array.isArray(row.methods)
    ? row.methods.flatMap((item) => {
        const method = readString(item);
        return method ? [method] : [];
      })
    : [];
  return {
    mode: readString(row.mode) ?? 'demo',
    methods,
    clabe: readString(row.accountClabeMasked),
    settlement: readString(row.settlement),
  };
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <PagosBody />
      </AdminFrame>
    </Suspense>
  );
}

function PagosBody() {
  const session = useSession();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'settings.payments');

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>('/payments/config', token)
      .then((payload) => {
        if (!alive) return;
        setConfig(readConfig(payload));
      })
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
  }, [token, canSee, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Pagos</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir pagos" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !config) return <p className={styles.quiet}>Cargando pagos.</p>;

  const methods = config.methods.map((method) => METHOD[method] ?? method).join(', ') || '—';

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Pagos</h1>
        <p className={styles.quiet}>No hay parámetro editable. Las credenciales no entran a la ficha.</p>
      </header>
      <div className={styles.stack}>
        <Param name="Pasarela">
          <ParameterCard
            name="Pasarela"
            value={config.mode === 'live' ? 'Banorte · En vivo' : 'Banorte · Demo'}
            effect={config.settlement ?? 'Estado enmascarado. Sin el secreto.'}
          />
        </Param>
        {config.clabe ? (
          <Param name="CLABE">
            <ParameterCard
              name="CLABE"
              value={config.clabe}
              valueStyle="mono"
              effect="Enmascarada. El secreto no se muestra."
            />
          </Param>
        ) : null}
        <Param name="Métodos que cobran">
          <ParameterCard
            name="Métodos que cobran"
            value={methods}
            effect="Efectivo se cobra en taquilla y no está en esta pasarela. PayPal, Apple Pay, Google Pay y Stripe no tienen flujo."
          />
        </Param>
      </div>
    </section>
  );
}
