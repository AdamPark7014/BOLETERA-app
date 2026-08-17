'use client';

/**
 * Alertas de fraude.
 *
 * Cambios de fondo: los filtros de severidad y estado los aplica el servidor
 * (`GET /fraud/flags?severity&status&limit&offset`), la resolución pide una nota
 * real en vez de escribir siempre "Revisado y aprobado por admin", y una lista
 * vacía ya no se confunde con un 403.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import { resolveFraudFlag } from '@/lib/platform-api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../_styles/platform.module.scss';
import styles from '../orders/orders.module.scss';
import { EmptyBlock, Notice, ResourceView } from '../orders/_ui/States';
import { useResource } from '../orders/_ui/useResource';
import { formatDateTime } from '../orders/_ui/format';

type FraudFlag = {
  id: string;
  type: string;
  severity: string;
  score: number;
  reason: string;
  status: string;
  createdAt?: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  order?: { publicId: string } | null;
  orderId?: string | null;
  user?: { email: string } | null;
};

const SEVERITY: Record<string, { label: string; cls: string }> = {
  CRITICAL: { label: 'Crítica', cls: 'canceled' },
  HIGH: { label: 'Alta', cls: 'canceled' },
  MEDIUM: { label: 'Media', cls: 'pending' },
  LOW: { label: 'Baja', cls: 'refunded' },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Sin revisar', cls: 'pending' },
  REVIEWING: { label: 'En revisión', cls: 'hold' },
  RESOLVED: { label: 'Resuelta', cls: 'paid' },
  CONFIRMED: { label: 'Fraude confirmado', cls: 'canceled' },
  FALSE_POSITIVE: { label: 'Falso positivo', cls: 'refunded' },
};

const SEVERITY_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const STATUS_FILTERS = ['ALL', 'PENDING', 'RESOLVED'];

export default function FraudPage() {
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const resource = useResource<FraudFlag[]>(
    useCallback(
      async ({ token, signal }) => {
        const params = new URLSearchParams({ limit: '50' });
        if (severity !== 'ALL') params.set('severity', severity);
        if (status !== 'ALL') params.set('status', status);
        const res = await adminApi<{ data?: FraudFlag[] } | FraudFlag[]>(
          `/fraud/flags?${params.toString()}`,
          token,
          { signal },
        );
        return Array.isArray(res) ? res : (res.data ?? []);
      },
      [severity, status],
    ),
    { requiresOrg: false, deps: [severity, status] },
  );

  async function resolve(flag: FraudFlag) {
    const token = getStoredToken();
    if (!token) return;
    const resolution = window.prompt(
      `Resolución de la alerta ${flag.type}. Queda registrada en la bitácora:`,
      '',
    );
    if (resolution === null) return;
    if (!resolution.trim()) {
      toast.error('Escribe la resolución: una alerta cerrada sin motivo no sirve para auditar.');
      return;
    }
    setBusy(flag.id);
    try {
      await resolveFraudFlag(token, flag.id, resolution.trim());
      toast.success('Alerta resuelta');
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.userMessage : 'No se pudo resolver la alerta');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Fraude y cumplimiento</h1>
          <p>Alertas, revisión manual y resolución</p>
        </div>
      </header>

      <Notice tone="info" title="Alcance de esta lista">
        <p>
          El API todavía no filtra las alertas por organización, así que un usuario con permiso
          puede ver alertas de otros promotores. Verifica el folio antes de actuar.
        </p>
      </Notice>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filtrar por severidad">
          {SEVERITY_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={severity === s}
              className={severity === s ? styles.filterActive : styles.filter}
              onClick={() => setSeverity(s)}
            >
              {s === 'ALL' ? 'Toda severidad' : (SEVERITY[s]?.label ?? s)}
            </button>
          ))}
        </div>
        <div className={styles.filters} role="group" aria-label="Filtrar por estado">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              className={status === s ? styles.filterActive : styles.filter}
              onClick={() => setStatus(s)}
            >
              {s === 'ALL' ? 'Todo estado' : (STATUS[s]?.label ?? s)}
            </button>
          ))}
        </div>
      </div>

      <section className={platform.panel}>
        <ResourceView resource={resource} context="las alertas de fraude" loadingRows={5}>
          {(flags) =>
            flags.length === 0 ? (
              <EmptyBlock
                title={
                  severity === 'ALL' && status === 'ALL'
                    ? 'Sin alertas de fraude registradas'
                    : 'Ninguna alerta con esos filtros'
                }
                hint={
                  severity === 'ALL' && status === 'ALL'
                    ? 'El motor de reglas no ha marcado ninguna orden.'
                    : 'Quita algún filtro para ver el resto.'
                }
              />
            ) : (
              <table className={platform.table}>
                <caption className={styles.srOnly}>
                  Alertas de fraude con tipo, severidad, puntaje, estado y motivo
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Severidad</th>
                    <th scope="col" className={styles.numeric}>
                      Puntaje
                    </th>
                    <th scope="col">Orden</th>
                    <th scope="col">Motivo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => {
                    const sev = SEVERITY[f.severity] ?? { label: f.severity, cls: 'refunded' };
                    const st = STATUS[f.status] ?? { label: f.status, cls: 'refunded' };
                    const open = f.status !== 'RESOLVED' && f.status !== 'FALSE_POSITIVE';
                    return (
                      <tr key={f.id} className={f.severity === 'CRITICAL' ? styles.rowAlert : undefined}>
                        <th scope="row" className={styles.rowHead}>
                          {f.type}
                          {f.createdAt && <small>{formatDateTime(f.createdAt)}</small>}
                        </th>
                        <td>
                          <span className={`${styles.status} ${styles[sev.cls]}`}>{sev.label}</span>
                        </td>
                        <td className={styles.numeric}>{f.score}</td>
                        <td>
                          {f.orderId ? (
                            <Link href={`/orders/${f.orderId}`} className={styles.folioLink}>
                              <code className={styles.code}>{f.order?.publicId ?? 'Ver orden'}</code>
                            </Link>
                          ) : (
                            <span className={styles.subtle}>{f.user?.email ?? '—'}</span>
                          )}
                        </td>
                        <td>
                          {f.reason}
                          {f.resolution && (
                            <>
                              <br />
                              <small className={styles.subtle}>Resolución: {f.resolution}</small>
                            </>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.status} ${styles[st.cls]}`}>{st.label}</span>
                        </td>
                        <td>
                          {open ? (
                            <button
                              type="button"
                              className={platform.ghostBtn}
                              disabled={busy !== null}
                              onClick={() => void resolve(f)}
                            >
                              {busy === f.id ? 'Guardando…' : 'Resolver'}
                            </button>
                          ) : (
                            <span className={styles.subtle}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>
    </div>
  );
}
