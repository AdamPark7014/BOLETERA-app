'use client';

import { Badge, formatNumber } from '@boletera/ui';
import { formatMoney } from '../_lib/format';
import type { CrmSegmentCard, CustomerSegment } from '../_lib/types';
import styles from '../crm.module.scss';

type Props = {
  segments: readonly CrmSegmentCard[];
  active: readonly CustomerSegment[];
  onToggle: (id: CustomerSegment) => void;
  loading?: boolean;
};

export function SegmentCards({ segments, active, onToggle, loading }: Props) {
  const activeSet = new Set(active);

  return (
    <div className={styles.segmentGrid} role="list" aria-label="Segmentos de cartera">
      {segments.map((segment) => {
        const isActive = activeSet.has(segment.id);
        return (
          <button
            key={segment.id}
            type="button"
            role="listitem"
            className={
              isActive
                ? `${styles.segmentCard} ${styles.segmentCardActive}`
                : styles.segmentCard
            }
            aria-pressed={isActive}
            disabled={loading}
            onClick={() => onToggle(segment.id)}
          >
            <Badge tone={segment.tone} variant="soft" size="sm" dot>
              {segment.label}
            </Badge>
            <p className={styles.segmentCount}>{formatNumber(segment.count)}</p>
            <p className={styles.segmentMeta}>
              {formatMoney(segment.spend)} · {segment.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
