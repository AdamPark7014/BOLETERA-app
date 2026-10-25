'use client';

import { useEffect, useState } from 'react';
import { Money, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { Param, Stepper } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { yesNo } from '../../events/_ticket/read';
import {
  exampleFromRates,
  percentLabel,
  percentPoints,
  rateFromPoints,
  readPricingRates,
  type OrgMoney,
  type PricingRates,
} from './rates';

export function CargosSection({
  org,
  rates,
  token,
  canSave,
  onSaved,
}: {
  org: OrgMoney;
  rates: PricingRates;
  token: string;
  canSave: boolean;
  onSaved: (rates: PricingRates) => void;
}) {
  const [fee, setFee] = useState(() => percentPoints(rates.serviceFeeRate));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFee(percentPoints(rates.serviceFeeRate));
  }, [rates]);

  const feeDirty = fee !== percentPoints(rates.serviceFeeRate);
  const draftRate = rateFromPoints(fee);
  const example = feeDirty
    ? exampleFromRates(rates.example.base, draftRate, rates.taxRate)
    : rates.example;

  async function save() {
    if (!feeDirty || saving || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminApi<unknown>('/pricing/rates', token, {
        method: 'PATCH',
        body: JSON.stringify({ serviceFeeRate: draftRate }),
      });
      const parsed = readPricingRates(updated);
      if (!parsed) throw new Error('No se leyó la tasa guardada.');
      setNotice(
        `Cargo por servicio: ${percentLabel(rates.serviceFeeRate)} → ${percentLabel(draftRate)}`,
      );
      onSaved(parsed);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Cargos</h1>
        <p className={styles.quiet}>
          Una tasa para toda la organización. Vacío, el checkout sigue la del entorno.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Cargo por servicio">
          <ParameterCard
            name="Cargo por servicio"
            value={percentLabel(feeDirty ? draftRate : rates.serviceFeeRate)}
            valueStyle="tabular"
            effect={
              feeDirty || rates.serviceFeeSaved
                ? 'Se suma al precio base de cada boleto. No hay cargo distinto por evento, zona o promotor.'
                : 'Sin tasa guardada. Vacío, el checkout sigue con esta tasa del entorno.'
            }
          >
            {canSave ? (
              <Stepper
                label="Cargo por servicio"
                value={fee}
                min={0}
                max={100}
                unit="%"
                onChange={(next) => {
                  setFee(next);
                  setNotice(null);
                }}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Cargos incluidos">
          <ParameterCard
            name="Cargos incluidos"
            value={yesNo(org.feesInclusive)}
            effect="El cobro suma el cargo encima de la base. Esta columna no entra al cálculo."
          />
        </Param>
        <Param name="Cargo de la oferta">
          <ParameterCard
            name="Cargo de la oferta"
            value={formatTicketAmount(0)}
            valueStyle="tabular"
            effect="Columna de la oferta. El checkout no la usa."
          />
        </Param>
        <Param name="Precio anunciado">
          <ParameterCard
            name="Precio anunciado"
            value={formatTicketAmount(example.total)}
            valueStyle="tabular"
            effect={`Base + cargo + IVA sobre ${formatTicketAmount(example.base)}. Nadie lo teclea.`}
          >
            <Money
              label="Precio anunciado"
              amount={example.total}
              currency
              defaultOpen
              lines={[
                { label: 'Base', amount: example.base },
                { label: 'Cargo', amount: example.fees },
                { label: 'IVA', amount: example.taxes },
              ]}
            />
          </ParameterCard>
        </Param>
        {error ? (
          <p className={styles.danger} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {canSave ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {feeDirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!feeDirty || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
