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
    return () => controller.abort();
  }, []);

  if (!sales || sales.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="sales-title">
      <h2 id="sales-title">Mis ventas en reventa</h2>
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
