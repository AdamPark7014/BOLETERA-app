'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { secondsUntil, useCartStore } from '@/lib/cart-store';
import { formatCountdown } from '@/lib/payment-window';
import styles from './CartBar.module.scss';

export function CartBar() {
  const items = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!items.length) return null;
  void tick;

  const seats = items.reduce((s, i) => s + (i.seatCount || 0), 0);
  const soonest = Math.min(...items.map((i) => secondsUntil(i.expiresAt)));

  return (
    <aside className={styles.bar} aria-label="Carrito flotante">
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.badge}>{items.length}</span>
        <span className={styles.toggleText}>
          Carrito · {seats} asiento{seats === 1 ? '' : 's'}
        </span>
        <span className={`${styles.clock} ${soonest < 120 ? styles.urgent : ''}`}>
          {soonest > 0 ? formatCountdown(soonest) : 'Exp.'}
        </span>
      </button>

      {open && (
        <div className={styles.panel}>
          <ul>
            {items.map((item, i) => {
              const sec = secondsUntil(item.expiresAt);
              return (
                <li key={`${item.eventId}-${i}`}>
                  <div>
                    <strong>{item.eventTitle}</strong>
                    <span className={sec < 120 ? styles.urgent : undefined}>
                      {sec > 0 ? formatCountdown(sec) : 'Expirado'}
                    </span>
                  </div>
                  <button type="button" onClick={() => removeAt(i)} aria-label="Quitar del carrito">
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/cart" className={styles.cta} onClick={() => setOpen(false)}>
            Ver carrito y pagar
          </Link>
        </div>
      )}
    </aside>
  );
}
