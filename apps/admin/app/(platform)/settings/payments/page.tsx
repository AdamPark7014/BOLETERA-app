'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import { Suspense, useEffect, useState } from 'react';
import { TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Switch } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { asRecord, readString, yesNo } from '../../events/_ticket/read';

type Config = {
  mode: string;
  clabe: string | null;
  settlement: string | null;
};

type Flags = {
  tarjeta: boolean;
  SPEI: boolean;
  OXXO: boolean;
  tarjetaSaved: boolean;
  speiSaved: boolean;
  oxxoSaved: boolean;
};

function readConfig(payload: unknown): Config {
  const row = asRecord(payload);
  return {
    mode: readString(row.mode) ?? 'demo',
    clabe: readString(row.accountClabeMasked),
    settlement: readString(row.settlement),
  };
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readFlags(payload: unknown): Flags {
  const row = asRecord(payload);
  return {
    tarjeta: readBool(row.tarjeta, true),
    SPEI: readBool(row.SPEI, true),
    OXXO: readBool(row.OXXO, true),
    tarjetaSaved: readBool(row.tarjetaSaved, false),
    speiSaved: readBool(row.speiSaved, false),
    oxxoSaved: readBool(row.oxxoSaved, false),
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
  const [flags, setFlags] = useState<Flags | null>(null);
  const [tarjeta, setTarjeta] = useState(true);
  const [spei, setSpei] = useState(true);
  const [oxxo, setOxxo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    Promise.all([
      adminApi<unknown>('/payments/config', token),
      adminApi<unknown>('/payments/methods', token),
    ])
      .then(([configPayload, methodPayload]) => {
        if (!alive) return;
        const next = readFlags(methodPayload);
        setConfig(readConfig(configPayload));
        setFlags(next);
        setTarjeta(next.tarjeta);
        setSpei(next.SPEI);
        setOxxo(next.OXXO);
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
          <h1 className={styles.sectionTitle}>Pasarela de pago</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir pagos"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !config || !flags) {
    return <div className={styles.skeleton} style={{ height: 360 }} aria-label="Cargando pagos" />;
  }

  const tarjetaDirty = tarjeta !== flags.tarjeta;
  const speiDirty = spei !== flags.SPEI;
  const oxxoDirty = oxxo !== flags.OXXO;
  const dirty = tarjetaDirty || speiDirty || oxxoDirty;
  const changes = [
    tarjetaDirty ? `Tarjeta: ${yesNo(flags.tarjeta)} → ${yesNo(tarjeta)}` : null,
    speiDirty ? `SPEI: ${yesNo(flags.SPEI)} → ${yesNo(spei)}` : null,
    oxxoDirty ? `OXXO: ${yesNo(flags.OXXO)} → ${yesNo(oxxo)}` : null,
  ].filter((line): line is string => line != null);

  async function save() {
    if (!dirty || saving || !token) return;
    setSaving(true);
    setSaveError(null);
    const body: { tarjeta?: boolean; SPEI?: boolean; OXXO?: boolean } = {};
    if (tarjetaDirty) body.tarjeta = tarjeta;
    if (speiDirty) body.SPEI = spei;
    if (oxxoDirty) body.OXXO = oxxo;
    try {
      const updated = readFlags(
        await adminApi<unknown>('/payments/methods', token, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
      setFlags(updated);
      setTarjeta(updated.tarjeta);
      setSpei(updated.SPEI);
      setOxxo(updated.OXXO);
      setNotice(changes.join(' · '));
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.'
      );
    } finally {
      setSaving(false);
    }
  }

  const methods = [
    {
      key: 'tarjeta',
      label: 'Tarjeta',
      detail: 'Crédito y débito, cobro inmediato.',
      on: tarjeta,
      saved: flags.tarjetaSaved,
      dirty: tarjetaDirty,
      set: setTarjeta,
    },
    {
      key: 'spei',
      label: 'SPEI',
      detail: 'Transferencia bancaria con referencia.',
      on: spei,
      saved: flags.speiSaved,
      dirty: speiDirty,
      set: setSpei,
    },
    {
      key: 'oxxo',
      label: 'OXXO',
      detail: 'Pago en efectivo en tienda con ficha.',
      on: oxxo,
      saved: flags.oxxoSaved,
      dirty: oxxoDirty,
      set: setOxxo,
    },
  ];
  const activeCount = methods.filter((method) => method.on).length;
  const live = config.mode === 'live';

  return (
    <section className={styles.page}>
      <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
        <h1 className={styles.sectionTitle}>Pasarela de pago</h1>
      </header>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Pasarela</p>
          <p className={styles.kpiValue}>Banorte</p>
          <p className={styles.kpiNote}>
            <span className={live ? styles.chipOk : styles.chipWarn}>
              {live ? 'En vivo: cobros reales' : 'Modo demostración'}
            </span>
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Métodos activos</p>
          <p className={styles.kpiValue}>
            {activeCount}{' '}
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.6em' }}>/ 3</span>
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Cuenta de depósito</p>
          <p className={styles.kpiValue} style={{ fontFamily: 'var(--font-mono)', fontSize: 22 }}>
            {config.clabe ?? 'Sin CLABE'}
          </p>
          <p className={styles.kpiNote}>{config.settlement ?? 'CLABE enmascarada por seguridad'}</p>
        </div>
      </div>

      <div className={styles.tableWrap} style={{ maxHeight: 'none' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Método</th>
              <th scope="col">En el checkout</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((method) => (
              <tr key={method.key} data-param={method.label}>
                <td>
                  <strong>{method.label}</strong>
                  <p className={styles.rowMeta}>{method.detail}</p>
                </td>
                <td>
                  <Switch
                    label={method.label}
                    on={method.on}
                    onChange={(next) => {
                      method.set(next);
                      setNotice(null);
                    }}
                  />
                </td>
                <td>
                  {method.dirty ? (
                    <span className={styles.chipGold}>Sin guardar</span>
                  ) : !method.saved ? (
                    <span className={styles.chipOk}>Activo por omisión</span>
                  ) : method.on ? (
                    <span className={styles.chipOk}>Se ofrece</span>
                  ) : (
                    <span className={styles.chip}>Apagado</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {saveError ? (
        <p className={styles.danger} role="alert">
          {saveError}
        </p>
      ) : null}
      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {dirty ? `Sin guardar · ${changes.join(' · ')}` : (notice ?? '')}
        </p>
        <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Guardando' : 'Guardar cambios'}
        </TicketButton>
      </div>
    </section>
  );
}
