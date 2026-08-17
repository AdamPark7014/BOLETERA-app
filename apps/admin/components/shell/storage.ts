const KEYS = {
  theme: 'ticketos.admin.theme',
  collapsed: 'ticketos.admin.nav.collapsed',
  favorites: 'ticketos.admin.nav.favorites',
  compact: 'ticketos.admin.nav.compact',
  readAlerts: 'ticketos.admin.alerts.read',
} as const;

export type ThemePreference = 'light' | 'dark' | 'system';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJsonArray(key: string): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function writeJsonArray(key: string, value: readonly string[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readThemePreference(): ThemePreference {
  if (!canUseStorage()) return 'system';
  const raw = window.localStorage.getItem(KEYS.theme);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function writeThemePreference(value: ThemePreference): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(KEYS.theme, value);
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply theme attribute immediately (used by boot + provider). */
export function applyThemeAttribute(preference: ThemePreference): 'light' | 'dark' {
  const resolved = resolveTheme(preference);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', preference);
  }
  return resolved;
}

export function readCollapsedGroups(): string[] {
  return readJsonArray(KEYS.collapsed);
}

export function writeCollapsedGroups(ids: readonly string[]): void {
  writeJsonArray(KEYS.collapsed, ids);
}

export function readFavorites(): string[] {
  return readJsonArray(KEYS.favorites);
}

export function writeFavorites(hrefs: readonly string[]): void {
  writeJsonArray(KEYS.favorites, hrefs);
}

export function readCompact(): boolean {
  if (!canUseStorage()) return false;
  return window.localStorage.getItem(KEYS.compact) === '1';
}

export function writeCompact(value: boolean): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(KEYS.compact, value ? '1' : '0');
}

export function readReadAlertIds(): string[] {
  return readJsonArray(KEYS.readAlerts);
}

export function writeReadAlertIds(ids: readonly string[]): void {
  writeJsonArray(KEYS.readAlerts, ids);
}
