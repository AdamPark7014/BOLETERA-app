'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { getOrgName, getTerminalLabel, getTaquillaUser } from '@/lib/auth';
import { connectSerialPrinter } from '@/lib/thermal';
import { getLastReceipt, printReceipt } from '@/lib/pos';
import { useHotkeys, type Hotkey } from '@/lib/hotkeys';
import { HotkeyBar } from './HotkeyBar';
import { NetStatus, useOpsStatus } from './NetStatus';
import styles from './PosShell.module.scss';

type PaletteItem = {
  label: string;
  keys: string;
  run: () => void;
};

/**
 * Marco de la ventanilla. Barra de tinta, wordmark en hueso, terminal y cajero
 * en mono. La paleta (Ctrl+K) guarda lo que no es el camino de la venta.
 */
export function PosShell({
  title,
  eyebrow,
  backHref = '/venta',
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
  const status = useOpsStatus();
  const width = size ?? (wide ? 'wide' : 'sm');
  const pageClass =
    width === 'wide' ? styles.pageWide : width === 'md' ? styles.pageMd : styles.page;

  const [terminalLabel, setTerminalLabel] = useState('TAQ-01');
  const [cashierName, setCashierName] = useState('Cajero');
  const [time, setTime] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);

  useEffect(() => {
    setTerminalLabel(getTerminalLabel());
    const user = getTaquillaUser();
    setCashierName(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : getOrgName(),
    );
  }, []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const palette = useMemo<PaletteItem[]>(
    () => [
      { label: 'Cortesía', keys: 'C', run: () => router.push('/venta?comp=1') },
      { label: 'Reimprimir', keys: 'F7', run: () => {
        const receipt = getLastReceipt();
        if (receipt) void printReceipt(receipt);
      } },
      { label: 'Entregar', keys: 'F4', run: () => router.push('/willcall') },
      { label: 'Buscar boleto', keys: 'F3', run: () => router.push('/buscar') },
      { label: 'Corte de caja', keys: 'F12', run: () => router.push('/corte') },
      { label: 'Funciones', keys: 'F2', run: () => router.push('/venta') },
      { label: 'Conectar impresora', keys: '', run: () => void connectSerialPrinter() },
    ],
    [router],
  );

  const globalHotkeys = useMemo<Hotkey[]>(
    () => [
      {
        keys: 'F1',
        label: 'Venta',
        whileTyping: true,
        hidden: true,
        run: () => router.push('/venta'),
      },
      {
        keys: 'Ctrl+K',
        label: 'Paleta',
        whileTyping: true,
        hidden: true,
        match: (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k',
        run: () => {
          setPaletteIndex(0);
          setPaletteOpen(true);
        },
      },
      {
        keys: 'F2',
        label: 'Funciones',
        whileTyping: true,
        hidden: true,
        run: () => router.push('/venta'),
      },
      { keys: 'F3', label: 'Buscar', whileTyping: true, hidden: true, run: () => router.push('/buscar') },
      { keys: 'F4', label: 'Entregar', whileTyping: true, hidden: true, run: () => router.push('/willcall') },
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
              hidden: true,
              match: (e: KeyboardEvent) => e.key === 'Escape',
              run: () => router.push(backHref),
            } satisfies Hotkey,
          ]
        : []),
    ],
    [router, backHref, escapeGoesBack],
  );

  const paletteHotkeys = useMemo<Hotkey[]>(
    () =>
      paletteOpen
        ? [
            {
              keys: 'Esc',
              label: 'Cerrar paleta',
              whileTyping: true,
              hidden: true,
              match: (e) => e.key === 'Escape',
              run: () => setPaletteOpen(false),
            },
            {
              keys: '↑↓',
              label: 'Mover',
              whileTyping: true,
              hidden: true,
              match: (e) => e.key === 'ArrowDown' || e.key === 'ArrowUp',
              run: (e) => {
                setPaletteIndex((i) => {
                  const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
                  return (next + palette.length) % palette.length;
                });
              },
            },
            {
              keys: 'Enter',
              label: 'Abrir',
              whileTyping: true,
              hidden: true,
              match: (e) => e.key === 'Enter',
              run: () => {
                palette[paletteIndex]?.run();
                setPaletteOpen(false);
              },
            },
          ]
        : [],
    [paletteOpen, palette, paletteIndex],
  );

  const merged = useMemo(
    () => [...paletteHotkeys, ...hotkeys, ...globalHotkeys],
    [paletteHotkeys, hotkeys, globalHotkeys],
  );
  useHotkeys(merged, hotkeysEnabled);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/venta" className={styles.wordmark}>
          Black Ticket
        </Link>
        <p className={styles.who}>
          {terminalLabel} · {cashierName}
        </p>
        <p className={styles.clock}>{time}</p>
        <NetStatus status={status} />
      </header>

      <div className={styles.frame}>
        <div className={pageClass}>
          <header className={styles.viewHead}>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            <h1 className={styles.viewTitle}>{title}</h1>
            {headerExtra}
          </header>
          <div className={styles.body}>{children}</div>
        </div>
      </div>

      <HotkeyBar hotkeys={merged} enabled={hotkeysEnabled} />

      {paletteOpen ? (
        <div className={styles.paletteScrim} role="presentation" onClick={() => setPaletteOpen(false)}>
          <div
            className={styles.palette}
            role="dialog"
            aria-label="Paleta"
            onClick={(e) => e.stopPropagation()}
          >
            <ul className={styles.paletteList}>
              {palette.map((item, i) => (
                <li key={item.label}>
                  <button
                    type="button"
                    className={i === paletteIndex ? styles.paletteOn : styles.paletteRow}
                    onMouseEnter={() => setPaletteIndex(i)}
                    onClick={() => {
                      item.run();
                      setPaletteOpen(false);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.keys ? <kbd>{item.keys}</kbd> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
