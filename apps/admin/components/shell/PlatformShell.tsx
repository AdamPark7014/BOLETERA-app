'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Skeleton } from '@boletera/ui';
import { usePrefetchNavigation } from '@/lib/prefetch';
import { useSession } from '@/lib/use-session';
import {
  ShellCommandPalette,
  type CommandPaletteMode,
} from './ShellCommandPalette';
import { ShellSidebar } from './ShellSidebar';
import { ShellTopbar } from './ShellTopbar';
import { ThemeProvider } from './use-theme';
import { useShellPrefs } from './use-shell-prefs';
import styles from '@/app/(platform)/shell.module.scss';

type PlatformShellProps = {
  children: ReactNode;
};

function SkipLink() {
  return (
    <a href="#contenido-principal" className={styles.skipLink}>
      Saltar al contenido
    </a>
  );
}

function ShellLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-live="polite">
      <div className={styles.loadingSidebar} aria-hidden="true">
        <Skeleton shape="rect" height={40} width="80%" />
        <Skeleton shape="rect" height={32} width="100%" delay={40} />
        <Skeleton shape="rect" height={32} width="90%" delay={80} />
        <Skeleton shape="rect" height={32} width="95%" delay={120} />
      </div>
      <div className={styles.content}>
        <div className={styles.loadingTopbar}>
          <Skeleton shape="text" width={180} height={16} />
        </div>
        <main className={styles.main}>
          <Skeleton shape="text" width="40%" height={28} />
          <Skeleton shape="rect" height={160} delay={60} />
        </main>
      </div>
    </div>
  );
}

function PlatformShellInner({ children }: PlatformShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const { linkProps } = usePrefetchNavigation();
  const prefs = useShellPrefs();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandMode, setCommandMode] = useState<CommandPaletteMode>('all');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCompact = prefs.toggleCompact;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '[' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
          return;
        }
        event.preventDefault();
        toggleCompact();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleCompact]);

  const openCommand = useCallback(() => {
    setCommandMode('all');
    setCommandOpen(true);
  }, []);

  const openShortcuts = useCallback(() => {
    setCommandMode('shortcuts');
    setCommandOpen(true);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  if (status === 'loading') {
    return <ShellLoading />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <div className={styles.shell}>
      <SkipLink />
      <ShellSidebar
        pathname={pathname}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
        prefs={prefs}
        linkProps={linkProps}
        onOpenCommand={openCommand}
        onOpenShortcuts={openShortcuts}
      />

      <div className={styles.content}>
        <ShellTopbar
          pathname={pathname}
          onOpenMobile={openMobile}
          onOpenCommand={openCommand}
          linkProps={linkProps}
        />
        <main id="contenido-principal" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <button
          type="button"
          className={styles.overlay}
          aria-label="Cerrar menú"
          onClick={closeMobile}
        />
      ) : null}

      <ShellCommandPalette
        open={commandOpen}
        onOpenChange={(open) => {
          setCommandOpen(open);
          if (!open) setCommandMode('all');
        }}
        mode={commandMode}
        onToggleCompact={prefs.toggleCompact}
      />
    </div>
  );
}

function PlatformShellComponent({ children }: PlatformShellProps) {
  return (
    <ThemeProvider>
      <PlatformShellInner>{children}</PlatformShellInner>
    </ThemeProvider>
  );
}

export const PlatformShell = memo(PlatformShellComponent);
