'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readCollapsedGroups,
  readCompact,
  readFavorites,
  writeCollapsedGroups,
  writeCompact,
  writeFavorites,
} from './storage';
import { NAV_GROUPS } from './nav-config';

export type ShellPrefs = {
  compact: boolean;
  setCompact: (value: boolean) => void;
  toggleCompact: () => void;
  collapsed: ReadonlySet<string>;
  toggleGroup: (groupId: string) => void;
  isGroupCollapsed: (groupId: string) => boolean;
  favorites: readonly string[];
  toggleFavorite: (href: string) => void;
  isFavorite: (href: string) => boolean;
};

function defaultCollapsed(): Set<string> {
  const stored = readCollapsedGroups();
  if (stored.length > 0) return new Set(stored);
  return new Set(
    NAV_GROUPS.filter((group) => group.defaultCollapsed).map((group) => group.id),
  );
}

export function useShellPrefs(): ShellPrefs {
  const [compact, setCompactState] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCompactState(readCompact());
    setCollapsed(defaultCollapsed());
    setFavorites(readFavorites());
    setHydrated(true);
  }, []);

  const setCompact = useCallback((value: boolean) => {
    setCompactState(value);
    writeCompact(value);
  }, []);

  const toggleCompact = useCallback(() => {
    setCompactState((prev) => {
      const next = !prev;
      writeCompact(next);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      writeCollapsedGroups([...next]);
      return next;
    });
  }, []);

  const isGroupCollapsed = useCallback(
    (groupId: string) => {
      if (!hydrated) {
        return Boolean(NAV_GROUPS.find((g) => g.id === groupId)?.defaultCollapsed);
      }
      return collapsed.has(groupId);
    },
    [collapsed, hydrated],
  );

  const toggleFavorite = useCallback((href: string) => {
    setFavorites((prev) => {
      const next = prev.includes(href)
        ? prev.filter((item) => item !== href)
        : [...prev, href];
      writeFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (href: string) => favorites.includes(href),
    [favorites],
  );

  return useMemo(
    () => ({
      compact,
      setCompact,
      toggleCompact,
      collapsed,
      toggleGroup,
      isGroupCollapsed,
      favorites,
      toggleFavorite,
      isFavorite,
    }),
    [
      compact,
      setCompact,
      toggleCompact,
      collapsed,
      toggleGroup,
      isGroupCollapsed,
      favorites,
      toggleFavorite,
      isFavorite,
    ],
  );
}
