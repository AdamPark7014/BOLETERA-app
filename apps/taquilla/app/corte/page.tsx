'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  clearTaquillaSession,
  getTaquillaToken,
  getTaquillaUser,
} from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { ManagerPinDialog } from '@/components/ManagerPinDialog';
import type { Hotkey } from '@/lib/hotkeys';
import {
  MXN_DENOMINATIONS,
  billLabel,
  countedTotal,
  money,
  round2,
  type DenominationCount,
} from '@/lib/cash';
import {
  addCashDrop,
  endSession,
  fetchSessionSummary,
  getCashierId,
  getSessionId,
  handoffShift,
  listZReports,
  preserveHandoffSession,
  resolveOrgId,
  type SessionSummary,
  type ZReport,
} from '@/lib/pos';
import styles from './corte.module.scss';

/** Por encima de esta diferencia el cierre exige autorización de gerencia. */
const VARIANCE_PIN_THRESHOLD = 50;

type Prompt = null | 'DROP' | 'CLOSE' | 'HANDOFF';

export default function CortePage() {
  const router = useRouter();
  const [report, setReport] = useState<SessionSummary | null>(null);
  const [counts, setCounts] = useState<DenominationCount>({});
  const [manualCounted, setManualCounted] = useState('');
  const [useDenominations, setUseDenominations] = useState(true);
  const [dropAmount, setDropAmount] = useState('');
  const [dropNote, setDropNote] = useState('');
  const [handoffCashier, setHandoffCashier] = useState('');
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [handoffDone, setHandoffDone] = useState(false);
  const [closedReport, setClosedReport] = useState<Record<string, unknown> | null>(null);
  const [zReports, setZReports] = useState<ZReport[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const cashierName = useMemo(() => {
    const user = getTaquillaUser();
    if (!user) return getCashierId();
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4500);
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  const refresh = useCallback(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    fetchSessionSummary(sessionId)
      .then(setReport)
      .catch((err: unknown) =>
        showToast(err instanceof Error ? err.message : 'No se pudo cargar el turno'),
      );
  }, [showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    listZReports(resolveOrgId())
      .then((list) => setZReports(Array.isArray(list) ? list.slice(0, 8) : []))
      .catch(() => setZReports([]));
  }, []);

  const expected = round2(report?.expectedCash ?? 0);
  const counted = useDenominations ? countedTotal(counts) : round2(Number(manualCounted) || 0);
  const variance = round2(counted - expected);
  const needsPin = Math.abs(variance) > VARIANCE_PIN_THRESHOLD;

  // -------------------------------------------------------------------------

  async function doDrop(pin: string) {
    const amount = round2(Number(dropAmount));
    if (!(amount > 0)) {
      showToast('Indica el importe a retirar');
      return;
    }
    setLoading(true);
    try {
      const summary = await addCashDrop(amount, dropNote.trim() || `Retiro de ${cashierName}`);
      setReport(summary);
      setDropAmount('');
      setDropNote('');
      setPrompt(null);
      showToast(`Retiro de ${money(amount)} registrado — autorizado con PIN ${pin.slice(0, 1)}•••`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo registrar el retiro');
    } finally {
      setLoading(false);
    }
  }

  const closeShift = useCallback(
    async (pin?: string) => {
      const sessionId = getSessionId();
      if (!sessionId) {
        showToast('No hay turno abierto. Ábrelo desde el inicio de sesión.');
        return;
      }
      setLoading(true);
      try {
        const data = await endSession(sessionId, counted, pin);
        setClosedReport(data);
        setClosed(true);
        setPrompt(null);
        localStorage.removeItem('boletera_pos_session');
        printCorte({ ...(report ?? {}), ...data });
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo cerrar el turno');
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [counted, report, showToast],
  );

  async function doHandoff(pin: string) {
    const next = handoffCashier.trim();
    if (!next) {
      showToast('Indica el id o email del cajero entrante');
      return;
    }
    setLoading(true);
    try {
      const data = await handoffShift({
        toCashierId: next,
        closingCashCounted: counted,
        openingCash: counted,
        managerPin: pin,
      });
      setClosedReport(data.closed);
      setHandoffDone(true);
      setClosed(true);
      setPrompt(null);
      printCorte({ ...(report ?? {}), ...data.closed });
      // El turno nuevo NO puede seguir con el token del cajero saliente: todas
      // sus ventas quedarían firmadas por la persona equivocada. Se cierra la
      // sesión local y el entrante se identifica con SUS credenciales — pero
      // conservando el turno que el API acaba de abrir.
      const restore = preserveHandoffSession(data.next);
      clearTaquillaSession();
      restore();
      showToast('Turno entregado. El cajero entrante debe identificarse.');
      setTimeout(() => router.replace('/login'), 1200);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo entregar el turno');
      setLoading(false);
    }
  }

  function printCorte(data: Record<string, unknown>) {
    const r = data as SessionSummary & {
      closingCashCounted?: number;
      variance?: number;
    };
    const lines = [
      'CORTE DE CAJA — BOLETERA',
      `Terminal: ${typeof window !== 'undefined' ? localStorage.getItem('taquilla_terminal_label') ?? '—' : '—'}`,
      `Responsable: ${cashierName} (${getCashierId()})`,
      `Inicio: ${r.startTime ? new Date(r.startTime).toLocaleString('es-MX') : '—'}`,
      `Fin: ${new Date(r.endTime ?? Date.now()).toLocaleString('es-MX')}`,
      '',
      `Transacciones: ${r.totalTransactions ?? 0}`,
      `Total ventas: ${money(Number(r.totalRevenue ?? 0))}`,
      `Fondo inicial: ${money(Number(r.openingCash ?? 0))}`,
      `Ventas efectivo: ${money(Number(r.cashSales ?? 0))}`,
      `Retiros: ${money(Number(r.dropsTotal ?? 0))}`,
      `Esperado en caja: ${money(Number(r.expectedCash ?? expected))}`,
      `Contado: ${money(Number(r.closingCashCounted ?? counted))}`,
      `Diferencia: ${money(Number(r.variance ?? variance))}`,
      '',
      ...(useDenominations
        ? MXN_DENOMINATIONS.filter((d) => Number(counts[String(d)]) > 0).map(
            (d) => `${billLabel(d)} × ${counts[String(d)]}`,
          )
        : []),
      '',
      ...Object.entries(r.byMethod ?? {}).map(([m, a]) => `${m}: ${money(Number(a))}`),
    ].filter(Boolean);
    const w = window.open('', '_blank', 'width=340,height=620');
    if (!w) return;
    w.document.write(`<pre style="font-family:monospace;font-size:12px">${lines.join('\n')}</pre>`);
    w.document.close();
    w.print();
  }

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { keys: 'F9', label: 'Retiro (PIN)', whileTyping: true, run: () => setPrompt('DROP') },
      { keys: 'F10', label: 'Traspaso (PIN)', whileTyping: true, run: () => setPrompt('HANDOFF') },
      {
        keys: 'F12',
        label: 'Cerrar turno',
        whileTyping: true,
        run: () => {
          if (closed) return;
          if (needsPin) setPrompt('CLOSE');
          else void closeShift();
        },
      },
      {
        keys: 'Esc',
        label: 'Inicio',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/'),
      },
    ],
    [closed, needsPin, closeShift, router],
  );

  const totalMethods = report
    ? Object.values(report.byMethod ?? {}).reduce((s, a) => s + Number(a), 0)
    : 0;

  return (
    <PosShell
      title="Turno y caja"
      eyebrow={`Responsable · ${cashierName}`}
      backHref="/"
      size="md"
      hotkeys={hotkeys}
      escapeGoesBack={false}
      hotkeysEnabled={!prompt}
    >
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      {!report ? (
        <div className={styles.empty}>
          <p>No hay turno abierto en esta terminal.</p>
          <Link href="/login">Abrir turno con fondo inicial</Link>
        </div>
      ) : (
        <>
          <section className={styles.bigTotal}>
            <p className={styles.bigLabel}>Cobrado en este turno</p>
            <strong>{money(report.totalRevenue)}</strong>
            <span className={styles.bigSub}>
              {report.totalTransactions} transacciones · desde{' '}
              {new Date(report.startTime).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </section>

          <section className={styles.section}>
            <h2>Arqueo de efectivo</h2>
            <dl className={styles.details}>
              <div>
                <dt>Fondo inicial</dt>
                <dd>{money(report.openingCash)}</dd>
              </div>
              <div>
                <dt>Ventas en efectivo</dt>
                <dd>{money(report.cashSales)}</dd>
              </div>
              <div>
                <dt>Retiros</dt>
                <dd>−{money(report.dropsTotal ?? 0)}</dd>
              </div>
              <div className={styles.strong}>
                <dt>Esperado en caja</dt>
                <dd>{money(expected)}</dd>
              </div>
              <div>
                <dt>Ventas con tarjeta</dt>
                <dd>{money(report.cardSales)}</dd>
              </div>
              <div>
                <dt>Cortesías</dt>
                <dd>{report.compCount ?? 0}</dd>
              </div>
            </dl>

            {!closed && (
              <>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    className={useDenominations ? styles.toggleOn : styles.toggle}
                    onClick={() => setUseDenominations(true)}
                  >
                    Contar por denominación
                  </button>
                  <button
                    type="button"
                    className={!useDenominations ? styles.toggleOn : styles.toggle}
                    onClick={() => setUseDenominations(false)}
                  >
                    Escribir total
                  </button>
                </div>

                {useDenominations ? (
                  <ul className={styles.denoms}>
                    {MXN_DENOMINATIONS.map((d) => (
                      <li key={d}>
                        <span>{billLabel(d)}</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={counts[String(d)] ?? ''}
                          onChange={(e) =>
                            setCounts((c) => ({
                              ...c,
                              [String(d)]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          aria-label={`Piezas de ${billLabel(d)}`}
                        />
                        <em>{money(d * (Number(counts[String(d)]) || 0))}</em>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <label className={styles.countField}>
                    <small>Efectivo contado</small>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={manualCounted}
                      onChange={(e) => setManualCounted(e.target.value)}
                    />
                  </label>
                )}

                <div className={styles.arqueoResult}>
                  <div>
                    <span>Contado</span>
                    <strong>{money(counted)}</strong>
                  </div>
                  <div className={variance === 0 ? styles.okBox : styles.badBox}>
                    <span>Diferencia</span>
                    <strong>
                      {variance > 0 ? '+' : ''}
                      {money(variance)}
                    </strong>
                    <small>
                      {variance === 0 ? 'Cuadrado' : variance > 0 ? 'Sobrante' : 'Faltante'}
                      {needsPin ? ' · requiere PIN de gerente' : ''}
                    </small>
                  </div>
                </div>
              </>
            )}
          </section>

          {report.cashDrops && report.cashDrops.length > 0 && (
            <section className={styles.section}>
              <h2>Retiros del turno</h2>
              <ul className={styles.drops}>
                {report.cashDrops.map((d, i) => (
                  <li key={`${d.at ?? i}`}>
                    <strong>{money(Number(d.amount))}</strong>
                    <span>{d.note || 'Sin nota'}</span>
                    <em>{d.at ? new Date(d.at).toLocaleTimeString('es-MX') : ''}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {totalMethods > 0 && (
            <section className={styles.section}>
              <h2>Desglose por método</h2>
              <ul className={styles.breakdown}>
                {Object.entries(report.byMethod).map(([m, a]) => {
                  const amount = Number(a);
                  const pct = totalMethods ? Math.round((amount / totalMethods) * 100) : 0;
                  return (
                    <li key={m}>
                      <div className={styles.methodInfo}>
                        <strong>{m === 'CASH' ? 'Efectivo' : m === 'CARD' ? 'Tarjeta' : m}</strong>
                        <div className={styles.bar}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className={styles.amount}>{money(amount)}</span>
                      <span className={styles.pct}>{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {!closed && report && (
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={() => setPrompt('DROP')}>
            Retiro parcial · F9
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={() => setPrompt('HANDOFF')}>
            Entregar turno · F10
          </button>
          <button
            type="button"
            className={styles.closeBtn}
            disabled={loading}
            onClick={() => (needsPin ? setPrompt('CLOSE') : void closeShift())}
          >
            {loading ? 'Cerrando…' : 'Cerrar turno · F12'}
          </button>
        </div>
      )}

      {closed && (
        <p className={styles.done}>
          {handoffDone ? 'Turno entregado.' : 'Turno cerrado y corte Z archivado.'}{' '}
          <button type="button" onClick={() => printCorte({ ...(report ?? {}), ...(closedReport ?? {}) })}>
            Reimprimir corte
          </button>{' '}
          <Link href={handoffDone ? '/login' : '/login'}>Abrir nuevo turno</Link>
        </p>
      )}

      {zReports.length > 0 && (
        <section className={styles.section}>
          <h2>Cortes anteriores</h2>
          <ul className={styles.zList}>
            {zReports.map((z) => (
              <li key={z.id}>
                <strong>
                  {z.closedAt || z.createdAt
                    ? new Date(String(z.closedAt ?? z.createdAt)).toLocaleString('es-MX')
                    : z.id}
                </strong>
                <span>{z.cashierId ?? '—'}</span>
                <em>{z.totalRevenue != null ? money(Number(z.totalRevenue)) : '—'}</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ManagerPinDialog
        open={prompt === 'DROP'}
        title="Retiro parcial de efectivo"
        detail="El importe sale del cajón y se descuenta del esperado en caja. Queda registrado con el responsable del turno."
        confirmLabel="Registrar retiro"
        onCancel={() => setPrompt(null)}
        onConfirm={(pin) => doDrop(pin)}
      />

      <ManagerPinDialog
        open={prompt === 'CLOSE'}
        title={`Cerrar turno con diferencia de ${money(variance)}`}
        detail={`Esperado ${money(expected)} · contado ${money(counted)}. Una diferencia mayor a ${money(
          VARIANCE_PIN_THRESHOLD,
        )} requiere autorización de gerencia.`}
        confirmLabel="Cerrar turno"
        danger
        onCancel={() => setPrompt(null)}
        onConfirm={(pin) => closeShift(pin)}
      />

      <ManagerPinDialog
        open={prompt === 'HANDOFF'}
        title="Entregar turno"
        detail="Se cierra el turno actual con el efectivo contado y se abre uno nuevo. El cajero entrante deberá identificarse con sus credenciales."
        confirmLabel="Entregar"
        onCancel={() => setPrompt(null)}
        onConfirm={(pin) => doHandoff(pin)}
      />

      {/* Los campos de retiro y traspaso viven FUERA del diálogo: el importe y el
          cajero entrante se teclean antes de pedir el PIN, no después. */}
      {!closed && report && (
        <section className={styles.section}>
          <h2>Datos para retiro / traspaso</h2>
          <div className={styles.inlineFields}>
            <label className={styles.countField}>
              <small>Importe a retirar</small>
              <input
                type="number"
                min={0}
                step="0.01"
                value={dropAmount}
                onChange={(e) => setDropAmount(e.target.value)}
              />
            </label>
            <label className={styles.countField}>
              <small>Nota del retiro</small>
              <input value={dropNote} onChange={(e) => setDropNote(e.target.value)} />
            </label>
            <label className={styles.countField}>
              <small>Cajero entrante (id o email)</small>
              <input
                value={handoffCashier}
                onChange={(e) => setHandoffCashier(e.target.value)}
                placeholder="cajero2@boletera.com"
              />
            </label>
          </div>
        </section>
      )}
    </PosShell>
  );
}
