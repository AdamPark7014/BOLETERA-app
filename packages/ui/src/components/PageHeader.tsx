import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './PageHeader.module.scss';

/** Eslabon de la ruta de navegacion. Sin `href` se dibuja como texto plano. */
export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Titulo de la pantalla. */
  title: ReactNode;
  /** Micro-etiqueta sobre el titulo (seccion, tipo de entidad, estado). */
  eyebrow?: ReactNode;
  /** Parrafo explicativo bajo el titulo. */
  description?: ReactNode;
  /** Ruta de navegacion. Se marca el ultimo eslabon con `aria-current`. */
  breadcrumbs?: readonly Breadcrumb[];
  /** Acciones principales alineadas a la derecha. */
  actions?: ReactNode;
  /** Contenido bajo el encabezado: pestanas, filtros o KPIs. */
  children?: ReactNode;
  /** Anade una linea divisoria inferior. */
  bordered?: boolean;
}

/**
 * Encabezado estandar de pantalla. Fija la jerarquia tipografica de todo el
 * panel: migas, eyebrow, titulo `h1`, descripcion y acciones.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  breadcrumbs,
  actions,
  children,
  bordered = true,
  className,
  ...rest
}: PageHeaderProps) {
  return (
    <header className={cx(styles.header, bordered && styles.bordered, className)} {...rest}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Ruta de navegacion" className={styles.breadcrumbs}>
          <ol className={styles.crumbList}>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className={styles.crumb}>
                  {crumb.href && !isLast ? (
                    <a href={crumb.href} className={styles.crumbLink}>
                      {crumb.label}
                    </a>
                  ) : (
                    <span aria-current={isLast ? 'page' : undefined}>{crumb.label}</span>
                  )}
                  {isLast ? null : (
                    <span className={styles.separator} aria-hidden="true">
                      /
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className={styles.main}>
        <div className={styles.text}>
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h1 className={styles.title}>{title}</h1>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>

      {children ? <div className={styles.extra}>{children}</div> : null}
    </header>
  );
}
