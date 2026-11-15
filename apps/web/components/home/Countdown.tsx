'use client';

import { useEffect, useState } from 'react';
import styles from './home.module.scss';

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 60000));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Cuenta regresiva a una fecha real del API. Hasta montar muestra «--» con el mismo tamaño. */
export function Countdown({ target, label }: { target: string; label: string }) {
  const [left, setLeft] = useState<ReturnType<typeof parts> | null>(null);

  useEffect(() => {
    const tick = () => setLeft(parts(new Date(target).getTime() - Date.now()));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [target]);

  return (
    <div className={styles.countdown}>
      <span className={styles.countLabel}>{label}</span>
      <span className={styles.countDigits}>
        <span>
          {left ? pad(left.d) : '--'}
          <small>D</small>
        </span>
        <span>
          {left ? pad(left.h) : '--'}
          <small>H</small>
        </span>
        <span>
          {left ? pad(left.m) : '--'}
          <small>M</small>
        </span>
      </span>
    </div>
  );
}
