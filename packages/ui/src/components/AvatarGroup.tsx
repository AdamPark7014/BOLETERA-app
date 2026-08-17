import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { Avatar, type AvatarSize } from './Avatar';
import styles from './AvatarGroup.module.scss';

/** Persona representada dentro de un {@link AvatarGroup}. */
export interface AvatarGroupMember {
  id: string;
  name: string;
  src?: string;
}

export interface AvatarGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  members: readonly AvatarGroupMember[];
  /** Cuantos avatares se muestran antes del contador `+N`. Por defecto 4. */
  max?: number;
  /** Diametro de cada avatar. Por defecto `sm`. */
  size?: AvatarSize;
  /** Etiqueta del grupo para lectores de pantalla. */
  label?: string;
}

/**
 * Pila de avatares superpuestos con contador de excedente.
 * El grupo se anuncia como una sola lista; los avatares individuales quedan
 * como decorativos para no leer 40 nombres seguidos.
 */
export function AvatarGroup({
  members,
  max = 4,
  size = 'sm',
  label = 'Participantes',
  className,
  ...rest
}: AvatarGroupProps) {
  const visible = members.slice(0, Math.max(1, max));
  const overflow = members.length - visible.length;
  const names = members.map((member) => member.name).join(', ');

  return (
    <div
      className={cx(styles.group, styles[size], className)}
      role="group"
      aria-label={`${label}: ${names || 'ninguno'}`}
      {...rest}
    >
      {visible.map((member) => (
        <Avatar
          key={member.id}
          className={styles.item}
          name={member.name}
          src={member.src}
          size={size}
          decorative
        />
      ))}
      {overflow > 0 ? (
        <span className={cx(styles.item, styles.overflow)} aria-hidden="true">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
