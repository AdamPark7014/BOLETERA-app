'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatShortDate } from '@/lib/refund-policy';
import { API_BASE as API } from '@/lib/api';
import { authHeaders } from '@/lib/auth';
import { formatMoney } from '@/lib/pricing';
import styles from './cuenta.module.scss';

type Sale = {
  id: string;
  status: 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'DELISTED' | 'EXPIRED' | string;
  askingPrice: string;
  currency: string;
  event: { title: string; startsAt: string; slug: string };
  seat: string;
  payout: { amount: string; status: string; soldAt: string | null } | null;
};

const STATUS: Record<string, string> = {
  ACTIVE: 'A la venta',
  SOLD: 'Vendido',
  CANCELLED: 'Retirado',
  DELISTED: 'Retirado',
  EXPIRED: 'Vencido',
};

/**
 * «Mis ventas en reventa»: qué tengo publicado y cuánto recibiré. Solo aparece
 * si la persona ha publicado algo; si falla, no estorba al resto de la cuenta.
 */
export function MySalesSection() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [clabe, setClabe] = useState('');
  const [clabeMasked, setClabeMasked] = useState<string | null>(null);
  const [clabeMsg, setClabeMsg] = useState<string | null>(null);
  const [savingClabe, setSavingClabe] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/resale/mine`, {
      headers: authHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Sale[]) => setSales(Array.isArray(rows) ? rows : []))
      .catch(() => setSales([]));
    fetch(`${API}/resale/mine/clabe`, {
      headers: authHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.clabe) setClabeMasked(String(data.clabe));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!sales || sales.length === 0) return null;

  async function saveClabe(e: React.FormEvent) {
    e.preventDefault();
    setSavingClabe(true);
    setClabeMsg(null);
    try {
      const res = await fetch(`${API}/resale/mine/clabe`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ clabe }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClabeMsg(typeof data.message === 'string' ? data.message : 'No se guardó la CLABE.');
        return;
      }
      setClabeMasked(data.clabe ?? null);
      setClabe('');
      setClabeMsg('CLABE guardada para tus depósitos de reventa.');
    } catch {
      setClabeMsg('No se guardó la CLABE. Revisa la conexión.');
    } finally {
      setSavingClabe(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="sales-title">
      <h2 id="sales-title">Mis ventas en reventa</h2>
      <form className={styles.orderLinks} onSubmit={saveClabe}>
        <label>
          CLABE para depósito
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            value={clabe}
            onChange={(e) => setClabe(e.target.value.replace(/\D/g, '').slice(0, 18))}
            placeholder={clabeMasked ?? '18 dígitos'}
            aria-describedby="clabe-help"
          />
        </label>
        <button type="submit" disabled={savingClabe || clabe.length !== 18}>
          Guardar CLABE
        </button>
        <p id="clabe-help">
          {clabeMsg ??
            (clabeMasked
              ? `Guardada: ${clabeMasked}. Estado del depósito en cada venta.`
              : 'La usamos solo para depositarte lo de tus ventas.')}
        </p>
      </form>
      <ul className={styles.list}>
        {sales.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.event.title}</strong>
              <span className={styles.status}>{STATUS[s.status] ?? s.status}</span>
            </div>
            <p>
              {formatShortDate(s.event.startsAt)}
              {s.seat ? ` · ${s.seat}` : ''}
            </p>
            <p>
              {s.payout
                ? `Recibes ${formatMoney(s.payout.amount, s.currency)} · ${
                    s.payout.status === 'PAID' ? 'depositado' : 'depósito en proceso'
                  }`
                : s.status === 'ACTIVE'
                  ? `Publicado en ${formatMoney(s.askingPrice, s.currency)}`
                  : null}
            </p>
            {s.status === 'ACTIVE' ? (
              <div className={styles.orderLinks}>
                <Link href="/resale">Ver en la reventa</Link>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
