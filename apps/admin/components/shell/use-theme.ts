'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemeAttribute,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ThemePreference,
} from './storage';

import './theme-boot';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
  cycle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useLayoutEffect(() => {
    const stored = readThemePreference();
    setPreferenceState(stored);
    setResolved(applyThemeAttribute(stored));
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      setResolved(applyThemeAttribute('system'));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((value: ThemePreference) => {
    writeThemePreference(value);
    setPreferenceState(value);
    setResolved(applyThemeAttribute(value));
  }, []);

  const cycle = useCallback(() => {
    setPreferenceState((current) => {
      const index = CYCLE.indexOf(current);
      const next = CYCLE[(index + 1) % CYCLE.length]!;
      writeThemePreference(next);
      setResolved(applyThemeAttribute(next));
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved: preference === 'system' ? resolveTheme('system') : resolved,
      setPreference,
      cycle,
    }),
    [cycle, preference, resolved, setPreference],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme debe usarse dentro de ThemeProvider');
  }
  return ctx;
}
