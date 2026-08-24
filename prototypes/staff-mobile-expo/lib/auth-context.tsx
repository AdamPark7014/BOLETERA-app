import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { router } from 'expo-router';
import { ReauthOverlay } from '@/components/ReauthModal';
import { login as apiLogin, setApiToken, setUnauthorizedHandler, type AuthSession } from './api';
import {
  clearSession,
  loadSession,
  saveSession,
  sessionExpired,
  sessionExpiringSoon,
  tokenTimeLeftMs,
} from './session';

type AuthContextValue = {
  session: AuthSession | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: (email: string, password: string) => Promise<boolean>;
  expiringSoon: boolean;
  timeLeftMs: number | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [reauthVisible, setReauthVisible] = useState(false);
  const reauthResolver = useRef<((ok: boolean) => void) | null>(null);
  const pendingReauth = useRef<Promise<boolean> | null>(null);

  const hydrate = useCallback(async () => {
    const stored = await loadSession();
    if (stored && sessionExpired(stored)) {
      await clearSession();
      setSession(null);
    } else {
      setSession(stored);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const requestReauth = useCallback((): Promise<boolean> => {
    if (pendingReauth.current) return pendingReauth.current;
    pendingReauth.current = new Promise<boolean>((resolve) => {
      reauthResolver.current = resolve;
      setReauthVisible(true);
    });
    return pendingReauth.current;
  }, []);

  useEffect(() => {
    setApiToken(session?.token ?? null);
  }, [session?.token]);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      if (!session) return false;
      return requestReauth();
    });
    return () => setUnauthorizedHandler(null);
  }, [session, requestReauth]);

  // Periodic expiry check
  useEffect(() => {
    if (!session?.expiresAt) return;
    const tick = () => {
      if (sessionExpired(session)) {
        requestReauth();
      }
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [session, requestReauth]);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await apiLogin(email, password);
    await saveSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    router.replace('/(auth)/login');
  }, []);

  const refreshSession = useCallback(async (email: string, password: string) => {
    try {
      const next = await apiLogin(email, password);
      await saveSession(next);
      setSession(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  const finishReauth = useCallback(
    async (email: string, password: string) => {
      const ok = await refreshSession(email, password);
      setReauthVisible(false);
      reauthResolver.current?.(ok);
      reauthResolver.current = null;
      pendingReauth.current = null;
      if (!ok) await signOut();
      return ok;
    },
    [refreshSession, signOut],
  );

  const cancelReauth = useCallback(async () => {
    setReauthVisible(false);
    reauthResolver.current?.(false);
    reauthResolver.current = null;
    pendingReauth.current = null;
    await signOut();
  }, [signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      ready,
      signIn,
      signOut,
      refreshSession,
      expiringSoon: session ? sessionExpiringSoon(session) : false,
      timeLeftMs: session ? tokenTimeLeftMs(session) : null,
    }),
    [session, ready, signIn, signOut, refreshSession],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {reauthVisible && session ? (
        <ReauthOverlay
          email={session.email}
          onSubmit={finishReauth}
          onCancel={cancelReauth}
          expired={sessionExpired(session)}
        />
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
