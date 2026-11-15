'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BrandLogo, formatTicketAmount } from '@boletera/ui';
import { getOrgName, getTerminalLabel, getTaquillaToken, getTaquillaUser } from '@/lib/auth';
import { connectSerialPrinter } from '@/lib/thermal';
import {
  fetchSessionSummary,
  getLastReceipt,
  getSessionId,
  printReceipt,
  type SessionSummary,
} from '@/lib/pos';
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
  fill = false,
  door = false,
  whoMain,
  whoSub,
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
  /** Pantalla de trabajo a alto completo (venta): sin título y sin desplazar la página. */
  fill?: boolean;
  /** Puerta de acceso: sin ventas del turno ni botones de caja. */
  door?: boolean;
  whoMain?: string;
  whoSub?: string;
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
  const [shift, setShift] = useState<SessionSummary | null>(null);
  const [cashierShort, setCashierShort] = useState('');
  const [orgName, setOrgName] = useState('');

  useEffect(() => {
    setTerminalLabel(getTerminalLabel());
    const org = getOrgName();
    setOrgName(org === 'TAQUILLA' ? '' : org);
    const user = getTaquillaUser();
    setCashierName(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : getOrgName()
    );
    setCashierShort(
      user
        ? [user.firstName, user.lastName ? `${user.lastName.charAt(0)}.` : '']
            .filter(Boolean)
            .join(' ') || user.email
        : ''
    );
  }, []);

  // Resumen del turno para la barra: se pide al entrar, cada 30 s y cuando la
  // venta avisa que cobró. Sin turno abierto o sin red la barra no inventa cifras.
  useEffect(() => {
    let alive = true;
    const load = () => {
      const sessionId = getSessionId();
      if (!sessionId || !getTaquillaToken() || !navigator.onLine) return;
      fetchSessionSummary(sessionId)
        .then((data) => {
          if (alive) setShift(data);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 30000);
    window.addEventListener('bt-shift-refresh', load);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('bt-shift-refresh', load);
    };
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
      {
        label: 'Reimprimir',
        keys: 'F7',
        run: () => {
          const receipt = getLastReceipt();
          if (receipt) void printReceipt(receipt);
        },
      },
      { label: 'Entregar', keys: 'F4', run: () => router.push('/willcall') },
      { label: 'Buscar boleto', keys: 'F3', run: () => router.push('/buscar') },
      { label: 'Corte de caja', keys: 'F12', run: () => router.push('/corte') },
      { label: 'Funciones', keys: 'F2', run: () => router.push('/venta') },
      { label: 'Conectar impresora', keys: '', run: () => void connectSerialPrinter() },
    ],
    [router]
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
      {
        keys: 'F3',
        label: 'Buscar',
        whileTyping: true,
        hidden: true,
        run: () => router.push('/buscar'),
      },
      {
        keys: 'F4',
        label: 'Entregar',
        whileTyping: true,
        hidden: true,
        run: () => router.push('/willcall'),
      },
      {
        keys: 'F6',
        label: 'Acceso',
        whileTyping: true,
        hidden: true,
        run: () => router.push('/acceso'),
      },
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
      {
        keys: 'F12',
        label: 'Corte',
        whileTyping: true,
        hidden: true,
        run: () => router.push('/corte'),
      },
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
    [router, backHref, escapeGoesBack]
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
    [paletteOpen, palette, paletteIndex]
  );

  const merged = useMemo(
    () => [...paletteHotkeys, ...hotkeys, ...globalHotkeys],
    [paletteHotkeys, hotkeys, globalHotkeys]
  );
  useHotkeys(merged, hotkeysEnabled);

  const openedAt = shift?.startTime
    ? new Date(shift.startTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : null;
  const shiftLine = [
    cashierShort ? `Turno de ${cashierShort}` : cashierName,
    openedAt ? `abierto ${openedAt}` : null,
    shift ? `fondo ${formatTicketAmount(Number(shift.openingCash) || 0)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={fill ? styles.shellFill : styles.shell}>
      <header className={styles.topbar}>
        <Link href="/venta" className={styles.brand} aria-label="Black Ticket, venta">
          <BrandLogo tone="gold" size={26} />
        </Link>
        <div className={styles.who}>
          <span className={styles.whoMain}>
            {whoMain ?? `${terminalLabel}${orgName ? ` · ${orgName}` : ''}`}
          </span>
          <span className={styles.whoSub}>{whoSub ?? shiftLine}</span>
        </div>
        <div className={styles.topRight}>
          <NetStatus status={status} />
          {shift && !door ? (
            <div className={styles.sales}>
              <span>Ventas del turno</span>
              <strong>
                {formatTicketAmount(Number(shift.totalRevenue) || 0)} ·{' '}
                {shift.totalTransactions.toLocaleString('es-MX')}{' '}
                {shift.totalTransactions === 1 ? 'venta' : 'ventas'}
              </strong>
            </div>
          ) : null}
          {door ? null : (
            <>
              <Link href="/willcall" className={styles.topBtn}>
                Entregar boletos <kbd>F4</kbd>
              </Link>
              <Link href="/corte" className={styles.topBtn}>
                Corte <kbd>F12</kbd>
              </Link>
            </>
          )}
          <p className={styles.clock}>{time}</p>
        </div>
      </header>

      <div className={styles.frame}>
        <div className={fill ? styles.pageFill : pageClass}>
          {fill ? null : (
            <header className={styles.viewHead}>
              {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
              <h1 className={styles.viewTitle}>{title}</h1>
              {headerExtra}
            </header>
          )}
          {fill ? <h1 className={styles.srOnly}>{title}</h1> : null}
          <div className={fill ? styles.bodyFill : styles.body}>{children}</div>
        </div>
      </div>

      <HotkeyBar hotkeys={merged} enabled={hotkeysEnabled} />

      {paletteOpen ? (
        <div
          className={styles.paletteScrim}
          role="presentation"
          onClick={() => setPaletteOpen(false)}
        >
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
