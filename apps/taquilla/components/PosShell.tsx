'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@boletera/ui';
import { getTerminalLabel, getTaquillaUser } from '@/lib/auth';
import { getLastReceipt, printReceipt } from '@/lib/pos';
import { useHotkeys, type Hotkey } from '@/lib/hotkeys';
import { HotkeyBar } from './HotkeyBar';
import { NetStatus, useOpsStatus } from './NetStatus';
import styles from './PosShell.module.scss';

type NavItem = {
  href: string;
  label: string;
  keys: string;
  icon: React.ReactNode;
};

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--bl-accent)" />
      <path d="M9 11h14M9 16h14M9 21h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="22" cy="21" r="2.5" fill="#fff" />
    </svg>
  );
}

function IconVenta() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 10h10M7 14h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconEventos() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconBuscar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconWillCall() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4V3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconAcceso() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconCorte() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 12h2M15 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: '/venta', label: 'Venta', keys: 'F1', icon: <IconVenta /> },
  { href: '/eventos', label: 'Eventos', keys: 'F2', icon: <IconEventos /> },
  { href: '/buscar', label: 'Buscar', keys: 'F3', icon: <IconBuscar /> },
  { href: '/willcall', label: 'Will-call', keys: 'F4', icon: <IconWillCall /> },
  { href: '/acceso', label: 'Acceso', keys: 'F6', icon: <IconAcceso /> },
  { href: '/corte', label: 'Corte', keys: 'F12', icon: <IconCorte /> },
];

/**
 * Marco común de las pantallas de taquilla.
 *
 * Aporta tres cosas que deben estar SIEMPRE: estado de red y pendientes de
 * sincronizar, atajos globales de navegación y la barra de atajos visible.
 * Los atajos de la pantalla se evalúan ANTES que los globales, así que una
 * pantalla puede quedarse con F1-F6 (billetes rápidos, por ejemplo) sin
 * pelearse con la navegación.
 */
export function PosShell({
  title,
  eyebrow = 'Taquilla',
  backHref = '/',
  children,
  wide = false,
  size,
  hotkeys = [],
  /** `false` cuando la pantalla ya usa Escape para retroceder de paso. */
  escapeGoesBack = true,
  /** `false` mientras hay un diálogo modal encima (PIN, reautenticación). */
  hotkeysEnabled = true,
  headerExtra,
}: {
  title: string;
  eyebrow?: string;
  backHref?: string;
  children: React.ReactNode;
  wide?: boolean;
  size?: 'sm' | 'md' | 'wide';
  hotkeys?: Hotkey[];
  escapeGoesBack?: boolean;
  hotkeysEnabled?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useOpsStatus();
  const width = size ?? (wide ? 'wide' : 'sm');
  const pageClass =
    width === 'wide' ? styles.pageWide : width === 'md' ? styles.pageMd : styles.page;

  const [terminalLabel, setTerminalLabel] = useState('TAQ-01');
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    setTerminalLabel(getTerminalLabel());
    const user = getTaquillaUser();
    setCashierName(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : null,
    );
  }, []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(d.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const globalHotkeys = useMemo<Hotkey[]>(
    () => [
      {
        keys: 'F1',
        label: 'Venta',
        whileTyping: true,
        hidden: hotkeys.length > 0,
        run: () => router.push('/venta'),
      },
      { keys: 'F2', label: 'Eventos', whileTyping: true, hidden: true, run: () => router.push('/eventos') },
      { keys: 'F3', label: 'Buscar', whileTyping: true, hidden: true, run: () => router.push('/buscar') },
      { keys: 'F4', label: 'Will-call', whileTyping: true, hidden: true, run: () => router.push('/willcall') },
      { keys: 'F6', label: 'Acceso', whileTyping: true, hidden: true, run: () => router.push('/acceso') },
      {
        keys: 'F7',
        label: 'Reimprimir',
        whileTyping: true,
        hidden: true,
        run: () => {
          const receipt = getLastReceipt();
          if (receipt) void printReceipt(receipt);
        },
      },
      { keys: 'F12', label: 'Corte', whileTyping: true, hidden: true, run: () => router.push('/corte') },
      ...(escapeGoesBack
        ? [
            {
              keys: 'Esc',
              label: 'Volver',
              whileTyping: true,
              match: (e: KeyboardEvent) => e.key === 'Escape',
              run: () => router.push(backHref),
            } satisfies Hotkey,
          ]
        : []),
    ],
    [router, backHref, escapeGoesBack, hotkeys.length],
  );

  const merged = useMemo(() => [...hotkeys, ...globalHotkeys], [hotkeys, globalHotkeys]);
  useHotkeys(merged, hotkeysEnabled);

  return (
    <div className={styles.shell}>
      <div className={styles.bg} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <Link href="/" className={styles.brand} aria-label="Inicio taquilla">
            <BrandMark />
            <span>BOLETERA · TAQUILLA</span>
          </Link>
          <Badge tone="accent" variant="soft" className={styles.terminalBadge}>
            {terminalLabel}
          </Badge>
        </div>

        <div className={styles.topCenter}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.pageTitle}>{title}</h1>
        </div>

        <div className={styles.topRight}>
          {cashierName && (
            <span className={styles.cashier}>
              <small>Cajero</small>
              <strong>{cashierName}</strong>
            </span>
          )}
          <span className={styles.clock}>
            <strong>{time}</strong>
            <small>{date}</small>
          </span>
          {headerExtra}
          <NetStatus status={status} />
          {backHref !== pathname && pathname != null && (
            <Link href={backHref} className={styles.homeBtn} aria-label="Volver al inicio">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          )}
        </div>
      </header>

      <div className={styles.frame}>
        <nav className={styles.sidebar} aria-label="Módulos de taquilla">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname != null &&
              (pathname === item.href || pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.navActive : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
                <kbd className={styles.navKey}>{item.keys}</kbd>
              </Link>
            );
          })}
        </nav>

        <div className={pageClass}>
          <div className={styles.body}>{children}</div>
        </div>
      </div>

      <HotkeyBar hotkeys={merged} enabled={hotkeysEnabled} />
    </div>
  );
}
