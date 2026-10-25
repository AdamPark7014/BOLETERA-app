'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Param, Switch } from '../../events/_ticket/controls';
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

function methodEffect(saved: boolean, on: boolean): string {
  if (!saved) return 'Sin clave. Sigue activo.';
  return on ? 'El checkout lo ofrece.' : 'El checkout no lo ofrece.';
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
          <h1 className={styles.sectionTitle}>Pagos</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir pagos" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !config || !flags) return <p className={styles.quiet}>Cargando pagos.</p>;

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
        }),
      );
      setFlags(updated);
      setTarjeta(updated.tarjeta);
      setSpei(updated.SPEI);
      setOxxo(updated.OXXO);
      setNotice(changes.join(' · '));
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Pagos</h1>
        <p className={styles.quiet}>
          Tarjeta, SPEI y OXXO. Si la clave no está, el método sigue activo. Las credenciales no entran a la ficha.
        </p>
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
        <Param name="Tarjeta">
          <ParameterCard
            name="Tarjeta"
            value={yesNo(tarjeta)}
            effect={
              tarjetaDirty
                ? methodEffect(true, tarjeta)
                : methodEffect(flags.tarjetaSaved, flags.tarjeta)
            }
          >
            <Switch
              label="Tarjeta"
              on={tarjeta}
              onChange={(next) => {
                setTarjeta(next);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
        <Param name="SPEI">
          <ParameterCard
            name="SPEI"
            value={yesNo(spei)}
            effect={speiDirty ? methodEffect(true, spei) : methodEffect(flags.speiSaved, flags.SPEI)}
          >
            <Switch
              label="SPEI"
              on={spei}
              onChange={(next) => {
                setSpei(next);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
        <Param name="OXXO">
          <ParameterCard
            name="OXXO"
            value={yesNo(oxxo)}
            effect={oxxoDirty ? methodEffect(true, oxxo) : methodEffect(flags.oxxoSaved, flags.OXXO)}
          >
            <Switch
              label="OXXO"
              on={oxxo}
              onChange={(next) => {
                setOxxo(next);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
      </div>
      {saveError ? (
        <p className={styles.danger} role="alert">
          {saveError}
        </p>
      ) : null}
      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {dirty ? 'Sin guardar' : (notice ?? 'Efectivo se cobra en taquilla y no está en esta pasarela.')}
        </p>
        <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
          Guardar sección
        </TicketButton>
      </div>
    </section>
  );
}
