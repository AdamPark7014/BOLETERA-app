'use client';

import { memo, useState, type ReactNode } from 'react';
import styles from '../VenueBuilder.module.scss';

export const PanelSection = memo(function PanelSection({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.panelSection}>
      <button
        type="button"
        className={styles.panelHeader}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={styles.panelTitle}>{title}</span>
        {badge && <span className={styles.panelBadge}>{badge}</span>}
        <span className={styles.panelChevron} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className={styles.panelBody}>{children}</div>}
    </section>
  );
});

export const Field = memo(function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
});
