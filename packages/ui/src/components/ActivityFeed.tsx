import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatDayLabel, formatTime, toDate } from '../lib/format';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import styles from './ActivityFeed.module.scss';

/** Entrada del registro de actividad. */
export interface ActivityItem {
  id: string;
  /** Quien realizo la accion. `Sistema` para procesos automaticos. */
  actor: string;
  /** URL del avatar del actor. */
  actorAvatar?: string;
  /** Verbo de la accion: "publico", "reembolso", "cambio el aforo de". */
  action: ReactNode;
  /** Objeto sobre el que se actuo. Se resalta visualmente. */
  target?: ReactNode;
  /** Momento del evento. */
  timestamp: Date | string | number;
  /** Icono que sustituye al avatar (eventos de sistema). */
  icon?: ReactNode;
  /** Detalle adicional: diff, motivo, importe. */
  detail?: ReactNode;
}

export interface ActivityFeedProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  items: readonly ActivityItem[];
  /** Agrupa las entradas por dia con un encabezado pegajoso. Por defecto `true`. */
  groupByDay?: boolean;
  /** Muestra esqueletos en lugar del contenido. */
  loading?: boolean;
  /** Numero de esqueletos mientras carga. Por defecto 5. */
  loadingRows?: number;
  /** Estado vacio a medida. Por defecto uno generico. */
  empty?: ReactNode;
  /** Etiqueta accesible del registro. */
  label?: string;
}

/** Agrupa por dia conservando el orden recibido. */
function groupEntries(
  items: readonly ActivityItem[],
): Array<{ key: string; label: string; entries: ActivityItem[] }> {
  const groups = new Map<string, { key: string; label: string; entries: ActivityItem[] }>();
  for (const item of items) {
    const date = toDate(item.timestamp);
    const key = date ? date.toISOString().slice(0, 10) : 'sin-fecha';
    let group = groups.get(key);
    if (!group) {
      group = { key, label: date ? formatDayLabel(date) : 'Sin fecha', entries: [] };
      groups.set(key, group);
    }
    group.entries.push(item);
  }
  return Array.from(groups.values());
}

/**
 * Registro cronologico de acciones (auditoria, historial de un evento, bitacora
 * de taquilla). Agrupa por dia y usa el avatar del actor como ancla visual.
 */
export function ActivityFeed({
  items,
  groupByDay = true,
  loading = false,
  loadingRows = 5,
  empty,
  label = 'Actividad reciente',
  className,
  ...rest
}: ActivityFeedProps) {
  if (loading) {
    return (
      <div className={cx(styles.feed, className)} aria-busy="true" aria-label={label} {...rest}>
        {Array.from({ length: Math.max(1, loadingRows) }, (_unused, index) => (
          <div key={index} className={styles.entry}>
            <Skeleton shape="circle" width={28} height={28} delay={index * 70} />
            <div className={styles.skeletonBody}>
              <Skeleton shape="text" width="58%" delay={index * 70} />
              <Skeleton shape="text" width="34%" height={10} delay={index * 70 + 40} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cx(styles.feed, className)} {...rest}>
        {empty ?? (
          <EmptyState
            size="sm"
            tone="neutral"
            illustration="inbox"
            title="Sin actividad todavia"
            description="Aqui apareceran los cambios de tu equipo: publicaciones, ajustes de precio, reembolsos y cortes de taquilla."
          />
        )}
      </div>
    );
  }

  const groups = groupByDay
    ? groupEntries(items)
    : [{ key: 'todas', label: '', entries: [...items] }];

  return (
    <div className={cx(styles.feed, className)} {...rest}>
      {groups.map((group) => (
        <section key={group.key} className={styles.group} aria-label={group.label || label}>
          {group.label ? <h4 className={styles.dayLabel}>{group.label}</h4> : null}
          <ul className={styles.list}>
            {group.entries.map((item) => (
              <li key={item.id} className={styles.entry}>
                {item.icon ? (
                  <span className={styles.systemIcon} aria-hidden="true">
                    {item.icon}
                  </span>
                ) : (
                  <Avatar name={item.actor} src={item.actorAvatar} size="sm" decorative />
                )}

                <div className={styles.body}>
                  <p className={styles.sentence}>
                    <span className={styles.actor}>{item.actor}</span>{' '}
                    <span className={styles.action}>{item.action}</span>
                    {item.target ? <span className={styles.target}> {item.target}</span> : null}
                  </p>
                  {item.detail ? <div className={styles.detail}>{item.detail}</div> : null}
                </div>

                <time className={styles.time}>{formatTime(item.timestamp)}</time>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
