'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      {
        keys: 'F4',
        label: 'Enfocar búsqueda',
        whileTyping: true,
        run: () => document.getElementById('willcall-q')?.focus(),
      },
      { keys: 'Enter', label: 'Buscar', displayOnly: true },
      {
        keys: 'Esc',
        label: 'Inicio',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/'),
      },
    ],
    [router],
  );

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await willcallLookup(q.trim());
      setRows(data as Row[]);
      setVerified({});
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function fulfill(orderId: string) {
    if (!verified[orderId]) {
      setToast('Confirma ID del comprador antes de entregar');
      return;
    }
    try {
      await willcallFulfill(orderId);
      setToast('Entregado ✓');
      await search();
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
      title="Entregar boletos"
      eyebrow="Will-call"
      backHref="/"
      size="md"
      hotkeys={hotkeys}
      escapeGoesBack={false}
    >
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      <p className={styles.hint}>
        Pide identificación, verifica nombre/email y marca “ID verificado” antes de entregar.
      </p>

      <form onSubmit={(e) => void search(e)} className={styles.search}>
        <input
          id="willcall-q"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, email u orden…"
          aria-label="Buscar will-call"
        />
        <kbd>F4</kbd>
        <button type="submit" disabled={loading}>
          {loading ? '…' : 'Buscar'}
        </button>
      </form>

      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.orderId} className={r.pickedUpAt ? styles.picked : undefined}>
            <div className={styles.body}>
              <div className={styles.head}>
                <strong>{r.buyerName || 'Sin nombre'}</strong>
                <span className={r.pickedUpAt ? styles.badgeDone : styles.badgeWait}>
                  {r.pickedUpAt ? 'Entregado' : 'Pendiente'}
                </span>
              </div>
              <span className={styles.meta}>
                {r.publicId} · {r.buyerEmail || 'sin email'}
              </span>
              <span className={styles.meta}>{r.eventTitle} · ${r.total.toFixed(2)}</span>
              <ul className={styles.ticketList}>
                {r.tickets.map((t) => (
                  <li key={t.code}>
                    <code>{t.code}</code>
                    <em>{t.seatInfo || t.status}</em>
                  </li>
                ))}
              </ul>
              {r.pickedUpAt && (
                <em className={styles.done}>
                  Entregado {new Date(r.pickedUpAt).toLocaleString('es-MX')}
                </em>
              )}
              {!r.pickedUpAt && (
                <label className={styles.verify}>
                  <input
                    type="checkbox"
                    checked={Boolean(verified[r.orderId])}
                    onChange={(e) =>
                      setVerified((v) => ({ ...v, [r.orderId]: e.target.checked }))
                    }
                  />
                  ID verificado (nombre coincide)
                </label>
              )}
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={() => void reprint(r.orderId)}>
                Reimprimir
              </button>
              {!r.pickedUpAt && (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!verified[r.orderId]}
                  onClick={() => void fulfill(r.orderId)}
                >
                  Entregar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!loading && searched && rows.length === 0 && (
        <p className={styles.empty}>Sin resultados para “{q}”</p>
      )}
      {!searched && !loading && (
        <p className={styles.empty}>Escribe un nombre, email o folio de orden para comenzar.</p>
      )}
    </PosShell>
  );
}
