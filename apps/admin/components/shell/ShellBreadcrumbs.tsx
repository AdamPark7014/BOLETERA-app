'use client';

import Link from 'next/link';
import { memo } from 'react';
import type { BreadcrumbCrumb } from './routes';
import styles from '@/app/(platform)/shell.module.scss';

type ShellBreadcrumbsProps = {
  crumbs: readonly BreadcrumbCrumb[];
  linkProps: (href: string) => {
    onMouseEnter: () => void;
    onFocus: () => void;
  };
};

function ShellBreadcrumbsComponent({ crumbs, linkProps }: ShellBreadcrumbsProps) {
  return (
    <nav className={styles.crumbs} aria-label="Migas de pan">
      <ol className={styles.crumbsList}>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className={styles.crumbItem}>
              {index > 0 ? (
                <span className={styles.crumbSep} aria-hidden="true">
                  /
                </span>
              ) : null}
              {crumb.href && !isLast ? (
                <Link href={crumb.href} {...linkProps(crumb.href)}>
                  {crumb.label}
                </Link>
              ) : (
                <span className={isLast ? styles.crumbCurrent : undefined} aria-current={isLast ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export const ShellBreadcrumbs = memo(ShellBreadcrumbsComponent);
