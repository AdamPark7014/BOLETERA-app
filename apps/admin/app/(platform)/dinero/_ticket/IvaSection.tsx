'use client';

import { ParameterCard } from '@boletera/ui';
import { Param } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { percentLabel, type PricingRates } from './rates';

export function IvaSection({ rates }: { rates: PricingRates }) {
  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>IVA</h1>
        <p className={styles.quiet}>Una tasa para toda la organización. La fija el entorno. Aquí se lee.</p>
      </header>
      <div className={styles.stack}>
        <Param name="IVA">
          <ParameterCard
            name="IVA"
            value={percentLabel(rates.taxRate)}
            valueStyle="tabular"
            effect="El IVA de un CFDI sale de esta tasa. No se captura aparte en la factura."
          />
        </Param>
      </div>
    </section>
  );
}
