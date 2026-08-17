'use client';

import { Badge, Card, CardHeader, EmptyState, SegmentedControl } from '@boletera/ui';
import type { SegmentedOption } from '@boletera/ui';
import type { Delivery, DeliverySummary } from '../_lib/deliveries';
import type { DeliveryFilter } from '../_lib/filters';
import { ratioOf } from '../_lib/progress';
import { Meter } from './Meter';
import styles from '../platform.module.scss';

const FILTER_OPTIONS: readonly SegmentedOption<DeliveryFilter>[] = [
  { value: 'pendientes', label: 'Pendientes' },
  { value: 'todas', label: 'Todas' },
];

export interface DeliveriesCardProps {
  deliveries: readonly Delivery[];
  summary: DeliverySummary;
  filter: DeliveryFilter;
  onFilterChange: (value: DeliveryFilter) => void;
}

/** Estado de lo comprometido en el plan: entregado, en curso o planeado. */
export function DeliveriesCard({
  deliveries,
  summary,
  filter,
  onFilterChange,
}: DeliveriesCardProps) {
  const visible = filter === 'pendientes' ? deliveries.filter((item) => !item.done) : deliveries;
  const ratio = ratioOf(summary.done, summary.total);

  return (
    <Card variant="outline" padding="md" role="group" aria-label="Entregas del plan">
      <CardHeader
        as="h3"
        title="Entregas del plan"
        description="Lo que la plataforma reporta como entregado, en curso o planeado para tu contrato."
        actions={
          <Badge tone={summary.highPending > 0 ? 'danger' : 'neutral'} variant="soft">
            {summary.done} de {summary.total} entregadas
          </Badge>
        }
      />

      {ratio === null ? null : (
        <Meter
          label="Entregas completadas del plan"
          value={summary.done}
          max={summary.total}
          ratio={ratio}
          tone={summary.pending === 0 ? 'success' : 'warning'}
        />
      )}

      <div className={styles.cardToolbar}>
        <SegmentedControl
          size="sm"
          label="Filtrar entregas del plan"
          options={FILTER_OPTIONS}
          value={filter}
          onValueChange={onFilterChange}
        />
        <span className={styles.tag}>
          {visible.length} {visible.length === 1 ? 'entrega' : 'entregas'} en vista
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          size="sm"
          tone="success"
          illustration="success"
          title="Sin entregas pendientes"
          description="Todo lo comprometido en el plan está marcado como entregado."
        />
      ) : (
        <ul className={styles.deliveryList}>
          {visible.map((item) => (
            <li key={item.id} className={styles.delivery}>
              <div className={styles.deliveryHead}>
                <strong className={styles.deliveryName}>{item.label}</strong>
                <Badge tone={item.statusTone} variant="soft" dot>
                  {item.statusLabel}
                </Badge>
              </div>
              <div className={styles.deliveryMeta}>
                <Badge tone={item.priorityTone} variant="outline" size="sm">
                  {item.priorityLabel}
                </Badge>
                {item.note ? <span className={styles.deliveryNote}>{item.note}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
