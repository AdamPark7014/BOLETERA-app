'use client';

/**
 * Liquidaciones a promotor.
 *
 * Dos descuadres se señalan en vez de esconderse:
 *
 *  1. `netAmount` contra `grossRevenue - commission`. Si el payout guardado no
 *     cuadra consigo mismo, transferir por SPEI ese importe es un error caro.
 *  2. El bloque "por canal" suma `Order.totalAmount`, es decir lo que la orden
 *     *esperaba* cobrar. Desde que `Payment.amount` guarda lo realmente
 *     liquidado, ese bruto puede no coincidir con el estado de cuenta. El API
 *     no expone hoy la suma de lo liquidado, así que la cifra se etiqueta como
 *     esperada en lugar de presentarla como dinero en banco.
 */

import { useCallback, useMemo, useState } from 'react';
import { adminApi, ApiError, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../_styles/platform.module.scss';
import styles from '../orders/orders.module.scss';
import { EmptyBlock, Notice, ResourceView } from '../orders/_ui/States';
import { useResource } from '../orders/_ui/useResource';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyDelta,
  formatNumber,
  isSettlementMismatch,
  toNumber,
} from '../orders/_ui/format';

type ChannelRow = {
  channel: string;
  currency: string;
  _sum: { totalAmount: string | null; commissionAmount: string | null };
  _count: number;
};

type Payout = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossRevenue: string | number;
  commission: string | number;
  netAmount: string | number;
  status: string;
  method?: string | null;
  referenceId: string | null;
  processedAt?: string | null;
  createdAt?: string;
};

type PayoutPayload = { byChannel: ChannelRow[]; payouts: Payout[] };

const PAYOUT_STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  PENDING: {
    label: 'Por procesar',
    cls: 'pending',
    hint: 'Calculada pero sin iniciar la transferencia.',
  },
  PROCESSING: {
    label: 'En transferencia',
    cls: 'hold',
    hint: 'SPEI iniciado, falta confirmación.',
  },
  COMPLETED: { label: 'Pagada', cls: 'paid', hint: 'Transferencia confirmada.' },
  FAILED: { label: 'Fallida', cls: 'canceled', hint: 'La transferencia no se completó.' },
  CANCELLED: { label: 'Cancelada', cls: 'refunded', hint: 'Se anuló la liquidación.' },
};

function payoutStatus(status: string) {
  return PAYOUT_STATUS[status] ?? { label: status, cls: 'refunded', hint: 'Estado no reconocido.' };
}

/** ¿El neto guardado cuadra con bruto − comisión? */
function payoutBalance(p: Payout) {
  const gross = toNumber(p.grossRevenue as string);
  const commission = toNumber(p.commission as string);
  const net = toNumber(p.netAmount as string);
  const expected = gross - commission;
  return { gross, commission, net, expected, mismatch: isSettlementMismatch(expected, net) };
}

function csvCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function PayoutsPage() {
  const resource = useResource<PayoutPayload>(
    useCallback(
      ({ token, signal }) => adminApi<PayoutPayload>('/admin/payouts', token, { signal }),
      [],
    ),
    { requiresOrg: false },
  );

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Liquidaciones</h1>
          <p>Ventas por canal y transferencias a promotor</p>
        </div>
      </header>

      <ResourceView resource={resource} context="las liquidaciones" loadingRows={5}>
        {(data) => <PayoutsView data={data} reload={resource.reload} />}
      </ResourceView>
    </div>
  );
}

function PayoutsView({ data, reload }: { data: PayoutPayload; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const balances = useMemo(
    () => new Map(data.payouts.map((p) => [p.id, payoutBalance(p)] as const)),
    [data.payouts],
  );
  const broken = useMemo(
    () => data.payouts.filter((p) => balances.get(p.id)?.mismatch),
    [data.payouts, balances],
  );

  const visible = useMemo(
    () => (statusFilter === 'ALL' ? data.payouts : data.payouts.filter((p) => p.status === statusFilter)),
    [data.payouts, statusFilter],
  );

  const statuses = useMemo(
    () => Array.from(new Set(data.payouts.map((p) => p.status))),
    [data.payouts],
  );

  /** Totales por moneda: sumar MXN con USD sería inventar un número. */
  const channelTotals = useMemo(() => {
    const map = new Map<string, { gross: number; commission: number; orders: number }>();
    for (const r of data.byChannel) {
      const cur = (r.currency || 'MXN').toUpperCase();
      const acc = map.get(cur) ?? { gross: 0, commission: 0, orders: 0 };
      acc.gross += toNumber(r._sum.totalAmount);
      acc.commission += toNumber(r._sum.commissionAmount);
      acc.orders += r._count;
      map.set(cur, acc);
    }
    return Array.from(map.entries());
  }, [data.byChannel]);

  async function act(id: string, action: 'process' | 'complete') {
    const token = getStoredToken();
    if (!token) return;
    const referenceId = window.prompt(
      action === 'process'
        ? 'Referencia SPEI de la transferencia iniciada (opcional)'
        : 'Referencia SPEI de la transferencia confirmada (obligatoria para conciliar)',
      '',
    );
    if (referenceId === null) return;
    if (action === 'complete' && !referenceId.trim()) {
      toast.error('Sin referencia no se puede conciliar el pago. Captúrala para continuar.');
      return;
    }
    setBusy(id);
    try {
      await adminApi(`/admin/payouts/${id}/${action}`, token, {
        method: 'POST',
        body: JSON.stringify({ referenceId: referenceId.trim() || undefined }),
      });
      toast.success(action === 'process' ? 'Liquidación en transferencia' : 'Liquidación marcada como pagada');
      reload();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.userMessage : 'No se pudo actualizar la liquidación',
      );
    } finally {
      setBusy(null);
    }
  }

  /** Exporta lo que se ve, con periodo explícito y la columna de descuadre. */
  function exportCsv() {
    const header = [
      'payoutId',
      'periodoInicio',
      'periodoFin',
      'bruto',
      'comision',
      'netoGuardado',
      'netoCalculado',
      'diferencia',
      'estado',
      'referencia',
      'procesadoEn',
    ];
    const lines = visible.map((p) => {
      const b = balances.get(p.id)!;
      return [
        p.id,
        new Date(p.periodStart).toISOString().slice(0, 10),
        new Date(p.periodEnd).toISOString().slice(0, 10),
        b.gross.toFixed(2),
        b.commission.toFixed(2),
        b.net.toFixed(2),
        b.expected.toFixed(2),
        (b.net - b.expected).toFixed(2),
        p.status,
        p.referenceId ?? '',
        p.processedAt ?? '',
      ].map(csvCell).join(',');
    });
    const csv = [header.join(','), ...lines].join('\n');
    // BOM para que Excel en es-MX no rompa los acentos.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liquidaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {broken.length > 0 && (
        <Notice tone="danger" title={`${broken.length} liquidación(es) no cuadran`}>
          <p>
            El neto guardado difiere de <em>bruto − comisión</em>. No transfieras hasta revisarlo:
            se marcan abajo con la diferencia exacta.
          </p>
        </Notice>
      )}

      <section className={platform.panel}>
        <h2>Ventas por canal</h2>
        <p className={styles.scopeNote}>
          Importes calculados sobre el <strong>total esperado de cada orden</strong>, no sobre lo
          liquidado por la pasarela. Desde que ambos pueden diferir, usa esta tabla para repartir
          por canal y el estado de cuenta bancario para cuadrar el dinero real. El API todavía no
          expone la suma de lo liquidado por periodo.
        </p>
        {data.byChannel.length === 0 ? (
          <EmptyBlock
            title="Sin ventas registradas"
            hint="Cuando haya órdenes en cualquier canal aparecerán aquí agrupadas por moneda."
          />
        ) : (
          <table className={platform.table}>
            <caption className={styles.srOnly}>
              Ventas agrupadas por canal y moneda, con comisión y neto estimado
            </caption>
            <thead>
              <tr>
                <th scope="col">Canal</th>
                <th scope="col">Moneda</th>
                <th scope="col" className={styles.numeric}>
                  Órdenes
                </th>
                <th scope="col" className={styles.numeric}>
                  Bruto esperado
                </th>
                <th scope="col" className={styles.numeric}>
                  Comisión
                </th>
                <th scope="col" className={styles.numeric}>
                  Neto estimado
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byChannel.map((r) => {
                const gross = toNumber(r._sum.totalAmount);
                const commission = toNumber(r._sum.commissionAmount);
                return (
                  <tr key={`${r.channel}-${r.currency}`}>
                    <th scope="row">{r.channel}</th>
                    <td>{(r.currency || 'MXN').toUpperCase()}</td>
                    <td className={styles.numeric}>{formatNumber(r._count)}</td>
                    <td className={styles.numeric}>{formatMoney(gross, r.currency)}</td>
                    <td className={styles.numeric}>{formatMoney(commission, r.currency)}</td>
                    <td className={styles.numeric}>{formatMoney(gross - commission, r.currency)}</td>
                  </tr>
                );
              })}
              {channelTotals.map(([cur, t]) => (
                <tr key={`total-${cur}`} className={styles.breakdownTotal}>
                  <th scope="row">Total {cur}</th>
                  <td>{cur}</td>
                  <td className={styles.numeric}>{formatNumber(t.orders)}</td>
                  <td className={styles.numeric}>{formatMoney(t.gross, cur)}</td>
                  <td className={styles.numeric}>{formatMoney(t.commission, cur)}</td>
                  <td className={styles.numeric}>{formatMoney(t.gross - t.commission, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={platform.panel}>
        <div className={styles.toolbar}>
          <h2 style={{ margin: 0, flex: 1 }}>Liquidaciones a promotor</h2>
          <div className={styles.filters} role="group" aria-label="Filtrar por estado">
            <button
              type="button"
              aria-pressed={statusFilter === 'ALL'}
              className={statusFilter === 'ALL' ? styles.filterActive : styles.filter}
              onClick={() => setStatusFilter('ALL')}
            >
              Todas ({data.payouts.length})
            </button>
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statusFilter === s}
                className={statusFilter === s ? styles.filterActive : styles.filter}
                onClick={() => setStatusFilter(s)}
              >
                {payoutStatus(s).label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={platform.ghostBtn}
            onClick={exportCsv}
            disabled={visible.length === 0}
          >
            Exportar CSV
          </button>
        </div>

        {visible.length === 0 ? (
          <EmptyBlock
            title={
              data.payouts.length === 0
                ? 'Todavía no se ha generado ninguna liquidación'
                : 'Ninguna liquidación con ese estado'
            }
            hint={
              data.payouts.length === 0
                ? 'Se generan al cerrar el periodo mensual del promotor desde Analytics.'
                : 'Quita el filtro para ver el resto.'
            }
          />
        ) : (
          <table className={platform.table}>
            <caption className={styles.srOnly}>
              Liquidaciones con periodo, importes, estado y referencia bancaria
            </caption>
            <thead>
              <tr>
                <th scope="col">Periodo</th>
                <th scope="col" className={styles.numeric}>
                  Bruto
                </th>
                <th scope="col" className={styles.numeric}>
                  Comisión
                </th>
                <th scope="col" className={styles.numeric}>
                  Neto a transferir
                </th>
                <th scope="col">Estado</th>
                <th scope="col">Referencia</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const b = balances.get(p.id)!;
                const meta = payoutStatus(p.status);
                return (
                  <tr key={p.id} className={b.mismatch ? styles.rowAlert : undefined}>
                    <th scope="row" className={styles.rowHead}>
                      {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                      {p.processedAt && <small>Procesada {formatDateTime(p.processedAt)}</small>}
                    </th>
                    <td className={styles.numeric}>{formatMoney(b.gross, 'MXN')}</td>
                    <td className={styles.numeric}>{formatMoney(b.commission, 'MXN')}</td>
                    <td className={styles.numeric}>
                      {formatMoney(b.net, 'MXN')}
                      {b.mismatch && (
                        <>
                          <br />
                          <small className={styles.lookupError}>
                            No cuadra: bruto − comisión da {formatMoney(b.expected, 'MXN')} (
                            {formatMoneyDelta(b.net - b.expected, 'MXN')})
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.status} ${styles[meta.cls]}`} title={meta.hint}>
                        {meta.label}
                      </span>
                    </td>
                    <td>{p.referenceId || <span className={styles.subtle}>Sin referencia</span>}</td>
                    <td>
                      {p.status === 'PENDING' && (
                        <button
                          type="button"
                          className={platform.ghostBtn}
                          disabled={busy !== null}
                          onClick={() => void act(p.id, 'process')}
                        >
                          {busy === p.id ? 'Guardando…' : 'Iniciar SPEI'}
                        </button>
                      )}
                      {(p.status === 'PENDING' || p.status === 'PROCESSING') && (
                        <button
                          type="button"
                          className={platform.primaryBtn}
                          disabled={busy !== null}
                          onClick={() => void act(p.id, 'complete')}
                        >
                          {busy === p.id ? 'Guardando…' : 'Marcar pagada'}
                        </button>
                      )}
                      {p.status !== 'PENDING' && p.status !== 'PROCESSING' && (
                        <span className={styles.subtle}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
