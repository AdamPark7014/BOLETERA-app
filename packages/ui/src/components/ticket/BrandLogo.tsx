import styles from './BrandLogo.module.scss';

export interface BrandLogoProps {
  /** Blanco sobre negro (por omisión) o dorado de marca. */
  tone?: 'white' | 'gold';
  /** Alto aproximado del «Black» en px. El «TICKET» escala con él. */
  size?: number;
  className?: string;
}

/**
 * Logo de Black Ticket: «Black» caligráfico sobre «★ TICKET ★» espaciado.
 * Pinyon Script aproxima la caligrafía hasta tener el trazo original.
 * Es texto (no imagen) para que se lea en lectores de pantalla y no pese.
 */
export function BrandLogo({ tone = 'white', size = 30, className }: BrandLogoProps) {
  return (
    <span
      className={[styles.logo, className].filter(Boolean).join(' ')}
      data-tone={tone}
      style={{ ['--logo-size' as string]: `${size}px` }}
      aria-label="Black Ticket"
      role="img"
    >
      <span className={styles.script} aria-hidden="true">
        Black
      </span>
      <span className={styles.word} aria-hidden="true">
        ★ TICKET ★
      </span>
    </span>
  );
}
