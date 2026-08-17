'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { LogoMark } from '../_lib/icons';
import styles from '../login.module.scss';

function Sparkline() {
  return (
    <svg className={styles.spark} viewBox="0 0 320 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fafafa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fafafa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,80 C40,70 60,40 100,45 C140,50 160,20 200,28 C240,36 260,55 320,30 L320,100 L0,100 Z"
        fill="url(#sparkGrad)"
      />
      <path
        d="M0,80 C40,70 60,40 100,45 C140,50 160,20 200,28 C240,36 260,55 320,30"
        fill="none"
        stroke="#fafafa"
        strokeOpacity="0.85"
        strokeWidth="1.5"
      />
    </svg>
  );
}

type AuthShellProps = {
  children: ReactNode;
  compact?: boolean;
};

export function AuthShell({ children, compact = false }: AuthShellProps) {
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    tick();
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.aurora} aria-hidden="true">
        <div className={styles.blob1} />
        <div className={styles.blob2} />
        <div className={styles.blob3} />
        <div className={styles.grid} />
      </div>

      <div className={compact ? `${styles.shell} ${styles.shellCompact}` : styles.shell}>
        <aside className={styles.brand}>
          <div className={styles.brandTop}>
            <div className={styles.logoBlock}>
              <div className={styles.logoMark}>
                <LogoMark />
              </div>
              <div>
                <p className={styles.logoText}>BOLETERA</p>
                <p className={styles.logoSub}>Administración</p>
              </div>
            </div>
            <span className={styles.badgeLive} aria-label={`Hora local ${time}`}>
              <span className={styles.dot} />
              {time || '—:—'}
            </span>
          </div>

          <div className={styles.brandHero}>
            <p className={styles.brandKicker}>Panel de organizador</p>
            <h2 className={styles.brandTitle}>
              Eventos, ventas
              <br />
              y liquidaciones.
            </h2>
            <p className={styles.brandCopy}>
              Inventario, taquilla, Banorte y reportes en un solo lugar.
            </p>
          </div>

          <div className={styles.statCards}>
            <div className={styles.statCard}>
              <span>Ventas hoy</span>
              <strong>$284,930</strong>
              <small className={styles.up}>▲ 12.4% vs ayer</small>
              <Sparkline />
            </div>
            <div className={styles.statRow}>
              <div className={styles.miniStat}>
                <span>Órdenes</span>
                <strong>1,283</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Terminales</span>
                <strong>24/26</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Scan rate</span>
                <strong>98.7%</strong>
              </div>
            </div>
          </div>

          <ul className={styles.features}>
            <li>
              <span className={styles.featDot} />
              Multi-canal: web · POS · API · admin
            </li>
            <li>
              <span className={styles.featDot} />
              Mapas 3D y holds en tiempo real
            </li>
            <li>
              <span className={styles.featDot} />
              Reportes, payouts y antifraude integrados
            </li>
          </ul>

          <p className={styles.brandFooter}>
            © {new Date().getFullYear()} Boletera · SOC 2 Type II · PCI-DSS L1
          </p>
        </aside>

        <section className={styles.panel}>
          <div className={styles.card}>{children}</div>
        </section>
      </div>
    </main>
  );
}

export function MobileBrand() {
  return (
    <div className={styles.mobileBrand}>
      <div className={styles.logoMark}>
        <LogoMark inverted />
      </div>
      <div>
        <p className={styles.logoTextDark}>BOLETERA</p>
        <p className={styles.logoSubDark}>Administración</p>
      </div>
    </div>
  );
}

export function StatusBanner({
  tone,
  id,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  id?: string;
  children: ReactNode;
}) {
  const Icon =
    tone === 'success' ? (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="m8 12 2.5 2.5L16 9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : tone === 'info' ? (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 11v5M12 7.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ) : (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );

  const className =
    tone === 'success' ? styles.success : tone === 'info' ? styles.info : styles.error;

  return (
    <div
      id={id}
      className={className}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {Icon}
      <span>{children}</span>
    </div>
  );
}
