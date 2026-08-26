'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@boletera/ui';
import {
  apiJson,
  clearTaquillaSession,
  getTerminalLabel,
  getTaquillaToken,
  getTaquillaUser,
} from '@/lib/auth';
import { HotkeyBar } from '@/components/HotkeyBar';
import { NetStatus, useOpsStatus } from '@/components/NetStatus';
import { digitPressed, type Hotkey, useHotkeys } from '@/lib/hotkeys';
import { money } from '@/lib/cash';
import { flushQueue } from '@/lib/offline-queue';
import { clearConflicts, listConflicts, syncScans, type ScanConflict } from '@/lib/scan-queue';
import {
  clearFailedSync,
  fetchSessionSummary,
  getFailedSync,
  getLastReceipt,
  getSessionId,
  printReceipt,
  syncOfflineSales,
  type OfflinePosPayload,
  type PosReceipt,
  type SessionSummary,
} from '@/lib/pos';
import styles from './taquilla.module.scss';

type EventRow = {
  id: string;
  title: string;
  startsAt: string;
  venue?: { name: string };
  offers?: { id: string; name?: string; zone?: string; basePrice: string | number }[];
};

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--bl-accent)" />
      <path d="M9 11h14M9 16h14M9 21h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="22" cy="21" r="2.5" fill="#fff" />
    </svg>
  );
}

function IconVenta() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 10h10M7 14h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconBuscar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconWillCall() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4V3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconAcceso() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconReprint() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9V4h12v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="4" y="9" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 14h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconCorte() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 12h2M15 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconAjustes() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TaquillaHome() {
  const router = useRouter();
  const status = useOpsStatus();
  const [synced, setSynced] = useState(0);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [terminalLabel, setTerminalLabel] = useState('TAQ-01');
  const [cashierName, setCashierName] = useState('');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [lastReceipt, setLastReceipt] = useState<PosReceipt | null>(null);
  const [conflicts, setConflicts] = useState<ScanConflict[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [failedSync, setFailedSync] = useState<Array<{ clientSaleId: string; error: string; at: string }>>(
    [],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  const refreshSummary = useCallback(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    fetchSessionSummary(sessionId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) {
      router.replace('/login');
      return;
    }
    setTerminalLabel(getTerminalLabel());
    const user = getTaquillaUser();
    setCashierName(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : 'Cajero',
    );
    setLastReceipt(getLastReceipt());
    setFailedSync(getFailedSync());
    void listConflicts().then(setConflicts);
  }, [router]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(
        d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      );
      setDate(
        d.toLocaleDateString('es-MX', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }),
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    refreshSummary();
    const id = setInterval(refreshSummary, 15000);
    return () => clearInterval(id);
  }, [refreshSummary]);

  useEffect(() => {
    apiJson<EventRow[]>('/discovery/events')
      .then((data) => {
        const now = Date.now();
        const week = now + 7 * 24 * 60 * 60 * 1000;
        const upcoming = data
          .filter((e) => {
            const t = new Date(e.startsAt).getTime();
            return t >= now - 12 * 60 * 60 * 1000 && t <= week;
          })
          .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
          .slice(0, 9);
        setEvents(upcoming.length ? upcoming : data.slice(0, 9));
      })
      .catch(() => setEvents([]));
  }, []);

  const syncAll = useCallback(() => {
    if (!navigator.onLine) return;
    void flushQueue(async (payload) => {
      if ((payload as OfflinePosPayload).type === 'pos') {
        await syncOfflineSales([payload as OfflinePosPayload]);
      }
    }).then((n) => {
      if (n > 0) {
        setSynced((s) => s + n);
        clearFailedSync();
      }
      setFailedSync(getFailedSync());
      status.refresh();
      refreshSummary();
    });
    void syncScans()
      .then((result) => {
        if (result.sent > 0) {
          showToast(
            `${result.applied} escaneos aplicados · ${result.conflicts} conflictos · ${result.rejected} rechazados`,
          );
        }
        void listConflicts().then(setConflicts);
        status.refresh();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSummary, showToast]);

  useEffect(() => {
    syncAll();
    window.addEventListener('online', syncAll);
    return () => window.removeEventListener('online', syncAll);
  }, [syncAll]);

  function logout() {
    clearTaquillaSession();
    router.push('/login');
  }

  function reprint() {
    const rec = getLastReceipt();
    if (!rec) {
      showToast('No hay venta reciente para reimprimir');
      return;
    }
    void printReceipt(rec);
    showToast('Reimprimiendo última venta');
  }

  function sellHref(e: EventRow) {
    const offerId = e.offers?.[0]?.id;
    const q = new URLSearchParams({ eventId: e.id, ...(offerId ? { offerId } : {}) });
    return `/venta?${q.toString()}`;
  }

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { keys: 'F1', label: 'Nueva venta', whileTyping: true, run: () => router.push('/venta') },
      {
        keys: '1-9',
        label: 'Vender evento',
        match: (e) => digitPressed(e) != null,
        run: (e) => {
          const n = digitPressed(e);
          const row = n ? events[n - 1] : undefined;
          if (row) router.push(sellHref(row));
        },
      },
      { keys: 'F3', label: 'Buscar', whileTyping: true, run: () => router.push('/buscar') },
      { keys: 'F4', label: 'Will-call', whileTyping: true, run: () => router.push('/willcall') },
      { keys: 'F6', label: 'Acceso', whileTyping: true, run: () => router.push('/acceso') },
      { keys: 'F7', label: 'Reimprimir', whileTyping: true, run: reprint },
      { keys: 'F12', label: 'Corte', whileTyping: true, run: () => router.push('/corte') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, events],
  );

  useHotkeys(hotkeys);

  const pending = status.pendingSales + status.pendingScans;

  return (
    <main className={styles.home}>
      <div className={styles.bg} aria-hidden="true" />

      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>
            <BrandMark />
            BOLETERA · TAQUILLA
          </span>
          <Badge tone="accent" variant="soft" className={styles.terminalBadge}>
            {terminalLabel}
          </Badge>
        </div>

        <div className={styles.topCenter}>
          <strong>{time}</strong>
          <small>{date}</small>
        </div>

        <div className={styles.topRight}>
          <span className={styles.cashierChip}>
            <small>Cajero</small>
            <strong>{cashierName}</strong>
          </span>
          <NetStatus status={status} />
          <button type="button" className={styles.logoutBtn} onClick={logout} aria-label="Cerrar sesión">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {(pending > 0 || synced > 0 || !status.online || failedSync.length > 0 || conflicts.length > 0) && (
        <div className={styles.banner}>
          {!status.online && (
            <span className={styles.bannerWarn}>
              <strong>Sin conexión</strong> · las ventas y los escaneos quedan en cola local.
            </span>
          )}
          {synced > 0 && (
            <span className={styles.bannerSuccess}>
              <strong>{synced}</strong> ventas sincronizadas.
            </span>
          )}
          {pending > 0 && (
            <span className={styles.bannerInfo}>
              <strong>{pending}</strong> operaciones pendientes de sincronizar.
              <button type="button" onClick={syncAll}>
                Sincronizar ahora
              </button>
            </span>
          )}
          {failedSync.length > 0 && (
            <span className={styles.bannerWarn}>
              <strong>{failedSync.length}</strong> ventas rechazadas al sincronizar.
              <button type="button" onClick={syncAll}>
                Reintentar
              </button>
            </span>
          )}
          {conflicts.length > 0 && (
            <span className={styles.bannerDanger}>
              <strong>{conflicts.length}</strong> conflictos de escaneo por revisar.
              <Link href="/acceso">Ver</Link>
              <button type="button" onClick={() => void clearConflicts().then(() => setConflicts([]))}>
                Marcar revisados
              </button>
            </span>
          )}
        </div>
      )}

      <div className={styles.workspace}>
        <section className={styles.kpiRow} aria-label="Resumen del turno">
          <div className={styles.kpi}>
            <span>Ventas del turno</span>
            <strong>{money(summary?.totalRevenue ?? 0)}</strong>
          </div>
          <div className={styles.kpi}>
            <span>Transacciones</span>
            <strong>{summary?.totalTransactions ?? 0}</strong>
          </div>
          <div className={styles.kpi}>
            <span>Efectivo esperado</span>
            <strong>{money(summary?.expectedCash ?? 0)}</strong>
          </div>
          <div className={styles.kpi}>
            <span>Tarjeta</span>
            <strong>{money(summary?.cardSales ?? 0)}</strong>
          </div>
        </section>

        <section className={styles.quickActions} aria-label="Módulos de taquilla">
          <Link href="/venta" className={`${styles.actionCard} ${styles.primary}`}>
            <span className={styles.cardIcon}><IconVenta /></span>
            <strong>Nueva venta</strong>
            <span>Cobrar en mostrador</span>
            <kbd>F1</kbd>
          </Link>
          <Link href="/buscar" className={styles.actionCard}>
            <span className={styles.cardIcon}><IconBuscar /></span>
            <strong>Buscar</strong>
            <span>Boleto u orden</span>
            <kbd>F3</kbd>
          </Link>
          <Link href="/willcall" className={styles.actionCard}>
            <span className={styles.cardIcon}><IconWillCall /></span>
            <strong>Will-call</strong>
            <span>Entrega en taquilla</span>
            <kbd>F4</kbd>
          </Link>
          <Link href="/acceso" className={styles.actionCard}>
            <span className={styles.cardIcon}><IconAcceso /></span>
            <strong>Acceso</strong>
            <span>Puerta y manifiesto</span>
            <kbd>F6</kbd>
          </Link>
          <button type="button" className={styles.actionCard} onClick={reprint}>
            <span className={styles.cardIcon}><IconReprint /></span>
            <strong>Reimprimir</strong>
            <span>{lastReceipt ? lastReceipt.receiptNumber : 'Sin venta reciente'}</span>
            <kbd>F7</kbd>
          </button>
          <Link href="/corte" className={styles.actionCard}>
            <span className={styles.cardIcon}><IconCorte /></span>
            <strong>Turno y caja</strong>
            <span>Arqueo, retiro, corte</span>
            <kbd>F12</kbd>
          </Link>
          <Link href="/ajustes" className={styles.actionCard}>
            <span className={styles.cardIcon}><IconAjustes /></span>
            <strong>Ajustes</strong>
            <span>Impresora y terminal</span>
          </Link>
        </section>

        <div className={styles.columns}>
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2>Vender ahora · pulsa el número</h2>
              <Link href="/eventos">Ver todos</Link>
            </header>
            {events.length === 0 ? (
              <p className={styles.empty}>No hay eventos en ventana de venta.</p>
            ) : (
              <ul className={styles.eventList}>
                {events.map((e, i) => {
                  const price = Number(e.offers?.[0]?.basePrice ?? 0);
                  const when = new Date(e.startsAt);
                  return (
                    <li key={e.id}>
                      <Link href={sellHref(e)} className={styles.eventRow}>
                        <kbd className={styles.eventKey}>{i + 1}</kbd>
                        <div>
                          <strong>{e.title}</strong>
                          <span>
                            {e.venue?.name} ·{' '}
                            {when.toLocaleString('es-MX', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className={styles.eventMeta}>
                          <em>{price > 0 ? `desde ${money(price)}` : '—'}</em>
                          <span className={styles.sellCta}>Vender</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2>Últimas ventas</h2>
              <button type="button" onClick={refreshSummary}>
                Actualizar
              </button>
            </header>
            {!summary?.recentSales?.length ? (
              <p className={styles.empty}>Aún no hay ventas en este turno.</p>
            ) : (
              <ul className={styles.salesList}>
                {summary.recentSales.map((s) => (
                  <li key={s.orderId}>
                    <div>
                      <strong>{s.eventTitle}</strong>
                      <span>
                        {s.publicId} · {s.paymentMethod} · ×{s.quantity}
                      </span>
                    </div>
                    <strong className={styles.saleTotal}>{money(s.total)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <HotkeyBar hotkeys={hotkeys} />
    </main>
  );
}
