import Link from 'next/link';
import { Badge, Card, CardHeader, formatNumber } from '@boletera/ui';
import type { BadgeTone } from '@boletera/ui';
import type { CapabilityGroup, CapabilityState } from '../_lib/catalog';
import { ratioOf } from '../_lib/progress';
import { Meter } from './Meter';
import styles from '../platform.module.scss';

const STATE_TONE: Readonly<Record<CapabilityState, BadgeTone>> = {
  active: 'success',
  idle: 'warning',
  off: 'neutral',
};

export interface CapabilityGroupCardProps {
  group: CapabilityGroup;
  /** Habilita los accesos que cambian configuración de la organización. */
  canManage: boolean;
}

/** Tarjeta de un bloque de capacidades: cuántas operan y qué falta en cada una. */
export function CapabilityGroupCard({ group, canManage }: CapabilityGroupCardProps) {
  const total = group.items.length;
  const ratio = ratioOf(group.activeCount, total);

  return (
    <Card variant="outline" padding="md" className={styles.groupCard} role="group" aria-label={group.label}>
      <CardHeader
        as="h3"
        title={group.label}
        description={group.description}
        actions={
          <Badge tone={group.activeCount === total ? 'success' : 'neutral'} variant="soft">
            {group.activeCount} de {total} activas
          </Badge>
        }
      />

      {ratio === null ? null : (
        <Meter
          label={`Capacidades activas en ${group.label}`}
          value={group.activeCount}
          max={total}
          ratio={ratio}
          tone={group.activeCount === total ? 'success' : 'accent'}
        />
      )}

      <ul className={styles.capabilityList}>
        {group.items.map((item) => {
          const blocked = item.requiresManage && !canManage;
          return (
            <li key={item.key} className={styles.capability}>
              <div className={styles.capabilityHead}>
                <h4 className={styles.capabilityName}>{item.label}</h4>
                <Badge tone={STATE_TONE[item.state]} variant="soft" dot>
                  {item.stateLabel}
                </Badge>
              </div>

              <p className={styles.capabilitySummary}>{item.summary}</p>
              <p className={styles.capabilityWhy}>{item.explanation}</p>

              <div className={styles.capabilityFoot}>
                <span className={styles.tag}>{item.activationLabel}</span>
                {item.usage ? (
                  <span className={styles.usage}>
                    <strong>{formatNumber(item.usage.value)}</strong> {item.usage.label}
                  </span>
                ) : null}
                {blocked ? (
                  <span className={styles.blocked}>
                    Requiere rol de administrador para configurarla
                  </span>
                ) : (
                  <Link className={styles.cta} href={item.cta.href}>
                    {item.cta.label}
                    <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
