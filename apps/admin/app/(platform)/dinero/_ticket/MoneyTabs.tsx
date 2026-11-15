import Link from 'next/link';
import styles from '../../events/_ticket/frame.module.scss';

const TABS = [
  { id: 'comisiones', label: 'Comisiones', href: '/dinero/comisiones' },
  { id: 'cargos', label: 'Cargos por servicio', href: '/dinero/cargos' },
  { id: 'iva', label: 'IVA', href: '/dinero/iva' },
  { id: 'reembolsos', label: 'Reembolsos', href: '/dinero/reembolsos' },
] as const;

/** Pestañas de las reglas de dinero: comisiones, cargos, IVA y reembolsos. */
export function MoneyTabs({ current }: { current: (typeof TABS)[number]['id'] }) {
  return (
    <nav className={styles.tabs} aria-label="Reglas de dinero">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={tab.id === current ? styles.tabOn : styles.tab}
          aria-current={tab.id === current ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
