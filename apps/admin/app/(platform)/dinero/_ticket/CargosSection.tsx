'use client';

import { Money, ParameterCard, formatTicketAmount } from '@boletera/ui';
import { Param } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { yesNo } from '../../events/_ticket/read';
import { percentLabel, type OrgMoney, type PricingRates } from './rates';

export function CargosSection({ org, rates }: { org: OrgMoney; rates: PricingRates }) {
  const { example } = rates;
  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Cargos</h1>
        <p className={styles.quiet}>
          Una tasa para toda la organización. La fija el entorno. Aquí se lee.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Cargo por servicio">
          <ParameterCard
            name="Cargo por servicio"
            value={percentLabel(rates.serviceFeeRate)}
            valueStyle="tabular"
            effect="Se suma al precio base de cada boleto. No hay cargo distinto por evento, zona o promotor."
          />
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
      </div>
    </section>
  );
}
