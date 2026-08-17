'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { getLastReceipt, printReceipt } from '@/lib/pos';
import { useHotkeys, type Hotkey } from '@/lib/hotkeys';
import { HotkeyBar } from './HotkeyBar';
import { NetStatus, useOpsStatus } from './NetStatus';
import styles from './PosShell.module.scss';

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
  const status = useOpsStatus();
  const width = size ?? (wide ? 'wide' : 'sm');
  const pageClass =
    width === 'wide' ? styles.pageWide : width === 'md' ? styles.pageMd : styles.page;

  const globalHotkeys = useMemo<Hotkey[]>(
    () => [
      // Si la pantalla ya declara sus propios atajos, la barra los muestra a
      // ellos: mezclar navegación global con la acción en curso confunde más
      // de lo que ayuda. `?` sigue enseñando el catálogo completo.
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
    <div className={pageClass}>
      <div className={styles.bg} aria-hidden />
      <header className={styles.header}>
        <Link href={backHref} className={styles.back} aria-label="Volver">
          ←
        </Link>
        <div className={styles.headerCenter}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <div className={styles.headerRight}>
          {headerExtra}
          <NetStatus status={status} />
        </div>
      </header>
      <div className={styles.body}>{children}</div>
      <HotkeyBar hotkeys={merged} enabled={hotkeysEnabled} />
    </div>
  );
}
