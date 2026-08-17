'use client';

import Link from 'next/link';
import { Badge, EmptyState } from '@boletera/ui';
import { formatShortDate } from '../_lib/format';
import type { OrderException } from '../_lib/types';
import styles from '../orders.module.scss';

const KIND_TONE = {
  failed: 'danger',
  stale_pending: 'warning',
  pending_refund: 'warning',
  partial_refund: 'info',
} as const;

type OrdersExceptionsProps = {
  exceptions: readonly OrderException[];
};

export function OrdersExceptions({ exceptions }: OrdersExceptionsProps) {
  return (
    <section className={styles.exceptions} aria-labelledby="orders-exceptions-title">
      <div className={styles.exceptionsHead}>
        <h2 id="orders-exceptions-title">Excepciones operativas</h2>
        <Badge tone={exceptions.length ? 'warning' : 'success'} variant="soft" size="sm" dot>
          {exceptions.length
            ? `${exceptions.length} requieren atención`
            : 'Sin excepciones'}
        </Badge>
      </div>

      {exceptions.length === 0 ? (
        <EmptyState
          title="Cola limpia"
          description="No hay fallos, pendientes vencidos ni reembolsos parciales en el recorte actual."
          illustration="success"
          size="sm"
          tone="success"
        />
      ) : (
        <ul className={styles.exceptionList}>
          {exceptions.slice(0, 8).map((item) => (
            <li key={`${item.kind}-${item.orderId}`}>
              <Link href={`/orders/${item.orderId}`} className={styles.exceptionRow}>
                <Badge tone={KIND_TONE[item.kind]} variant="soft" size="sm" dot>
                  {item.label}
                </Badge>
                <code className={styles.code}>{item.publicId}</code>
                <time dateTime={item.createdAt}>{formatShortDate(item.createdAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
