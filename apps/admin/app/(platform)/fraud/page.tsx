'use client';

import { Suspense, useEffect, useState } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { resolveFraudFlag } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, readNumber, readString } from '../events/_ticket/read';

const TYPE: Record<string, string> = {
  SUSPICIOUS_ACTIVITY: 'Actividad sospechosa',
  DUPLICATE_PURCHASE: 'Compra duplicada',
  HIGH_VELOCITY: 'Velocidad alta',
  UNLIKELY_LOCATION: 'Ubicación improbable',
  MULTIPLE_DECLINED: 'Varios rechazos',
  CHARGEBACK: 'Contracargo',
  ACCOUNT_BREACH: 'Cuenta vulnerada',
  BOT_ACTIVITY: 'Bot',
  SCALPING_VIOLATION: 'Reventa fuera de tope',
  KYC_MISMATCH: 'KYC',
};

const SEVERITY: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

const STATUS: Record<string, string> = {
  FLAGGED: 'Marcado',
  INVESTIGATING: 'En revisión',
  RESOLVED: 'Resuelto',
  FALSE_POSITIVE: 'Falso positivo',
};

type Flag = {
  id: string;
  type: string;
  severity: string;
  score: number;
  reason: string;
  status: string;
  resolution: string | null;
  orderPublicId: string | null;
};

function word(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

function scoreLabel(value: number): string {
  return value.toLocaleString('es-MX', { maximumFractionDigits: 1 });
}

function readFlag(raw: unknown): Flag | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  if (!id) return null;
  const order = asRecord(row.order);
  return {
    id,
    type: readString(row.type) ?? '—',
    severity: readString(row.severity) ?? '—',
    score: readNumber(row.score) ?? 0,
    reason: readString(row.reason) ?? '',
    status: readString(row.status) ?? 'FLAGGED',
    resolution: readString(row.resolution),
    orderPublicId: readString(order.publicId),
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function FraudPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <FraudeBody />
      </AdminFrame>
    </Suspense>
  );
}

function FraudeBody() {
  const session = useSession();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'risk.view');
  const canResolve = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>('/fraud/flags?limit=50', token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const flag = readFlag(item);
          return flag ? [flag] : [];
        });
        setFlags(next);
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, session.status, nonce]);

  async function resolve(flag: Flag) {
    if (!token || busy) return;
    const note = (notes[flag.id] ?? '').trim();
    if (!note) return;
    setBusy(flag.id);
    setActionError(null);
    try {
      await resolveFraudFlag(token, flag.id, note);
      setNotice(`Caso resuelto · ${word(TYPE, flag.type)}`);
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Fraude</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir fraude" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando fraude.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Fraude</h1>
        <p className={styles.quiet}>Casos que ya marcó el servicio. Resolver deja el caso en Resuelto.</p>
      </header>
      <div className={styles.stack}>
        <Param name="Detección">
          <ParameterCard
            name="Detección"
            value="Encendida"
            effect="Lo fija el entorno. El API no la lee ni la escribe. Aquí se lee."
          />
        </Param>
      </div>
      {flags.length === 0 ? <p className={styles.quiet}>No hay casos.</p> : null}
      {flags.length === 50 ? <p className={styles.tertiary}>Se muestran 50.</p> : null}
      <div className={styles.stack}>
        {flags.map((flag) => {
          const open = openId === flag.id;
          const note = notes[flag.id] ?? '';
          const openCase = flag.status === 'FLAGGED' || flag.status === 'INVESTIGATING';
          return (
            <div key={flag.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : flag.id)}
              >
                <span>
                  {word(TYPE, flag.type)} · {word(SEVERITY, flag.severity)}
                </span>
                <span className={styles.figure}>{scoreLabel(flag.score)}</span>
              </button>
              {open ? (
                <>
                  {flag.orderPublicId ? <p className={styles.mono}>{flag.orderPublicId}</p> : null}
                  <Param name="Tipo de fraude">
                    <ParameterCard
                      name="Tipo de fraude"
                      value={word(TYPE, flag.type)}
                      effect={flag.reason || 'Lo marcó el servicio.'}
                    />
                  </Param>
                  <Param name="Severidad">
                    <ParameterCard name="Severidad" value={word(SEVERITY, flag.severity)} effect="Baja, media, alta o crítica." />
                  </Param>
                  <Param name="Puntaje">
                    <ParameterCard
                      name="Puntaje"
                      value={scoreLabel(flag.score)}
                      valueStyle="tabular"
                      effect="De 0 a 100."
                    />
                  </Param>
                  <Param name="Estado del caso">
                    <ParameterCard
                      name="Estado del caso"
                      value={word(STATUS, flag.status)}
                      effect={
                        flag.resolution
                          ? flag.resolution
                          : 'Resolver lo deja en Resuelto. En revisión y Falso positivo no se escriben.'
                      }
                    />
                  </Param>
                  {canResolve && openCase ? (
                    <>
                      <Field
                        label="Nota"
                        value={note}
                        onChange={(event) => {
                          setNotes((current) => ({ ...current, [flag.id]: event.target.value }));
                          setNotice(null);
                        }}
                      />
                      <TicketButton
                        variant="secondary"
                        disabled={busy === flag.id || !note.trim()}
                        onClick={() => void resolve(flag)}
                      >
                        Resolver
                      </TicketButton>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? <p className={styles.quiet}>{notice}</p> : null}
    </section>
  );
}
