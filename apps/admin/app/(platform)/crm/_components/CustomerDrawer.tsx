'use client';

import { Badge, Button, formatNumber } from '@boletera/ui';
import {
  formatChurnPct,
  formatMoney,
  formatRelativeDay,
  formatRfm,
} from '../_lib/format';
import {
  aiSegmentLabel,
  CHURN_LABEL,
  CHURN_TONE,
  SEGMENT_LABEL,
  SEGMENT_TONE,
} from '../_lib/labels';
import type { CrmCustomerRow } from '../_lib/types';
import styles from '../crm.module.scss';

type Props = {
  customer: CrmCustomerRow;
  onClose: () => void;
};

export function CustomerDrawerBody({ customer, onClose }: Props) {
  return (
    <div className={styles.drawerBody}>
      <div className={styles.badgeRow}>
        <Badge tone={SEGMENT_TONE[customer.segment]} variant="soft" size="sm" dot>
          {SEGMENT_LABEL[customer.segment]}
        </Badge>
        <Badge tone={CHURN_TONE[customer.churnBand]} variant="outline" size="sm">
          Churn {CHURN_LABEL[customer.churnBand]}
        </Badge>
        {customer.aiSegment ? (
          <Badge tone="info" variant="outline" size="sm">
            AI · {aiSegmentLabel(customer.aiSegment)}
          </Badge>
        ) : null}
      </div>

      <dl className={styles.metaGrid}>
        <div>
          <dt>LTV (muestra)</dt>
          <dd>{formatMoney(customer.totalSpend, customer.currency)}</dd>
        </div>
        <div>
          <dt>RFM</dt>
          <dd>
            {formatRfm(customer.rfm)}{' '}
            <span className={styles.inlineMuted}>
              ({formatNumber(customer.rfmScore, 1)})
            </span>
          </dd>
        </div>
        <div>
          <dt>Pedidos</dt>
          <dd>
            {formatNumber(customer.completedOrders)} / {formatNumber(customer.ordersCount)}
          </dd>
        </div>
        <div>
          <dt>Riesgo churn</dt>
          <dd>
            {customer.aiChurnProbability != null
              ? `${formatChurnPct(customer.aiChurnProbability)} (AI)`
              : formatChurnPct(customer.churnRisk)}
          </dd>
        </div>
        <div>
          <dt>Primera compra</dt>
          <dd>{formatRelativeDay(customer.firstOrderAt)}</dd>
        </div>
        <div>
          <dt>Última compra</dt>
          <dd>{formatRelativeDay(customer.lastOrderAt)}</dd>
        </div>
        <div>
          <dt>Canales</dt>
          <dd>{customer.channels}</dd>
        </div>
        <div>
          <dt>Evento top</dt>
          <dd>{customer.topEvent}</dd>
        </div>
      </dl>

      <p className={styles.muted}>
        Perfil derivado de pedidos de la muestra cargada. No hay GET /crm/customers ni
        timeline dedicado; el churn local usa solo recencia observada
        {customer.aiSegment
          ? '; el segmento AI se enlazó por correo cuando coincidió.'
          : '.'}
      </p>

      <Button type="button" variant="secondary" onClick={onClose}>
        Cerrar
      </Button>
    </div>
  );
}
