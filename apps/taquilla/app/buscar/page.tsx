'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EVENT_STOCK_IMAGES } from '@boletera/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
} from '@boletera/ui';
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

function statusTone(status: string, valid?: boolean): 'success' | 'warning' | 'danger' | 'neutral' {
  if (valid) return 'success';
  if (status === 'REFUNDED' || status === 'VOIDED') return 'warning';
  if (status === 'COMPLETED') return 'success';
  return 'warning';
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

      <Card
        padding="none"
        className={styles.heroCard}
        style={{ backgroundImage: `url(${EVENT_STOCK_IMAGES.THEATER})` }}
      >
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <Badge tone="accent" variant="soft">Escaneo o folio</Badge>
          <p>Consulta boletos, reimprime y gestiona posventa con PIN de gerente.</p>
        </div>
      </Card>

      <Card padding="md" className={styles.searchCard}>
        <form onSubmit={(e) => void submit(e)} className={styles.searchForm}>
          <Input
            ref={inputRef}
            id="lookup-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escanea o teclea el código u orden…"
            aria-label="Código u orden"
            inputSize="lg"
            className={styles.lookupField}
          />
          <Button type="submit" size="lg" loading={loading} loadingLabel="Buscando…">
            Buscar
          </Button>
        </form>
        <p className={styles.scanNote}>
          El lector HID funciona sin foco en el campo. También puedes usar <kbd>F3</kbd> para enfocar.
        </p>
      </Card>

      {error && (
        <Card variant="outline" padding="md" className={styles.errorCard}>
          <p className={styles.error}>{error}</p>
        </Card>
      )}

      {result && (
        <Card padding="md" className={styles.resultCard}>
          <CardHeader
            title={result.eventTitle ?? 'Orden'}
            description={result.publicId ? `Folio ${result.publicId}` : undefined}
            actions={
              <Badge tone={statusTone(result.status, result.valid)} variant="soft" dot>
                {result.status}
              </Badge>
            }
          />

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
                <dd>{money(result.total)}</dd>
              </div>
            )}
            {result.paymentMethod && (
              <div>
                <dt>Pago</dt>
                <dd>
                  <Badge tone="neutral" variant="outline" size="sm">
                    {result.paymentMethod}
                  </Badge>
                </dd>
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
                    <span>{t.seatInfo || t.status}</span>
                    <Badge
                      tone={t.status === 'VALID' || t.status === 'ACTIVE' ? 'success' : 'warning'}
                      variant="soft"
                      size="sm"
                    >
                      {t.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.actions}>
            {result.orderId && (
              <Button variant="secondary" size="lg" onClick={() => void reprint()}>
                Reimprimir · F7
              </Button>
            )}
            {canOperate && (
              <>
                <Button variant="danger" size="lg" onClick={() => setPrompt('VOID')}>
                  Anular · F9
                </Button>
                <Button variant="outline" size="lg" onClick={() => setPrompt('EXCHANGE')}>
                  Cambio de boletos
                </Button>
              </>
            )}
          </div>

          <p className={styles.note}>
            Anulación y cambio requieren PIN de gerente. El cajero no puede modificar precios ni
            emitir devoluciones por su cuenta.
          </p>
        </Card>
      )}

      {!result && !loading && !error && (
        <EmptyState
          illustration="search"
          title="Busca un boleto o orden"
          description="Escanea el código impreso o teclea el folio de la orden."
          hints={['F7 reimprime cuando hay resultado', 'F9 anula con PIN de gerente']}
          size="sm"
        />
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
