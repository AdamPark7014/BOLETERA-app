'use client';

import { useState, type CSSProperties, type HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { vizColor } from '../styles/tokens';
import styles from './Avatar.module.scss';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Nombre completo. Genera iniciales y color estable, y sirve de texto alternativo. */
  name: string;
  /** URL de la foto. Si falla la carga se cae a las iniciales. */
  src?: string;
  /** Diametro. Por defecto `md`. */
  size?: AvatarSize;
  /** Forma. `circle` para personas, `square` para organizaciones. */
  shape?: 'circle' | 'square';
  /**
   * Marca el avatar como decorativo. Usalo cuando el nombre ya aparece como
   * texto al lado, para no duplicar el anuncio en lectores de pantalla.
   */
  decorative?: boolean;
}

/** Hash determinista para asignar siempre el mismo color a la misma persona. */
function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Hasta dos iniciales a partir de la primera y ultima palabra del nombre. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Avatar con respaldo automatico a iniciales coloreadas de forma estable. */
export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  decorative = false,
  className,
  style,
  ...rest
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  const fallbackStyle: CSSProperties = showImage
    ? {}
    : { '--avatar-color': vizColor(hashCode(name)) } as CSSProperties;

  return (
    <span
      className={cx(styles.avatar, styles[size], styles[shape], className)}
      style={{ ...fallbackStyle, ...style }}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
      title={name}
      {...rest}
    >
      {showImage ? (
        <img className={styles.image} src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className={styles.initials}>{initialsOf(name)}</span>
      )}
    </span>
  );
}
