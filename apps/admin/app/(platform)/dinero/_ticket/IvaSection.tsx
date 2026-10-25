'use client';

import { useEffect, useState } from 'react';
import { ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { Param, Stepper } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import {
  percentLabel,
  percentPoints,
  rateFromPoints,
  readPricingRates,
  type PricingRates,
} from './rates';

export function IvaSection({
  rates,
  token,
  canSave,
  onSaved,
}: {
  rates: PricingRates;
  token: string;
  canSave: boolean;
  onSaved: (rates: PricingRates) => void;
}) {
  const [tax, setTax] = useState(() => percentPoints(rates.taxRate));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTax(percentPoints(rates.taxRate));
  }, [rates]);

  const taxDirty = tax !== percentPoints(rates.taxRate);
  const draftRate = rateFromPoints(tax);

  async function save() {
    if (!taxDirty || saving || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminApi<unknown>('/pricing/rates', token, {
        method: 'PATCH',
        body: JSON.stringify({ taxRate: draftRate }),
      });
      const parsed = readPricingRates(updated);
      if (!parsed) throw new Error('No se leyó la tasa guardada.');
      setNotice(`IVA: ${percentLabel(rates.taxRate)} → ${percentLabel(draftRate)}`);
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
        <h1 className={styles.sectionTitle}>IVA</h1>
        <p className={styles.quiet}>
          Una tasa para toda la organización. Vacío, el checkout sigue la del entorno.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="IVA">
          <ParameterCard
            name="IVA"
            value={percentLabel(taxDirty ? draftRate : rates.taxRate)}
            valueStyle="tabular"
            effect={
              taxDirty || rates.taxSaved
                ? 'El IVA de un CFDI sale de esta tasa. No se captura aparte en la factura.'
                : 'Sin tasa guardada. Vacío, el checkout sigue con esta tasa del entorno.'
            }
          >
            {canSave ? (
              <Stepper
                label="IVA"
                value={tax}
                min={0}
                max={100}
                unit="%"
                onChange={(next) => {
                  setTax(next);
                  setNotice(null);
                }}
              />
            ) : null}
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
            {taxDirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!taxDirty || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
