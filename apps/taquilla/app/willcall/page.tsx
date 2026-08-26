'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EVENT_STOCK_IMAGES } from '@boletera/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  SearchInput,
} from '@boletera/ui';
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

      <Card
        padding="none"
        className={styles.heroCard}
        style={{ backgroundImage: `url(${EVENT_STOCK_IMAGES.OPEN_AIR})` }}
      >
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <Badge tone="accent" variant="soft">Identificación obligatoria</Badge>
          <p>
            Pide identificación, verifica nombre/email y marca “ID verificado” antes de entregar
            boletos comprados en línea.
          </p>
        </div>
      </Card>

      <Card padding="md" className={styles.searchCard}>
        <form onSubmit={(e) => void search(e)} className={styles.searchForm}>
          <SearchInput
            id="willcall-q"
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Nombre, email u orden…"
            aria-label="Buscar will-call"
            inputSize="lg"
            shortcut="F4"
          />
          <Button type="submit" size="lg" loading={loading} loadingLabel="Buscando…">
            Buscar
          </Button>
        </form>
      </Card>

      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.orderId}>
            <Card
              padding="md"
              variant="outline"
              className={r.pickedUpAt ? styles.picked : undefined}
            >
              <CardHeader
                title={r.buyerName || 'Sin nombre'}
                description={`${r.publicId} · ${r.buyerEmail || 'sin email'}`}
                actions={
                  <Badge
                    tone={r.pickedUpAt ? 'success' : 'warning'}
                    variant="soft"
                    dot
                  >
                    {r.pickedUpAt ? 'Entregado' : 'Pendiente'}
                  </Badge>
                }
              />

              <p className={styles.eventMeta}>
                {r.eventTitle} · ${r.total.toFixed(2)}
              </p>

              <ul className={styles.ticketList}>
                {r.tickets.map((t) => (
                  <li key={t.code}>
                    <code>{t.code}</code>
                    <span>{t.seatInfo || t.status}</span>
                    <Badge tone="neutral" variant="outline" size="sm">{t.status}</Badge>
                  </li>
                ))}
              </ul>

              {r.pickedUpAt && (
                <p className={styles.doneTime}>
                  Entregado {new Date(r.pickedUpAt).toLocaleString('es-MX')}
                </p>
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

              <div className={styles.actions}>
                <Button variant="secondary" size="md" onClick={() => void reprint(r.orderId)}>
                  Reimprimir
                </Button>
                {!r.pickedUpAt && (
                  <Button
                    variant="primary"
                    size="md"
                    disabled={!verified[r.orderId]}
                    onClick={() => void fulfill(r.orderId)}
                  >
                    Entregar
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {!loading && searched && rows.length === 0 && (
        <EmptyState
          illustration="inbox"
          title="Sin resultados"
          description={`No hay órdenes will-call para “${q}”.`}
          size="sm"
        />
      )}
      {!searched && !loading && (
        <EmptyState
          illustration="seats"
          title="Busca una orden"
          description="Escribe un nombre, email o folio de orden para comenzar."
          size="sm"
        />
      )}
    </PosShell>
  );
}
