'use client';

import { useEffect, useState } from 'react';
import { ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { Param, Stepper, Switch } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { yesNo } from '../../events/_ticket/read';
import {
  percentLabel,
  percentPoints,
  rateFromPoints,
  type OrgMoney,
  type ResaleLimits,
} from './rates';

export function ComisionesSection({
  orgId,
  org,
  limits,
  limitsNote,
  token,
  canSave,
  onSaved,
}: {
  orgId: string;
  org: OrgMoney;
  limits: ResaleLimits | null;
  limitsNote: string | null;
  token: string;
  canSave: boolean;
  onSaved: () => void;
}) {
  const [commission, setCommission] = useState(() => percentPoints(org.commissionRate));
  const [resale, setResale] = useState(() => percentPoints(org.resaleCommission));
  const [allow, setAllow] = useState(org.allowResale);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCommission(percentPoints(org.commissionRate));
    setResale(percentPoints(org.resaleCommission));
    setAllow(org.allowResale);
  }, [org]);

  const commissionDirty = commission !== percentPoints(org.commissionRate);
  const resaleDirty = resale !== percentPoints(org.resaleCommission);
  const allowDirty = allow !== org.allowResale;
  const dirty = commissionDirty || resaleDirty || allowDirty;
  const feeNote = limits
    ? `El cobro de un anuncio usa este porcentaje. Vacío, queda en el ${percentLabel(limits.feePercent)} del servicio.`
    : 'El cobro de un anuncio usa este porcentaje. Vacío, queda en el 8% del servicio.';
  const capValue = limits
    ? `${percentLabel(limits.minPercent)} – ${percentLabel(limits.maxPercent)} del original`
    : '—';

  const changes = [
    commissionDirty
      ? `Comisión de la organización: ${percentLabel(org.commissionRate)} → ${commission}%`
      : null,
    allowDirty ? `Reventa de la organización: ${yesNo(org.allowResale)} → ${yesNo(allow)}` : null,
    resaleDirty ? `Comisión de reventa: ${percentLabel(org.resaleCommission)} → ${resale}%` : null,
  ].filter((line): line is string => line != null);

  async function save() {
    if (!dirty || saving || !canSave) return;
    setSaving(true);
    setError(null);
    const body: {
      commissionRate?: number;
      resaleCommission?: number;
      allowResale?: boolean;
    } = {};
    if (commissionDirty) body.commissionRate = rateFromPoints(commission);
    if (resaleDirty) body.resaleCommission = rateFromPoints(resale);
    if (allowDirty) body.allowResale = allow;
    try {
      await adminApi(`/organization/${orgId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice(changes.join(' · '));
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Comisiones</h1>
        {limitsNote ? <p className={styles.tertiary}>{limitsNote}</p> : null}
      </header>
      <div className={styles.stack}>
        <Param name="Comisión de la organización">
          <ParameterCard
            name="Comisión de la organización"
            value={commissionDirty ? `${commission}%` : percentLabel(org.commissionRate)}
            valueStyle="tabular"
            effect="Se descuenta al liquidar la venta."
          >
            {canSave ? (
              <Stepper
                label="Comisión de la organización"
                value={commission}
                min={0}
                max={100}
                unit="%"
                onChange={(next) => {
                  setCommission(next);
                  setNotice(null);
                }}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Reventa de la organización">
          <ParameterCard
            name="Reventa de la organización"
            value={yesNo(allowDirty ? allow : org.allowResale)}
            effect="Permite anuncios de reventa de esta organización."
          >
            {canSave ? (
              <Switch
                label="Reventa de la organización"
                on={allow}
                onChange={(next) => {
                  setAllow(next);
                  setNotice(null);
                }}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Comisión de reventa">
          <ParameterCard
            name="Comisión de reventa"
            value={resaleDirty ? `${resale}%` : percentLabel(org.resaleCommission)}
            valueStyle="tabular"
            effect={feeNote}
          >
            {canSave ? (
              <Stepper
                label="Comisión de reventa"
                value={resale}
                min={0}
                max={100}
                unit="%"
                onChange={(next) => {
                  setResale(next);
                  setNotice(null);
                }}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Tope anti-scalping">
          <ParameterCard
            name="Tope anti-scalping"
            value={capValue}
            valueStyle="tabular"
            effect="El servicio rechaza un anuncio fuera de este rango."
          />
        </Param>
      </div>
      {error ? (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      ) : null}
      {canSave ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
