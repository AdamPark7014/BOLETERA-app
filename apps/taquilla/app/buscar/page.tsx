'use client';

import { friendlyError } from '@/lib/errors';
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
    <span className={styles.rawStatus}>{statusLabel(status)}</span>
  );
}

/** Estados y métodos del API en palabras de ventanilla. */
function statusLabel(status: string) {
  const names: Record<string, string> = {
    COMPLETED: 'Cobrada',
    PENDING: 'Pendiente',
    CANCELLED: 'Anulada',
    REFUNDED: 'Reembolsada',
    SOLD: 'Vendido',
    USED: 'Ya entró',
    SCANNED: 'Ya entró',
    VOID: 'Anulado',
    VOIDED: 'Anulado',
    TRANSFERRED: 'Transferido',
    RESERVED: 'Apartado',
  };
  return names[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
}

function methodLabel(method: string) {
  const names: Record<string, string> = {
    CASH: 'Efectivo',
    CARD: 'Tarjeta',
    COMP: 'Cortesía',
    COURTESY: 'Cortesía',
    TRANSFER: 'Transferencia',
    ONLINE: 'En línea',
  };
  return names[method] ?? method;
}

/** «Preferente Oeste-A-1» → «Preferente Oeste · Fila A · Asiento 1»; «GA» → «General». */
function seatLabel(raw: string) {
  if (!raw || raw === 'ORDER') return null;
  if (raw === 'GA') return 'General';
  const parts = raw.split('-');
  if (parts.length === 3) return `${parts[0]} · Fila ${parts[1]} · Asiento ${parts[2]}`;
  return parts.join(' · ');
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
      setError(friendlyError(err, 'No se pudo buscar.', 'No encontramos ese boleto u orden.'));
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
      showToast(friendlyError(err, 'No se pudo reimprimir.'));
    }
  }

  async function doVoid(pin: string) {
    if (!result?.orderId) return;
    try {
      await voidOrder(result.orderId, 'Anulación desde taquilla', pin);
      setPrompt(null);
      showToast('Venta anulada y registrada en el corte');
      // Se relee del API: antes sólo cambiaba la etiqueta de la orden y los
      // boletos seguían diciendo SOLD aunque ya estaban liberados.
      void runLookup(result.publicId || result.orderId);
    } catch (err) {
      showToast(friendlyError(err, 'No se pudo anular.'));
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
      showToast(
        `Cambio realizado${data.publicId ? ` · nuevo folio ${data.publicId}` : ''} · diferencia ${money(Number(data.delta ?? 0))}`
      );
      // Muestra la orden NUEVA (sus boletos son los que valen en la puerta).
      if (data.publicId) {
        setQuery(data.publicId);
        void runLookup(data.publicId);
      } else {
        void runLookup(result.publicId || result.orderId);
      }
    } catch (err) {
      showToast(friendlyError(err, 'No se pudo hacer el cambio.'));
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

      <form onSubmit={(e) => void submit(e)} className={styles.searchForm}>
        <Field
          ref={inputRef}
          id="lookup-input"
          kind="search"
          label="Código u orden"
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
            {result.seatInfo && seatLabel(result.seatInfo) && (
              <div>
                <dt>Lugar</dt>
                <dd>{seatLabel(result.seatInfo)}</dd>
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
                <dt>Forma de pago</dt>
                <dd>{methodLabel(result.paymentMethod)}</dd>
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
                    <span>{seatLabel(t.seatInfo) || '—'}</span>
                    <span className={styles.rawStatus}>{statusLabel(t.status)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.actions}>
            {result.orderId && (
              <TicketButton onClick={() => void reprint()}>Reimprimir</TicketButton>
            )}
            {canOperate && (
              <>
                <TicketButton variant="danger" onClick={() => setPrompt('VOID')}>
                  Anular
                </TicketButton>
                <TicketButton variant="secondary" onClick={() => setPrompt('EXCHANGE')}>
                  Cambio de boletos
                </TicketButton>
              </>
            )}
          </div>

          <p className={styles.note}>Anular y cambiar piden PIN de gerente.</p>
        </section>
      )}

      {!result && !loading && !error && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Busca un boleto o orden</p>
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
