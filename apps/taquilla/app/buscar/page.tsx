'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, NamedStatus, TicketButton, formatTicketAmount } from '@boletera/ui';
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

/** Solo los estados que el lenguaje ya nombra; el resto se lee tal cual en mono. */
function namedStatus(status: string): 'cobrado' | 'reembolsado' | null {
  if (status === 'COMPLETED') return 'cobrado';
  if (status === 'REFUNDED') return 'reembolsado';
  return null;
}

function StatusMark({ status }: { status: string }) {
  const named = namedStatus(status);
  return named ? (
    <NamedStatus status={named} />
  ) : (
    <span className={styles.rawStatus}>{status}</span>
  );
}

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
    [result?.orderId, router]
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

      <p className={styles.lead}>
        Consulta boletos, reimprime y gestiona posventa con PIN de gerente.
      </p>

      <form onSubmit={(e) => void submit(e)} className={styles.searchForm}>
        <Field
          ref={inputRef}
          id="lookup-input"
          kind="search"
          label="Código u orden"
          hint="El lector funciona sin foco en el campo. F3 enfoca."
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escanea o teclea el código u orden"
          className={styles.lookupField}
        />
        <TicketButton
          type="submit"
          variant={result ? 'secondary' : 'primary'}
          disabled={loading}
          className={styles.searchButton}
        >
          {loading ? 'Buscando' : 'Buscar'}
        </TicketButton>
      </form>

      {error && (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className={styles.result} aria-label="Resultado">
          <div className={styles.resultHead}>
            <div>
              <h2 className={styles.resultTitle}>{result.eventTitle ?? 'Orden'}</h2>
              {result.publicId ? (
                <p className={styles.resultMeta}>Folio {result.publicId}</p>
              ) : null}
            </div>
            <StatusMark status={result.status} />
          </div>

          <dl className={styles.details}>
            {result.seatInfo && (
              <div>
                <dt>Lugar</dt>
                <dd>{result.seatInfo}</dd>
              </div>
            )}
            {result.publicId && (
              <div>
                <dt>Orden</dt>
                <dd className={styles.mono}>{result.publicId}</dd>
              </div>
            )}
            {result.total != null && (
              <div>
                <dt>Total</dt>
                <dd className={styles.figure}>{formatTicketAmount(result.total)}</dd>
              </div>
            )}
            {result.paymentMethod && (
              <div>
                <dt>Pago</dt>
                <dd className={styles.mono}>{result.paymentMethod}</dd>
              </div>
            )}
          </dl>

          {result.tickets && result.tickets.length > 0 && (
            <div className={styles.ticketBlock}>
              <h3 className={styles.ticketHeading}>Boletos en la orden</h3>
              <ul className={styles.ticketList}>
                {result.tickets.map((t) => (
                  <li key={t.code}>
                    <code>{t.code}</code>
                    <span>{t.seatInfo || '—'}</span>
                    <span className={styles.rawStatus}>{t.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.actions}>
            {result.orderId && (
              <TicketButton onClick={() => void reprint()}>Reimprimir · F7</TicketButton>
            )}
            {canOperate && (
              <>
                <TicketButton variant="danger" onClick={() => setPrompt('VOID')}>
                  Anular · F9
                </TicketButton>
                <TicketButton variant="secondary" onClick={() => setPrompt('EXCHANGE')}>
                  Cambio de boletos
                </TicketButton>
              </>
            )}
          </div>

          <p className={styles.note}>
            Anulación y cambio requieren PIN de gerente. El cajero no puede modificar precios ni
            emitir devoluciones por su cuenta.
          </p>
        </section>
      )}

      {!result && !loading && !error && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Busca un boleto o orden</p>
          <p className={styles.note}>Escanea el código impreso o teclea el folio de la orden.</p>
          <ul className={styles.hints}>
            <li>F7 reimprime cuando hay resultado</li>
            <li>F9 anula con PIN de gerente</li>
          </ul>
        </div>
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
