'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, NamedStatus, TicketButton, formatTicketAmount } from '@boletera/ui';
import { getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import type { Hotkey } from '@/lib/hotkeys';
import {
  fetchReceipt,
  getTerminalId,
  printReceipt,
  willcallFulfill,
  willcallLookup,
} from '@/lib/pos';
import styles from './willcall.module.scss';

type Row = {
  orderId: string;
  publicId: string;
  buyerName: string;
  buyerEmail: string;
  total: number;
  eventTitle: string;
  pickedUpAt: string | null;
  tickets: { code: string; seatInfo: string; status: string }[];
};

export default function WillcallPage() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  const selected = rows.find((r) => r.orderId === selectedId) ?? null;

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      {
        keys: '/',
        label: 'Buscar',
        whileTyping: true,
        match: (e) => e.key === '/' && !e.ctrlKey && !e.metaKey,
        run: () => searchRef.current?.focus(),
      },
      {
        keys: 'F4',
        label: 'Buscar',
        whileTyping: true,
        run: () => searchRef.current?.focus(),
      },
      {
        keys: 'Enter',
        label: 'Entregar',
        whileTyping: true,
        match: (e) => e.key === 'Enter' && document.activeElement === document.getElementById('entregar'),
        run: () => {
          if (selected && !selected.pickedUpAt && verified[selected.orderId]) {
            void fulfill(selected.orderId);
          }
        },
      },
      {
        keys: 'Esc',
        label: 'Venta',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/venta'),
      },
    ],
    // fulfill is stable enough for this screen: it closes over the latest search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, selected, verified],
  );

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = (await willcallLookup(q.trim())) as Row[];
      setRows(data);
      setVerified({});
      setSelectedId(data[0]?.orderId ?? null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo buscar');
      setRows([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }

  async function fulfill(orderId: string) {
    if (!verified[orderId]) {
      setToast('Revisa la identificación.');
      return;
    }
    try {
      await willcallFulfill(orderId);
      setToast(null);
      setRows((list) =>
        list.map((r) => (r.orderId === orderId ? { ...r, pickedUpAt: new Date().toISOString() } : r)),
      );
      setVerified((v) => ({ ...v, [orderId]: false }));
      searchRef.current?.focus();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo entregar');
    }
  }

  async function reprint(orderId: string) {
    const rec = await fetchReceipt(orderId, getTerminalId() || 'terminal');
    await printReceipt(rec);
  }

  return (
    <PosShell
      title="Entregar"
      backHref="/venta"
      size="wide"
      hotkeys={hotkeys}
      escapeGoesBack={false}
    >
      {toast ? (
        <p className={styles.note} role="status">
          {toast}
        </p>
      ) : null}

      <div className={styles.counter}>
        <div>
          <form onSubmit={(e) => void search(e)}>
            <Field
              ref={searchRef}
              id="willcall-q"
              kind="search"
              label="Buscar"
              hint="Nombre, correo o folio"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </form>

          {loading ? <p className={styles.note}>Buscando.</p> : null}
          {!loading && searched && rows.length === 0 ? (
            <p className={styles.note}>Nada con ese criterio.</p>
          ) : null}

          <ul className={styles.list}>
            {rows.map((r) => (
              <li key={r.orderId}>
                <button
                  type="button"
                  className={r.orderId === selectedId ? styles.rowOn : styles.row}
                  onClick={() => {
                    setSelectedId(r.orderId);
                    setVerified((v) => ({ ...v, [r.orderId]: false }));
                  }}
                >
                  <span className={styles.main}>
                    <strong>{r.buyerName || 'Sin nombre'}</strong>
                    <small>
                      {r.publicId} · {r.eventTitle}
                    </small>
                  </span>
                  {r.pickedUpAt ? (
                    <span className={styles.done}>Entregado</span>
                  ) : (
                    <NamedStatus status="pendiente" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <aside className={styles.side}>
          {selected ? (
            <>
              <p className={styles.buyer}>{selected.buyerName || 'Sin nombre'}</p>
              <p className={styles.meta}>{selected.buyerEmail || 'Sin correo'}</p>
              <ul className={styles.tickets}>
                {selected.tickets.map((t) => (
                  <li key={t.code}>
                    <span>{t.seatInfo || t.code}</span>
                    <span>{t.status}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.total}>{formatTicketAmount(selected.total)} MXN</p>
              {!selected.pickedUpAt ? (
                <button
                  type="button"
                  className={verified[selected.orderId] ? styles.checkOn : styles.check}
                  aria-pressed={Boolean(verified[selected.orderId])}
                  onClick={() =>
                    setVerified((v) => ({ ...v, [selected.orderId]: !v[selected.orderId] }))
                  }
                >
                  Identificación revisada
                </button>
              ) : (
                <p className={styles.meta}>
                  {new Date(selected.pickedUpAt).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
              <button type="button" className={styles.secondary} onClick={() => void reprint(selected.orderId)}>
                Imprimir
              </button>
            </>
          ) : (
            <p className={styles.note}>Elige una orden.</p>
          )}
          <TicketButton
            id="entregar"
            fullWidth
            disabled={!selected || Boolean(selected.pickedUpAt) || !verified[selected?.orderId ?? '']}
            onClick={() => selected && void fulfill(selected.orderId)}
          >
            Entregar
          </TicketButton>
        </aside>
      </div>
    </PosShell>
  );
}
