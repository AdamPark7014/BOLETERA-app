'use client';

/**
 * Reservaciones y bloqueos.
 *
 * Deriva holds de checkout de las órdenes recientes y holds de zona de
 * `/metrics/inventory`. `GET /admin/orders` devuelve un sobre paginado, no un
 * arreglo: la versión anterior lo recorría como lista y reventaba con
 * «orders.filter is not a function». Aquí se lee con `readOrderRows`.
 */

import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import type { OrderRow } from '@/lib/queries/orders';
import {
  useReleaseReservationHold,
  useReservationEvents,
  useReservationInventory,
  useReservationOrders,
  useReservationOrdersMetrics,
} from '@/lib/queries/reservations';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import bt from '../orders/_bt/bt.module.scss';
import { channelWord, readOrderRows } from '../orders/_bt/read';
import {
  buildReleaseTimeline,
  buildReservationRows,
  conversionFunnel,
  reservationKpis,
} from './_lib/derive';
import {
  daysAgoIso,
  formatCount,
  formatExpiry,
  formatMoney,
  formatRelative,
  formatShare,
  rangeLabel,
} from './_lib/format';
import {
  KIND_LABEL,
  KIND_VALUES,
  POLICY_TEMPLATES,
  RANGE_OPTIONS,
  STATUS_LABEL,
  STATUS_VALUES,
  type RangeKey,
  type ReservationRow,
} from './_lib/types';
import { useReservationsUrlState } from './_lib/use-reservations-url-state';

function failMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

function activityLabel(row: ReservationRow): string {
  if (row.status === 'released') return 'Liberada o cancelada';
  if (row.status === 'expired') return 'Hold expirado';
  if (row.status === 'completed') return 'Convertida a compra';
  if (row.kind === 'zone_hold') return 'Inventario de zona retenido';
  return 'Hold de checkout';
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ReservasBody />
      </AdminFrame>
    </Suspense>
  );
}

function ReservasBody() {
  const session = useSession();
  const canSee =
    hasCapability(session.role, 'orders.view') || hasCapability(session.role, 'events.view');

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando reservaciones.</p>;
  if (!canSee) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Reservaciones</h1>
          <p className={styles.quiet}>Tu rol no ve órdenes ni eventos.</p>
        </header>
      </section>
    );
  }
  return <ReservasView orgId={session.orgId} />;
}

function ReservasView({ orgId }: { orgId: string }) {
  const url = useReservationsUrlState();
  const deferredQuery = useDeferredValue(url.q);

  const params = useMemo(
    () => ({
      organizationId: orgId,
      from: daysAgoIso(Number(url.range)),
      to: new Date().toISOString(),
    }),
    [orgId, url.range]
  );

  const ordersQuery = useReservationOrders({ scope: 'reservations' });
  const inventory = useReservationInventory(params);
  const ordersMetrics = useReservationOrdersMetrics(params);
  const events = useReservationEvents();
  const release = useReleaseReservationHold();
  const [holdInput, setHoldInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** El API manda `{ data, nextCursor, hasMore }`; el tipo del hook dice arreglo. */
  const orderPage = useMemo(() => readOrderRows(ordersQuery.data as unknown), [ordersQuery.data]);
  const orders = useMemo<OrderRow[]>(
    () =>
      orderPage.rows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        status: row.status,
        channel: row.channel,
        totalAmount: String(row.amount),
        currency: row.currency,
        buyerName: row.buyerName ?? '',
        buyerEmail: row.buyerEmail ?? '',
        createdAt: row.createdAt ?? new Date(0).toISOString(),
        event: { title: row.eventTitle },
        payment: row.paymentGateway
          ? { gateway: row.paymentGateway, status: row.paymentStatus ?? '' }
          : null,
      })),
    [orderPage]
  );

  const rows = useMemo(
    () => buildReservationRows(orders, inventory.data),
    [inventory.data, orders]
  );
  const kpis = useMemo(
    () => reservationKpis(rows, inventory.data, orders),
    [inventory.data, orders, rows]
  );
  const funnel = useMemo(() => conversionFunnel(orders), [orders]);
  const releaseFeed = useMemo(() => buildReleaseTimeline(rows), [rows]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return rows.filter((row) => {
      if (url.kinds.length && !url.kinds.includes(row.kind)) return false;
      if (url.statuses.length && !url.statuses.includes(row.status)) return false;
      if (!needle) return true;
      return `${row.title} ${row.meta} ${row.eventTitle} ${row.buyer} ${row.channel}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [deferredQuery, rows, url.kinds, url.statuses]);

  const kindOptions = [
    { value: '', label: `Todos los tipos (${rows.length})` },
    ...KIND_VALUES.map((value) => ({
      value,
      label: `${KIND_LABEL[value]} (${rows.filter((row) => row.kind === value).length})`,
    })),
  ];
  const statusOptions = [
    { value: '', label: `Todos los estados (${rows.length})` },
    ...STATUS_VALUES.map((value) => ({
      value,
      label: `${STATUS_LABEL[value]} (${rows.filter((row) => row.status === value).length})`,
    })),
  ];

  const loading = ordersQuery.isPending || inventory.isPending;
  const listError = ordersQuery.error ?? inventory.error;
  const filtering = Boolean(url.q || url.kinds.length || url.statuses.length);

  function refresh() {
    void ordersQuery.refetch();
    void inventory.refetch();
    void ordersMetrics.refetch();
    void events.refetch();
  }

  async function releaseHold(row: ReservationRow) {
    const holdId = (row.holdId || holdInput).trim();
    setActionError(null);
    setNotice(null);
    if (!holdId) {
      setActionError('Indica el ID del hold a liberar (SeatHold).');
      return;
    }
    try {
      const result = await release.mutateAsync({ holdId });
      if (result.released) {
        setNotice('Hold liberado; el inventario vuelve a disponible.');
        setHoldInput('');
        url.setSelectedId(null);
      } else {
        setNotice(`El hold no estaba activo (${result.status ?? 'estado desconocido'}).`);
      }
    } catch (cause) {
      setActionError(failMessage(cause, 'No se pudo liberar el hold.'));
    }
  }

  const approval = ordersMetrics.data?.kpis.approvalRate.value;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Reservaciones</h1>
        <p className={styles.quiet}>
          Holds de checkout, holds de zona, expiraciones y liberaciones. Se derivan de las órdenes
          recientes y del inventario; no se inventan holds.
        </p>
        <div className={bt.actions}>
          <div className={bt.segmentWrap}>
            <Segment<RangeKey>
              label="Rango de análisis"
              value={url.range}
              options={[...RANGE_OPTIONS]}
              onChange={url.setRange}
            />
          </div>
          <TicketButton
            variant="secondary"
            disabled={ordersQuery.isFetching || inventory.isFetching}
            onClick={refresh}
          >
            Actualizar
          </TicketButton>
        </div>
      </header>

      {listError ? (
        <ApiErrorView error={listError} context="leer las reservaciones" onRetry={refresh} />
      ) : loading ? (
        <p className={styles.quiet}>Cargando reservaciones.</p>
      ) : (
        <>
          <div className={styles.rows}>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Reservas activas</p>
                <p className={styles.rowMeta}>
                  {formatCount(kpis.pending)} checkouts · {formatCount(kpis.expiringSoon)} por
                  expirar · {rangeLabel(url.range)}
                </p>
              </div>
              <span />
              <p className={styles.figure}>{formatCount(kpis.activeReservations)}</p>
            </div>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Holds de zona</p>
                <p className={styles.rowMeta}>
                  {formatCount(kpis.activeHolds)} holds activos reportados
                </p>
              </div>
              <span />
              <p className={styles.figure}>{formatCount(kpis.zoneHolds)}</p>
            </div>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Liberaciones y expiraciones</p>
                <p className={styles.rowMeta}>
                  {formatCount(kpis.released)} liberadas · {formatCount(kpis.expired)} expiradas
                </p>
              </div>
              <span />
              <p className={styles.figure}>{formatCount(kpis.released + kpis.expired)}</p>
            </div>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Conversión hold → compra</p>
                <p className={styles.rowMeta}>
                  {formatCount(kpis.completed)} convertidos de{' '}
                  {formatCount(kpis.pending + kpis.completed)}
                </p>
              </div>
              <span />
              <p className={styles.figure}>{formatShare(kpis.conversion)}</p>
            </div>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Tasa de aprobación de pagos</p>
                <p className={styles.rowMeta}>Sirve para leer el abandono de holds</p>
              </div>
              <span />
              <p className={styles.figure}>
                {ordersMetrics.isPending
                  ? '—'
                  : ordersMetrics.error
                    ? 'Sin dato'
                    : `${(approval ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`}
              </p>
            </div>
          </div>
          {ordersMetrics.error ? (
            <p className={styles.danger} role="alert">
              {failMessage(ordersMetrics.error, 'No se leyó la señal de pagos.')}
            </p>
          ) : null}
          {orderPage.hasMore ? (
            <p className={styles.tertiary}>
              Solo se leen las órdenes más recientes; hay más en el servidor.
            </p>
          ) : null}

          <div className={bt.block}>
            <div className={bt.toolbar}>
              <Field
                label="Buscar"
                kind="search"
                value={url.q}
                placeholder="Hold, evento, comprador o canal"
                onChange={(event) => url.setSearch(event.target.value)}
              />
              <div>
                <p className={bt.filterLabel}>Tipo</p>
                <SheetSelect
                  label="Tipo"
                  value={url.kinds[0] ?? ''}
                  placeholder="Todos los tipos"
                  options={kindOptions}
                  onChange={(value) =>
                    url.setFilterSelection({
                      ...(value ? { kind: [value] } : {}),
                      ...(url.statuses.length ? { status: [...url.statuses] } : {}),
                    })
                  }
                />
              </div>
              <div>
                <p className={bt.filterLabel}>Estado</p>
                <SheetSelect
                  label="Estado"
                  value={url.statuses[0] ?? ''}
                  placeholder="Todos los estados"
                  options={statusOptions}
                  onChange={(value) =>
                    url.setFilterSelection({
                      ...(url.kinds.length ? { kind: [...url.kinds] } : {}),
                      ...(value ? { status: [value] } : {}),
                    })
                  }
                />
              </div>
            </div>
            <div className={bt.actions}>
              <p className={styles.tertiary} role="status">
                {formatCount(filtered.length)} de {formatCount(rows.length)} reservas
              </p>
              {filtering ? (
                <TicketButton variant="ghost" onClick={url.clearFilters}>
                  Limpiar filtros
                </TicketButton>
              ) : null}
            </div>
          </div>

          <div className={bt.block}>
            {rows.length === 0 ? (
              <>
                <p className={styles.quiet}>
                  {(events.data?.length ?? 0) > 0
                    ? 'Sin reservas activas. No hay holds de checkout ni retención de zona.'
                    : 'Sin reservas. Publica eventos y abre venta para empezar a ver holds y bloqueos.'}
                </p>
                <div className={bt.actions}>
                  <Link href="/orders" className={bt.link}>
                    Ver órdenes
                  </Link>
                  <Link href="/inventory" className={bt.link}>
                    Ver inventario
                  </Link>
                </div>
              </>
            ) : filtered.length === 0 ? (
              <p className={styles.quiet}>Nada con ese criterio.</p>
            ) : null}
            {filtered.map((row) => {
              const open = url.selectedId === row.id;
              const canRelease =
                row.kind === 'checkout' || row.kind === 'zone_hold' || Boolean(row.holdId);
              return (
                <div key={row.id} className={styles.stack}>
                  <button
                    type="button"
                    className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                    aria-expanded={open}
                    onClick={() => {
                      url.setSelectedId(open ? null : row.id);
                      setHoldInput('');
                    }}
                  >
                    <span>
                      <span className={row.kind === 'checkout' ? styles.mono : undefined}>
                        {row.title}
                      </span>{' '}
                      · {KIND_LABEL[row.kind]} · {STATUS_LABEL[row.status]}
                    </span>
                    <span className={styles.figure}>{formatCount(row.quantity)}</span>
                  </button>
                  {open ? (
                    <div className={bt.detail}>
                      <div className={styles.rows}>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Evento</p>
                          <p className={bt.pairValue}>{row.eventTitle}</p>
                        </div>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Cupos</p>
                          <p className={bt.pairValue}>{formatCount(row.quantity)}</p>
                        </div>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Valor</p>
                          <p className={bt.pairValue}>
                            {row.amount > 0 ? formatMoney(row.amount, row.currency) : '—'}
                          </p>
                        </div>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Canal</p>
                          <p className={bt.pairValue}>{channelWord(row.channel)}</p>
                        </div>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Edad</p>
                          <p className={bt.pairValue}>{formatRelative(row.createdAt)}</p>
                        </div>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Expiración</p>
                          <p className={bt.pairValue}>{formatExpiry(row.expiresAt)}</p>
                        </div>
                        <div className={bt.pair}>
                          <p className={bt.pairLabel}>Responsable</p>
                          <p className={bt.pairValue}>{row.buyer}</p>
                        </div>
                      </div>
                      <p className={styles.rowMeta}>{row.meta}</p>
                      {row.orderId ? (
                        <Link href={`/orders/${row.orderId}`} className={bt.link}>
                          Abrir la orden {row.title}
                        </Link>
                      ) : null}
                      {canRelease ? (
                        <>
                          {!row.holdId ? (
                            <Field
                              label="ID de SeatHold"
                              hint="Si lo conoces. Liberar usa DELETE /inventory/holds/:id."
                              placeholder="hold_…"
                              autoComplete="off"
                              value={holdInput}
                              onChange={(event) => setHoldInput(event.target.value)}
                            />
                          ) : null}
                          <div className={bt.actions}>
                            <TicketButton
                              variant="danger"
                              disabled={release.isPending}
                              onClick={() => void releaseHold(row)}
                            >
                              {release.isPending ? 'Liberando' : 'Liberar hold'}
                            </TicketButton>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {actionError ? (
            <p className={styles.danger} role="alert">
              {actionError}
            </p>
          ) : null}
          {notice ? (
            <p className={styles.quiet} aria-live="polite">
              {notice}
            </p>
          ) : null}

          <div className={bt.block}>
            <p className={styles.rowTitle}>Embudo hold → compra</p>
            {funnel.every((stage) => stage.value === 0) ? (
              <p className={styles.quiet}>
                Sin embudo todavía. Aparece con órdenes pendientes o completadas.
              </p>
            ) : (
              <div className={styles.rows}>
                {funnel.map((stage) => (
                  <div key={stage.id} className={styles.row}>
                    <p className={styles.rowTitle}>{stage.label}</p>
                    <span />
                    <p className={styles.figure}>{formatCount(stage.value)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={bt.block}>
            <p className={styles.rowTitle}>Línea operativa</p>
            <div className={styles.rows}>
              <div className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>Holds activos</p>
                  <p className={styles.rowMeta}>Checkout más holds de inventario</p>
                </div>
                <span />
                <p className={styles.figure}>{formatCount(kpis.activeHolds)}</p>
              </div>
              <div className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>Por expirar en 5 min o menos</p>
                  <p className={styles.rowMeta}>TTL estimado del checkout web (15 min)</p>
                </div>
                <span />
                <p className={styles.figure}>{formatCount(kpis.expiringSoon)}</p>
              </div>
              <div className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>En conversión</p>
                  <p className={styles.rowMeta}>Valor de órdenes pendientes de pago</p>
                </div>
                <span />
                <p className={styles.figure}>{formatMoney(kpis.convertingAmount)}</p>
              </div>
              <div className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>Bloqueos operativos</p>
                  <p className={styles.rowMeta}>VIP, prensa, producción y cortesías</p>
                </div>
                <span />
                <p className={styles.figure}>{formatCount(kpis.blocked)}</p>
              </div>
            </div>
          </div>

          <div className={bt.block}>
            <p className={styles.rowTitle}>Actividad reciente</p>
            {releaseFeed.length === 0 ? (
              <p className={styles.quiet}>Sin actividad.</p>
            ) : (
              <div className={styles.rows}>
                {releaseFeed.map((row) => (
                  <div key={row.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>
                        {activityLabel(row)} · {row.title}
                      </p>
                      <p className={styles.rowMeta}>
                        {row.buyer} · {row.eventTitle} · {formatExpiry(row.expiresAt)}
                      </p>
                    </div>
                    <span />
                    <p className={styles.quiet}>{formatRelative(row.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={bt.block}>
            <p className={styles.rowTitle}>Políticas sugeridas</p>
            <p className={styles.tertiary}>Plantillas de lectura. No se publican ni se guardan.</p>
            <div className={styles.rows}>
              {POLICY_TEMPLATES.map((policy) => (
                <div key={policy.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>{policy.title}</p>
                    <p className={styles.rowMeta}>{policy.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
