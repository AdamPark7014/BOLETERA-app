'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BlackTicketRoot, Field, TicketButton } from '@boletera/ui';
import { logoutSession } from '@/lib/http';
import { activeIndexId, eventIdFromPath, indexGroups } from './catalog';
import styles from './frame.module.scss';

type FrameValue = {
  query: string;
  eventId: string | null;
  section: string;
};

const FrameContext = createContext<FrameValue>({ query: '', eventId: null, section: 'lista' });

export function useAdminFrame(): FrameValue {
  return useContext(FrameContext);
}

export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const eventId = eventIdFromPath(pathname);
  const sectionParam = search.get('seccion');
  const section = eventId ? (sectionParam ?? 'evento') : (activeIndexId(pathname, sectionParam) ?? 'lista');
  const active = activeIndexId(pathname, sectionParam);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return indexGroups(eventId)
      .map((group) => ({
        ...group,
        items: needle
          ? group.items.filter((item) => item.label.toLowerCase().includes(needle))
          : group.items,
      }))
      .filter((group) => group.items.length > 0);
  }, [eventId, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      event.preventDefault();
      document.getElementById('indice-buscar')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const nodes = document.querySelectorAll<HTMLElement>('[data-param]');
    const hit = [...nodes].find((node) => (node.dataset.param ?? '').toLowerCase().includes(needle));
    hit?.scrollIntoView({ block: 'nearest' });
  }, [query, section]);

  async function salir() {
    await logoutSession();
    router.replace('/login');
  }

  return (
    <BlackTicketRoot density="admin" className={styles.root}>
      <FrameContext.Provider value={{ query, eventId, section }}>
        <div className={styles.frame}>
          <nav className={styles.index} aria-label="Oficios">
            <Link href="/events" className={styles.wordmark}>
              Black Ticket
            </Link>
            <Field
              id="indice-buscar"
              label="Buscar"
              kind="search"
              value={query}
              placeholder="Nombre del parámetro"
              onChange={(event) => setQuery(event.target.value)}
            />
            {groups.map((group) => (
              <div key={group.id} className={styles.group}>
                <p className={styles.groupLabel}>{group.label}</p>
                <ul className={styles.groupList}>
                  {group.items.map((item) => {
                    const current = item.id === active;
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className={current ? styles.current : styles.link}
                          aria-current={current ? 'page' : undefined}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {groups.length === 0 ? <p className={styles.quiet}>Nada con ese criterio.</p> : null}
            <TicketButton variant="ghost" onClick={() => void salir()}>
              Salir
            </TicketButton>
          </nav>
          <div className={styles.canvas}>{children}</div>
        </div>
      </FrameContext.Provider>
    </BlackTicketRoot>
  );
}
