import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from './api';

const KEY = 'nexara_session';

export async function saveSession(session: AuthSession) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(KEY);
}

export function sessionExpired(session: AuthSession): boolean {
  if (!session.expiresAt) return false;
  return Date.now() >= session.expiresAt;
}

export function sessionExpiringSoon(session: AuthSession): boolean {
  if (!session.expiresAt) return false;
  const warnMs = 10 * 60 * 1000;
  return session.expiresAt - Date.now() <= warnMs;
}

export function tokenTimeLeftMs(session: AuthSession): number | null {
  if (!session.expiresAt) return null;
  return Math.max(0, session.expiresAt - Date.now());
}
