'use client';

/**
 * Contexto de sesión del backoffice.
 *
 * Resuelve cuatro problemas que dejó el endurecimiento del API:
 *  1. El JWT dura 2 h y se revoca al cambiar el usuario, así que un 401 es
 *     rutina. Antes cada pantalla lo tragaba con `.catch(() => setX([]))` y el
 *     operador se quedaba mirando una tabla vacía sin saber por qué.
 *  2. Reautenticar no debe perder el trabajo en curso: el diálogo se superpone a
 *     la ruta actual (sigue montada, con su estado) y, al validar credenciales,
 *     `lib/api.ts` **reintenta sola la petición que había fallado**. Por eso este
 *     componente registra un `ReauthResolver`: la petición original se queda
 *     esperando en su `await` en vez de morir.
 *  3. Avisar antes, no después. Con 2 h de vida, enterarse del vencimiento al
 *     pulsar "Guardar" es enterarse tarde: hay un aviso a los últimos minutos
 *     que permite renovar sin interrumpir nada.
 *  4. `OrgAccessGuard` ya no exime a ADMIN ni aprueba peticiones sin
 *     `organizationId`: hace falta decir "no tienes acceso a esta organización"
 *     en lugar de un error crudo.
 */

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
import { useRouter } from 'next/navigation';
import {
  ApiError,
  ORG_DENIED_EVENT,
  SESSION_EXPIRED_EVENT,
  STORAGE_KEYS,
  clearSession,
  decodeToken,
  fetchMe,
  isTokenExpired,
  login as loginRequest,
  registerReauthResolver,
  secondsUntilExpiry,
  storeSession,
} from '@/lib/api';
import { capabilitiesFor, hasCapability, type Capability, type Role } from '@/lib/permissions';
import styles from './Session.module.scss';

/** Umbral del aviso previo: los últimos 10 minutos de la sesión. */
const WARN_BEFORE_SECONDS = 10 * 60;
/** Cada cuánto se recalcula el tiempo restante. */
const TICK_MS = 20_000;

export type SessionState = {
  token: string | null;
  email: string | null;
  role: Role | null;
  organizationId: string | null;
  /** `true` mientras se resuelve la sesión inicial. */
  loading: boolean;
  can: (cap: Capability) => boolean;
  capabilities: Capability[];
  /** Segundos que le quedan al token (`null` si no se puede saber). */
  secondsLeft: number | null;
  /** Está por vencer: se muestra el aviso previo. */
  expiringSoon: boolean;
  /**
   * Abre el diálogo de reautenticación y resuelve con el token nuevo (o `null`
   * si el usuario sale). Lo usa `lib/api.ts` para reintentar la petición que
   * recibió 401; también sirve para renovar a mano desde la interfaz.
   */
  requireReauth: () => Promise<string | null>;
  logout: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}

/** Atajo para gatear un fragmento de interfaz por capacidad. */
export function Can({
  cap,
  children,
  fallback = null,
}: {
  cap: Capability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useSession();
  return <>{can(cap) ? children : fallback}</>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [orgDenied, setOrgDenied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** El aviso se puede posponer; vuelve a salir si se renueva y expira de nuevo. */
  const [warningDismissed, setWarningDismissed] = useState(false);
  const resolvingRef = useRef(false);
  /**
   * El usuario ya se rindió y salió. Sin esta marca, los 401 que devuelven las
   * peticiones abandonadas volvían a abrir el diálogo justo después de pulsar
   * "Salir": no había forma de irse.
   */
  const abandonedRef = useRef(false);

  /**
   * Peticiones que esperan un token nuevo. Se guardan sus `resolve` para
   * desbloquearlas todas de golpe en cuanto la reautenticación termine.
   */
  const waitersRef = useRef<((token: string | null) => void)[]>([]);

  const settleWaiters = useCallback((newToken: string | null) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    waiters.forEach((resolve) => resolve(newToken));
  }, []);

  /** Abre el diálogo salvo que el usuario ya haya decidido salir. */
  const openReauth = useCallback(() => {
    if (abandonedRef.current) return;
    setReauthOpen(true);
  }, []);

  /** Abre el diálogo y devuelve una promesa que se cumple al reautenticar. */
  const requireReauth = useCallback((): Promise<string | null> => {
    if (abandonedRef.current) return Promise.resolve(null);
    setReauthOpen(true);
    return new Promise<string | null>((resolve) => {
      waitersRef.current.push(resolve);
    });
  }, []);

  /** `lib/api.ts` usa esto para reintentar sola la petición que dio 401. */
  useEffect(() => registerReauthResolver(requireReauth), [requireReauth]);

  /** Carga inicial: lee el token y confirma identidad contra el API. */
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.token);
    if (!stored) {
      setLoading(false);
      router.replace('/login');
      return;
    }

    // Si ya venció, no se malgasta una petición: directo a reautenticar.
    if (isTokenExpired(stored)) {
      setToken(stored);
      const payload = decodeToken(stored);
      setEmail(payload?.email ?? null);
      setRole((payload?.role as Role) ?? null);
      setLoading(false);
      openReauth();
      return;
    }

    setToken(stored);
    const payload = decodeToken(stored);
    setEmail(payload?.email ?? null);
    setRole((payload?.role as Role) ?? null);
    setOrganizationId(payload?.organizationId ?? localStorage.getItem(STORAGE_KEYS.org) ?? null);

    // `/auth/me` es la autoridad: el rol y la organización del token pueden
    // haber cambiado (invitación aceptada, cambio de rol, revocación).
    fetchMe(stored)
      .then((me) => {
        setEmail(me.email);
        setRole(me.role as Role);
        setOrganizationId(me.organizationId);
        storeSession(stored, me);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.isUnauthorized) openReauth();
      })
      .finally(() => setLoading(false));
  }, [router]);

  /** Escucha los eventos globales que emite `adminApi`. */
  useEffect(() => {
    function onExpired() {
      openReauth();
    }
    function onOrgDenied() {
      setOrgDenied(true);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener(ORG_DENIED_EVENT, onOrgDenied);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener(ORG_DENIED_EVENT, onOrgDenied);
    };
  }, []);

  /**
   * Cuenta atrás del token. Con 2 h de vida, avisar antes de que caiga evita
   * perder un formulario a medio llenar; al llegar a cero se abre el diálogo.
   */
  useEffect(() => {
    if (!token) return;
    function tick() {
      const left = secondsUntilExpiry(token);
      setSecondsLeft(left);
      if (left !== null && left <= 0) openReauth();
    }
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [token]);

  const logout = useCallback(() => {
    // Nadie se queda esperando un token que ya no va a llegar.
    abandonedRef.current = true;
    setReauthOpen(false);
    settleWaiters(null);
    clearSession();
    setToken(null);
    setRole(null);
    setOrganizationId(null);
    router.replace('/login');
  }, [router, settleWaiters]);

  /** Reautenticación en sitio: no se navega, no se pierde el contexto. */
  const handleReauth = useCallback(
    async (pwd: string) => {
      if (!email) throw new Error('Sesión sin correo asociado');
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      try {
        const { accessToken, user } = await loginRequest(email, pwd);
        storeSession(accessToken, user);
        setToken(accessToken);
        setRole(user.role as Role);
        setOrganizationId(user.organizationId);
        abandonedRef.current = false;
        setReauthOpen(false);
        setOrgDenied(false);
        setWarningDismissed(false);
        // Desbloquea las peticiones en espera con el token recién emitido.
        settleWaiters(accessToken);
      } finally {
        resolvingRef.current = false;
      }
    },
    [email, settleWaiters],
  );

  const capabilities = useMemo(() => capabilitiesFor(role), [role]);
  const can = useCallback((cap: Capability) => hasCapability(role, cap), [role]);

  const expiringSoon =
    secondsLeft !== null && secondsLeft > 0 && secondsLeft <= WARN_BEFORE_SECONDS;

  const value = useMemo<SessionState>(
    () => ({
      token,
      email,
      role,
      organizationId,
      loading,
      can,
      capabilities,
      secondsLeft,
      expiringSoon,
      requireReauth,
      logout,
    }),
    [
      token,
      email,
      role,
      organizationId,
      loading,
      can,
      capabilities,
      secondsLeft,
      expiringSoon,
      requireReauth,
      logout,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {expiringSoon && !reauthOpen && !warningDismissed && (
        <ExpiryWarning
          secondsLeft={secondsLeft ?? 0}
          onRenew={() => void requireReauth()}
          onDismiss={() => setWarningDismissed(true)}
        />
      )}
      {reauthOpen && (
        <ReauthModal
          email={email}
          pendingCount={waitersRef.current.length}
          onSubmit={handleReauth}
          onLogout={logout}
        />
      )}
      {orgDenied && !reauthOpen && (
        <OrgDeniedModal
          organizationId={organizationId}
          onDismiss={() => setOrgDenied(false)}
          onLogout={logout}
        />
      )}
    </SessionContext.Provider>
  );
}

/** "quedan 7 min" / "queda menos de 1 min" */
function formatLeft(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'menos de 1 minuto';
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/**
 * Aviso previo, no modal: se puede seguir trabajando. Solo se ofrece renovar
 * antes de que la sesión caiga en mitad de algo.
 */
function ExpiryWarning({
  secondsLeft,
  onRenew,
  onDismiss,
}: {
  secondsLeft: number;
  onRenew: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.warningBar} role="status">
      {/* El icono no aporta información: el texto ya dice todo (no solo color). */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <p className={styles.warningText}>
        Tu sesión termina en <strong>{formatLeft(secondsLeft)}</strong>. Renuévala ahora para no
        perder lo que estés haciendo.
      </p>
      <button type="button" className={styles.warningPrimary} onClick={onRenew}>
        Renovar sesión
      </button>
      <button
        type="button"
        className={styles.warningDismiss}
        onClick={onDismiss}
        aria-label="Ocultar aviso de sesión"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Diálogo de reautenticación superpuesto: la ruta y su estado siguen montados.
 * No se puede cerrar con Escape a propósito — cerrarlo dejaría la pantalla
 * inservible (todo daría 401) y las peticiones en espera colgadas.
 */
function ReauthModal({
  email,
  pendingCount,
  onSubmit,
  onLogout,
}: {
  email: string | null;
  pendingCount: number;
  onSubmit: (password: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /** Foco atrapado dentro del diálogo y devuelto al salir (WCAG 2.4.3). */
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => restoreFocusRef.current?.focus?.();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([readonly]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables?.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password);
      setPassword('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Contraseña incorrecta.'
          : err instanceof ApiError
            ? err.userMessage
            : 'No se pudo reautenticar.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-desc"
        onKeyDown={onKeyDown}
      >
        <h2 id="reauth-title" className={styles.title}>
          Tu sesión expiró
        </h2>
        <p id="reauth-desc" className={styles.body}>
          Vuelve a entrar para continuar. Sigues en la misma pantalla y no se ha perdido nada de lo
          que tenías abierto.
          {pendingCount > 0 && (
            <>
              {' '}
              <strong>
                {pendingCount === 1
                  ? 'Hay 1 acción en espera'
                  : `Hay ${pendingCount} acciones en espera`}
              </strong>
              : se reintentarán solas en cuanto entres.
            </>
          )}
        </p>
        <form onSubmit={submit} className={styles.form}>
          <label className={styles.label} htmlFor="reauth-email">
            Correo
          </label>
          <input
            id="reauth-email"
            className={styles.input}
            value={email ?? ''}
            readOnly
            autoComplete="username"
          />
          <label className={styles.label} htmlFor="reauth-password">
            Contraseña
          </label>
          <input
            id="reauth-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-describedby={error ? 'reauth-error' : undefined}
            aria-invalid={error ? true : undefined}
          />
          {error && (
            <p id="reauth-error" className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.ghost} onClick={onLogout}>
              Salir
            </button>
            <button type="submit" className={styles.primary} disabled={busy || !password}>
              {busy ? 'Entrando…' : 'Continuar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Pantalla explícita de organización denegada (403 del `OrgAccessGuard`). */
function OrgDeniedModal({
  organizationId,
  onDismiss,
  onLogout,
}: {
  organizationId: string | null;
  onDismiss: () => void;
  onLogout: () => void;
}) {
  return (
    <div className={styles.backdrop}>
      <div
        className={styles.modal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="org-title"
        aria-describedby="org-desc"
      >
        <h2 id="org-title" className={styles.title}>
          No tienes acceso a esta organización
        </h2>
        <p id="org-desc" className={styles.body}>
          {organizationId
            ? 'Tu cuenta no pertenece a la organización de este recurso, o tu rol fue cambiado. Si deberías tener acceso, pide a un administrador que te envíe una invitación.'
            : 'Tu cuenta no tiene una organización asignada. El API rechaza todas las rutas de organización mientras siga así, incluso para cuentas de administrador. Pide a un administrador que te asigne una.'}
        </p>
        {organizationId && (
          <p className={styles.meta}>
            Organización activa: <code>{organizationId}</code>
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onLogout}>
            Cambiar de cuenta
          </button>
          <button type="button" className={styles.primary} onClick={onDismiss} autoFocus>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
