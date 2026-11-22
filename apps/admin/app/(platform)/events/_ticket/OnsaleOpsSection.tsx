'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import styles from './frame.module.scss';

type Snapshot = {
  eventId: string;
  saleClosed: boolean;
  waitingRoom: {
    enabled: boolean;
    paused: boolean;
    opensAt: string | null;
    batchSize: number;
    batchIntervalSeconds: number;
    queueSize: number;
    admittedEstimate: number;
  };
  activeHolds: number;
  last30Min: {
    orders: number;
    tickets: number;
    revenue: number;
    paidOrders: number;
    failedOrders: number;
    paymentSuccessRate: number;
  };
  errorsPerMinute: { minute: string; count4xx: number; count5xx: number }[];
};

type Props = {
  eventId: string;
  token: string;
  canWrite: boolean;
};

export function OnsaleOpsSection({ eventId, token, canWrite }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const row = await adminApi<Snapshot>(`/admin/events/${eventId}/onsale-ops`, token);
      setData(row);
      setState(
        row.waitingRoom.enabled || row.activeHolds > 0 || row.last30Min.orders > 0
          ? 'ready'
          : 'empty'
      );
      setNote(null);
    } catch {
      setState('error');
      setNote('No se pudo leer la operación en vivo.');
    }
  }, [eventId, token]);

  useEffect(() => {
    let alive = true;
    void load().then(() => {
      if (!alive) return;
    });
    const id = setInterval(() => {
      void load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    if (!canWrite) return;
    setBusy(true);
    try {
      const row = await adminApi<Snapshot>(`/admin/events/${eventId}/onsale-ops`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setData(row);
      setState('ready');
    } catch {
      setNote('No se pudo aplicar el cambio.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <section aria-busy="true">
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Operación en vivo</h1>
          <p className={styles.quiet}>Cargando.</p>
        </header>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Operación en vivo</h1>
          <p className={styles.quiet}>{note ?? 'Error.'}</p>
        </header>
        <button type="button" className={styles.ghostLink} onClick={() => void load()}>
          Reintentar
        </button>
      </section>
    );
  }

  if (!data || state === 'empty') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Operación en vivo</h1>
          <p className={styles.quiet}>Todavía no hay actividad de venta en este evento.</p>
        </header>
      </section>
    );
  }

  const err4 = data.errorsPerMinute.reduce((n, r) => n + r.count4xx, 0);
  const err5 = data.errorsPerMinute.reduce((n, r) => n + r.count5xx, 0);
  const ordersPerMin = data.last30Min.orders / 30;
  const ticketsPerMin = data.last30Min.tickets / 30;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Operación en vivo</h1>
        <p className={styles.quiet}>Se actualiza cada 5 segundos.</p>
      </header>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>En fila</span>
          <span className={styles.kpiValue}>{data.waitingRoom.queueSize}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Admitidos (est.)</span>
          <span className={styles.kpiValue}>{data.waitingRoom.admittedEstimate}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Apartados</span>
          <span className={styles.kpiValue}>{data.activeHolds}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Órdenes / min</span>
          <span className={styles.kpiValue}>{ordersPerMin.toFixed(1)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Boletos / min</span>
          <span className={styles.kpiValue}>{ticketsPerMin.toFixed(1)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Ingresos 30 min</span>
          <span className={styles.kpiValue}>
            {data.last30Min.revenue.toLocaleString('es-MX', {
              style: 'currency',
              currency: 'MXN',
            })}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Pago exitoso</span>
          <span className={styles.kpiValue}>
            {Math.round(data.last30Min.paymentSuccessRate * 100)}%
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Errores 4xx / 5xx (30 min)</span>
          <span className={styles.kpiValue}>
            {err4} / {err5}
          </span>
        </div>
      </div>

      {note ? <p className={styles.quiet}>{note}</p> : null}

      {canWrite ? (
        <div className={styles.row} style={{ gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            type="button"
            disabled={busy || !data.waitingRoom.enabled}
            className={styles.ghostLink}
            onClick={() => void patch({ pauseAdmission: !data.waitingRoom.paused })}
          >
            {data.waitingRoom.paused ? 'Reanudar admisión' : 'Pausar admisión'}
          </button>
          <button
            type="button"
            disabled={busy || !data.waitingRoom.enabled}
            className={styles.ghostLink}
            onClick={() =>
              void patch({
                batchSize: Math.max(50, Math.floor(data.waitingRoom.batchSize * 1.25)),
              })
            }
          >
            Subir ritmo (+25%)
          </button>
          <button
            type="button"
            disabled={busy || !data.waitingRoom.enabled}
            className={styles.ghostLink}
            onClick={() =>
              void patch({
                batchSize: Math.max(20, Math.floor(data.waitingRoom.batchSize * 0.75)),
              })
            }
          >
            Bajar ritmo (−25%)
          </button>
          <button
            type="button"
            disabled={busy || data.saleClosed}
            className={styles.ghostLink}
            onClick={() => {
              if (window.confirm('¿Cerrar la venta de este evento?')) {
                void patch({ closeSale: true });
              }
            }}
          >
            {data.saleClosed ? 'Venta cerrada' : 'Cerrar venta'}
          </button>
        </div>
      ) : (
        <p className={styles.quiet}>Solo lectura para tu rol.</p>
      )}
    </section>
  );
}
