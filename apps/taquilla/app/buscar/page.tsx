'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { ManagerPinDialog } from '@/components/ManagerPinDialog';
import type { Hotkey } from '@/lib/hotkeys';
import { money } from '@/lib/cash';
import {
  exchangeOrder,
  fetchReceipt,
  getTerminalId,
  printReceipt,
  scanTicket,
  voidOrder,
} from '@/lib/pos';
import styles from './buscar.module.scss';

type ScanResult = {
  ticketId?: string;
  status: string;
  eventId?: string;
  eventTitle?: string;
  seatInfo?: string;
  valid?: boolean;
  orderId?: string;
  publicId?: string;
  paymentMethod?: string;
  total?: number;
  tickets?: { code: string; status: string; seatInfo: string }[];
};

type Prompt = null | 'VOID' | 'EXCHANGE';

export default function BuscarPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buffer = useRef('');
  const lastKey = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  const runLookup = useCallback(async (code: string) => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await scanTicket(code);
      setResult(data as ScanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No encontrado');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Lector HID: teclea el código muy rápido y cierra con Enter. Se acumula en
   * un buffer para no depender de que el input tenga el foco.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const now = Date.now();
      if (now - lastKey.current > 80) buffer.current = '';
      lastKey.current = now;
      if (e.key === 'Enter') {
        if (buffer.current.length >= 4) {
          setQuery(buffer.current);
          void runLookup(buffer.current);
        }
        buffer.current = '';
        return;
      }
      if (e.key.length === 1) buffer.current += e.key;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runLookup]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    await runLookup(code);
  }

  async function reprint() {
    if (!result?.orderId) {
      showToast('Sin orden asociada');
      return;
    }
    try {
      const rec = await fetchReceipt(result.orderId, getTerminalId() || 'terminal');
      await printReceipt(rec);
      showToast('Reimprimiendo…');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo reimprimir');
    }
  }

  async function doVoid(pin: string) {
    if (!result?.orderId) return;
    try {
      await voidOrder(result.orderId, 'Anulación desde taquilla', pin);
      setPrompt(null);
      setResult({ ...result, status: 'REFUNDED', valid: false });
      showToast('Venta anulada y registrada en el corte');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo anular');
    }
  }

  async function doExchange(pin: string) {
    if (!result?.orderId) return;
    try {
      const data = await exchangeOrder({
        orderId: result.orderId,
        quantity: result.tickets?.length || 1,
        paymentMethod: 'CASH',
        managerPin: pin,
      });
      setPrompt(null);
      setResult({ ...result, status: 'REFUNDED', valid: false });
      showToast(`Cambio realizado · diferencia ${money(Number(data.delta ?? 0))}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'El cambio falló');
    }
  }

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      {
        keys: 'F3',
        label: 'Enfocar búsqueda',
        whileTyping: true,
        run: () => inputRef.current?.focus(),
      },
      { keys: 'Enter', label: 'Buscar', displayOnly: true },
      // Nada de atajos de UNA LETRA en esta pantalla: el lector HID teclea el
      // código de barras carácter a carácter y una 'P' dentro del folio
      // dispararía una reimpresión en mitad del escaneo.
      ...(result?.orderId
        ? [
            {
              keys: 'F7',
              label: 'Reimprimir orden',
              whileTyping: true,
              run: () => void reprint(),
            } satisfies Hotkey,
            {
              keys: 'F9',
              label: 'Anular (PIN)',
              whileTyping: true,
              run: () => setPrompt('VOID'),
            } satisfies Hotkey,
          ]
        : []),
      {
        keys: 'Esc',
        label: 'Inicio',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/'),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result?.orderId, router],
  );

  const canOperate = result?.orderId && result.status === 'COMPLETED';

  return (
    <PosShell
      title="Buscar boleto u orden"
      eyebrow="Consulta y posventa"
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

      <form onSubmit={(e) => void submit(e)} className={styles.search}>
        <input
          ref={inputRef}
          id="lookup-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escanea o teclea el código u orden…"
          aria-label="Código u orden"
        />
        <button type="submit" disabled={loading}>
          {loading ? '…' : 'Buscar'}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <section className={styles.result}>
          <header>
            <strong>{result.eventTitle ?? 'Orden'}</strong>
            <span className={result.valid ? styles.ok : styles.bad}>{result.status}</span>
          </header>
          <dl>
            {result.seatInfo && (
              <div>
                <dt>Lugar</dt>
                <dd>{result.seatInfo}</dd>
              </div>
            )}
            {result.publicId && (
              <div>
                <dt>Orden</dt>
                <dd>{result.publicId}</dd>
              </div>
            )}
            {result.total != null && (
              <div>
                <dt>Total</dt>
                <dd>{money(result.total)}</dd>
              </div>
            )}
            {result.paymentMethod && (
              <div>
                <dt>Pago</dt>
                <dd>{result.paymentMethod}</dd>
              </div>
            )}
          </dl>

          <div className={styles.actions}>
            {result.orderId && (
              <button type="button" onClick={() => void reprint()}>
                Reimprimir · F7
              </button>
            )}
            {canOperate && (
              <>
                <button type="button" className={styles.danger} onClick={() => setPrompt('VOID')}>
                  Anular · F9
                </button>
                <button type="button" onClick={() => setPrompt('EXCHANGE')}>
                  Cambio de boletos
                </button>
              </>
            )}
          </div>

          <p className={styles.note}>
            Anulación y cambio requieren PIN de gerente. El cajero no puede modificar precios ni
            emitir devoluciones por su cuenta.
          </p>
        </section>
      )}

      <ManagerPinDialog
        open={prompt === 'VOID'}
        title="Anular esta venta"
        detail={`${result?.publicId ?? ''} · ${money(result?.total ?? 0)}. El importe se descuenta del corte del turno y la operación queda auditada.`}
        confirmLabel="Anular venta"
        danger
        onCancel={() => setPrompt(null)}
        onConfirm={(pin) => doVoid(pin)}
      />

      <ManagerPinDialog
        open={prompt === 'EXCHANGE'}
        title="Cambio de boletos"
        detail="Se anula la orden actual y se emite una nueva. La diferencia se cobra o devuelve en efectivo."
        confirmLabel="Realizar cambio"
        onCancel={() => setPrompt(null)}
        onConfirm={(pin) => doExchange(pin)}
      />
    </PosShell>
  );
}
