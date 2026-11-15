'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { StageArt, formatTicketAmount } from '@boletera/ui';
import type { MetricsAlert, MetricsTimePoint } from '@boletera/shared';
import { hasCapability } from '@/lib/permissions';
import { listEvents, type EventHub, type EventRow } from '@/lib/platform-api';
import { useMetricsAlerts, useMetricsTimeseries, useEventSalesPace } from '@/lib/queries/metrics';
import { useOrders } from '@/lib/queries/orders';
import { useRecommendationBundle } from '@/lib/queries/pricing';
import {
  CONSUMED_STATUSES,
  getAvailability,
  type AvailabilitySnapshot,
} from '../_shared/inventory-api';
import styles from './frame.module.scss';
import own from './summary.module.scss';
import {
  asRecord,
  categoryLabel,
  formatCount,
  formatWhen,
  readNumber,
  readOffers,
  readString,
  statusLabel,
  yesNo,
} from './read';

type Props = {
  event: unknown;
  hub?: EventHub;
  eventId?: string;
  token?: string;
  role?: string | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'Web',
  APP: 'App',
  MOBILE: 'App',
  TAQUILLA: 'Taquilla',
  BOX_OFFICE: 'Taquilla',
  POS: 'Taquilla',
  AFFILIATE: 'Afiliados',
  PARTNER: 'Socios',
  RESALE: 'Reventa',
  API: 'API',
  PHONE: 'Teléfono',
  PROMOTER: 'Promotor',
  ADMIN: 'Administración',
  COURTESY: 'Cortesía',
  CORPORATE: 'Corporativo',
  VIP: 'VIP',
  INVITATION: 'Invitación',
  KIOSK: 'Quiosco',
};

const CHANNEL_COLORS = ['var(--gold)', 'var(--gold-soft)', '#8A7359', '#5C4E3E', '#3F362C'];

function channelName(raw: string): string {
  return CHANNEL_LABEL[raw.toUpperCase()] ?? raw.charAt(0) + raw.slice(1).toLowerCase();
}

function money(value: number): string {
  return value.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function moneyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString('es-MX', { maximumFractionDigits: 2 })} M`;
  }
  if (Math.abs(value) >= 100_000) {
    return `$${(value / 1_000).toLocaleString('es-MX', { maximumFractionDigits: 0 })} k`;
  }
  return money(value);
}

function shortDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone });
}

function timeOf(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

/** Resumen del evento, en el lenguaje de la maqueta. Solo datos que ya traen las consultas. */
export function EventSection({ event, hub, eventId, token, role }: Props) {
  const row = asRecord(event);
  const venue = asRecord(row.venue);
  const zone = readString(row.timezone) ?? 'America/Mexico_City';
  const title = readString(row.title) ?? 'Evento';
  const image = readString(row.bannerImage) ?? readString(row.image);
  const capacity = hub?.inventory.total || readNumber(row.totalCapacity) || 0;
  const sold = hub?.inventory.sold ?? 0;
  const available = hub?.inventory.available ?? Math.max(capacity - sold, 0);
  const occupancy = capacity > 0 ? (sold / capacity) * 100 : 0;
  const channels = useMemo(
    () =>
      (hub?.channels ?? [])
        .map((channel) => ({
          key: channel.channel,
          label: channelName(channel.channel),
          orders: channel._count,
          amount: Number(channel._sum.totalAmount ?? 0) || 0,
        }))
        .sort((a, b) => b.amount - a.amount),
    [hub?.channels]
  );
  const gross = channels.reduce((sum, channel) => sum + channel.amount, 0);
  const orders = channels.reduce((sum, channel) => sum + channel.orders, 0);
  const average = orders > 0 ? gross / orders : null;
  const canMetrics = hasCapability(role, 'dashboard.view');
  const canOrders = hasCapability(role, 'orders.view');
  const canPricing = hasCapability(role, 'events.view') && hasCapability(role, 'dashboard.view');
  const canApply = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const canInventory = hasCapability(role, 'inventory.monitor');
  const when = formatWhen(row.startsAt, zone);
  const venueName = readString(venue.name);
  const city = readString(venue.city);

  return (
    <section className={own.page} aria-labelledby="evento-titulo">
      <header className={own.hero}>
        <div className={own.thumb}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className={own.thumbImg} />
          ) : (
            <StageArt seed={eventId ?? title} fade={false} className={own.thumbArt} />
          )}
        </div>
        <div className={own.heroText}>
          <p className={own.crumb}>
            <Link href="/events" className={own.crumbLink}>
              Eventos
            </Link>{' '}
            › {title}
          </p>
          <h1 id="evento-titulo" className={own.title}>
            {title}
          </h1>
          <p className={styles.quiet}>
            {[
              when,
              [venueName, city].filter(Boolean).join(', '),
              capacity ? `Aforo ${formatCount(capacity)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className={own.heroSide}>
          <span className={statusChip(row.status)}>{statusLabel(row.status)}</span>
          {token && eventId ? (
            <DatePills
              token={token}
              eventId={eventId}
              seriesId={readString(row.seriesId)}
              fallback={shortDate(readString(row.startsAt) ?? '', zone)}
              zone={zone}
            />
          ) : null}
        </div>
      </header>

      <div className={styles.kpis} aria-label="Indicadores del evento">
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Venta bruta</p>
          <p className={styles.kpiValue}>{moneyCompact(gross)}</p>
          <p className={styles.kpiNote}>
            <span className={orders > 0 ? styles.up : undefined}>
              {formatCount(orders)} {orders === 1 ? 'orden cobrada' : 'órdenes cobradas'}
            </span>
            <span>cargos incluidos</span>
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Boletos vendidos</p>
          <p className={styles.kpiValue}>{formatCount(sold)}</p>
          <p className={styles.kpiNote}>
            <span className={occupancy >= 50 ? styles.up : styles.down}>
              {occupancy.toLocaleString('es-MX', { maximumFractionDigits: 0 })}% del aforo
            </span>
            <span>faltan {formatCount(available)}</span>
          </p>
        </div>
        {canMetrics && eventId ? (
          <PaceKpi eventId={eventId} />
        ) : (
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Apartados en curso</p>
            <p className={styles.kpiValue}>{formatCount(hub?.inventory.held ?? 0)}</p>
            <p className={styles.kpiNote}>boletos retenidos ahora</p>
          </div>
        )}
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Ticket promedio</p>
          <p className={styles.kpiValue}>{average == null ? 'Sin dato' : money(average)}</p>
          <p className={styles.kpiNote}>
            {average == null ? 'aún no hay órdenes cobradas' : 'por orden cobrada'}
          </p>
        </div>
      </div>

      <div className={styles.split} style={{ alignItems: 'flex-start' }}>
        <div className={`${styles.panel} ${styles.splitWide}`}>
          {canMetrics && eventId ? (
            <CumulativeChart
              eventId={eventId}
              capacity={capacity}
              sold={sold}
              zone={zone}
              since={readString(row.createdAt)}
            />
          ) : (
            <>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Boletos vendidos, acumulado</h2>
              </div>
              <p className={styles.quiet}>Tu rol no incluye las métricas de venta por día.</p>
            </>
          )}
        </div>
        <div className={styles.splitNarrow}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Por canal</h2>
            </div>
            {channels.length === 0 ? (
              <p className={styles.quiet}>Todavía no hay órdenes cobradas en ningún canal.</p>
            ) : (
              <ul className={own.channelList}>
                {channels.map((channel, index) => {
                  const share = gross > 0 ? (channel.amount / gross) * 100 : 0;
                  return (
                    <li key={channel.key} className={own.channel}>
                      <div className={own.channelHead}>
                        <span>{channel.label}</span>
                        <span className={own.channelNum}>
                          {money(channel.amount)} · {share.toFixed(0)}%
                        </span>
                      </div>
                      <div className={styles.bar}>
                        <div
                          className={styles.barFill}
                          style={{
                            width: `${Math.max(share, 2)}%`,
                            background: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {canPricing && eventId ? <PriceTip eventId={eventId} canApply={canApply} /> : null}
        </div>
      </div>

      <div className={styles.split}>
        <div className={`${styles.panel} ${styles.splitWide}`}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Inventario por sección</h2>
            {canInventory && eventId ? (
              <Link href={`/events/${eventId}?seccion=apartados`} className={styles.panelLink}>
                Abrir inventario
              </Link>
            ) : null}
          </div>
          {token && eventId ? <SectionTable token={token} eventId={eventId} event={event} /> : null}
        </div>
        <div className={`${styles.panel} ${styles.splitNarrow} ${own.liveCol}`}>
          {canOrders && eventId ? (
            <LiveSales eventId={eventId} zone={zone} />
          ) : (
            <>
              <h2 className={styles.panelTitle}>Ventas en vivo</h2>
              <p className={styles.quiet}>Tu rol no incluye el detalle de órdenes.</p>
            </>
          )}
          {canMetrics && eventId ? <EventAlerts eventId={eventId} /> : null}
        </div>
      </div>

      <EventFacts row={row} zone={zone} />
    </section>
  );
}

function statusChip(status: unknown): string {
  const raw = readString(status);
  if (raw === 'LIVE' || raw === 'SCHEDULED') return styles.chipOk;
  if (raw === 'CANCELLED') return styles.chipDanger;
  if (raw === 'DRAFT') return styles.chipWarn;
  return styles.chip;
}

function DatePills({
  token,
  eventId,
  seriesId,
  fallback,
  zone,
}: {
  token: string;
  eventId: string;
  seriesId: string | null;
  fallback: string;
  zone: string;
}) {
  const [siblings, setSiblings] = useState<EventRow[]>([]);
  useEffect(() => {
    if (!seriesId) return;
    let alive = true;
    listEvents(token)
      .then((rows) => {
        if (!alive) return;
        const same = rows
          .filter((item) => (item as EventRow & { seriesId?: string | null }).seriesId === seriesId)
          .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
        setSiblings(same);
      })
      .catch(() => setSiblings([]));
    return () => {
      alive = false;
    };
  }, [token, seriesId]);

  const items =
    siblings.length > 1
      ? siblings.map((item) => ({
          id: item.id,
          label: shortDate(String(item.startsAt), zone),
        }))
      : [{ id: eventId, label: fallback || 'Fecha' }];

  return (
    <nav className={own.dates} aria-label="Fechas del evento">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/events/${item.id}`}
          className={item.id === eventId ? own.dateOn : own.date}
          aria-current={item.id === eventId ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function PaceKpi({ eventId }: { eventId: string }) {
  const pace = useEventSalesPace({ eventId });
  const rowData = pace.data?.events.find((item) => item.eventId === eventId);
  if (!rowData) {
    return (
      <div className={styles.kpi}>
        <p className={styles.kpiLabel}>Ritmo contra meta</p>
        <p className={styles.kpiValue}>{pace.isPending ? '…' : 'Sin dato'}</p>
        <p className={styles.kpiNote}>
          {pace.isPending ? 'calculando' : 'sin fecha de venta para comparar'}
        </p>
      </div>
    );
  }
  const points = Math.round(rowData.paceDelta * 100);
  const ahead = points >= 0;
  return (
    <div className={styles.kpi}>
      <p className={styles.kpiLabel}>Ritmo contra meta</p>
      <p className={styles.kpiValue}>
        {ahead ? '+' : '−'}
        {Math.abs(points)}%
      </p>
      <p className={styles.kpiNote}>
        <span className={ahead ? styles.up : styles.down}>{ahead ? 'adelante' : 'atrás'}</span>
        <span>esperado hoy {Math.round(rowData.expectedPace * 100)}% del aforo</span>
      </p>
    </div>
  );
}

function CumulativeChart({
  eventId,
  capacity,
  sold,
  zone,
  since,
}: {
  eventId: string;
  capacity: number;
  sold: number;
  zone: string;
  since: string | null;
}) {
  const range = useMemo(() => {
    const to = new Date();
    const floor = new Date(to.getTime() - 90 * 86_400_000);
    const created = since ? new Date(since) : null;
    const from = created && !Number.isNaN(created.getTime()) && created > floor ? created : floor;
    return { from: from.toISOString(), to: to.toISOString() };
  }, [since]);
  const query = useMetricsTimeseries({
    eventId,
    metric: 'tickets',
    granularity: 'day',
    from: range.from,
    to: range.to,
  });
  const points: MetricsTimePoint[] = query.data?.series[0]?.points ?? [];

  return (
    <>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Boletos vendidos, acumulado</h2>
        <div className={own.legend}>
          <span>
            <span className={own.legendReal} aria-hidden="true" />
            Real
          </span>
          {capacity > 0 ? (
            <span>
              <span className={own.legendGoal} aria-hidden="true" />
              Aforo
            </span>
          ) : null}
        </div>
      </div>
      {query.isPending ? (
        <div className={styles.skeleton} style={{ height: 300 }} aria-label="Cargando gráfica" />
      ) : query.error ? (
        <p className={styles.quiet}>
          No se pudo leer la venta por día. Intenta de nuevo en un momento.
        </p>
      ) : points.length < 2 ? (
        <div className={own.chartEmpty}>
          <p className={own.chartEmptyFigure}>{formatCount(sold)}</p>
          <p className={styles.quiet}>
            {points.length === 1
              ? `boletos vendidos; la venta empezó el ${shortDate(points[0]!.bucket, zone)}. La curva aparece con el segundo día de venta.`
              : `${sold === 1 ? 'boleto vendido' : 'boletos vendidos'}. La curva aparece cuando haya venta en dos días distintos.`}
          </p>
        </div>
      ) : (
        <AreaSvg points={points} capacity={capacity} zone={zone} />
      )}
    </>
  );
}

function AreaSvg({
  points,
  capacity,
  zone,
}: {
  points: MetricsTimePoint[];
  capacity: number;
  zone: string;
}) {
  const W = 760;
  const H = 320;
  const L = 48;
  const R = 12;
  const T = 14;
  const B = 296;
  let running = 0;
  const cumulative = points.map((point) => {
    running += point.value;
    return { bucket: point.bucket, value: running };
  });
  const top = Math.max(capacity, running, 1) * 1.08;
  const x = (index: number) => L + (index / Math.max(cumulative.length - 1, 1)) * (W - L - R);
  const y = (value: number) => B - (value / top) * (B - T);
  const line = cumulative.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${L},${B} ${line} ${x(cumulative.length - 1).toFixed(1)},${B}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const labelIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (cumulative.length - 1)));
  const last = cumulative[cumulative.length - 1]!;
  const lastX = x(cumulative.length - 1);
  const lastY = y(last.value);
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })}k` : String(n);

  return (
    <svg
      role="img"
      aria-label={`Boletos vendidos acumulados: ${last.value.toLocaleString('es-MX')}${capacity ? ` de un aforo de ${capacity.toLocaleString('es-MX')}` : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      className={own.chart}
    >
      <defs>
        <linearGradient id="bt-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A68A6B" stopOpacity="0.35" />
          <stop offset="1" stopColor="#A68A6B" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={L} x2={W - R} y1={y(tick)} y2={y(tick)} stroke="#26262A" />
          <text x={L - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#A8A29A">
            {fmt(tick)}
          </text>
        </g>
      ))}
      {[...new Set(labelIdx)].map((index) => (
        <text
          key={index}
          x={x(index)}
          y={H - 6}
          textAnchor={index === 0 ? 'start' : index === cumulative.length - 1 ? 'end' : 'middle'}
          fontSize="11"
          fill="#A8A29A"
        >
          {shortDate(cumulative[index]!.bucket, zone)}
        </text>
      ))}
      {capacity > 0 ? (
        <>
          <line
            x1={L}
            x2={W - R}
            y1={y(capacity)}
            y2={y(capacity)}
            stroke="#6A6A70"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
          <text x={W - R} y={y(capacity) - 6} textAnchor="end" fontSize="11" fill="#A8A29A">
            Aforo {capacity.toLocaleString('es-MX')}
          </text>
        </>
      ) : null}
      <polygon points={area} fill="url(#bt-area)" />
      <polyline
        points={line}
        fill="none"
        stroke="#A68A6B"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="5" fill="#000" stroke="#A68A6B" strokeWidth="2.5" />
      <text
        x={lastX > W - 120 ? lastX - 10 : lastX + 10}
        y={lastY - 10}
        textAnchor={lastX > W - 120 ? 'end' : 'start'}
        fontSize="13"
        fontWeight="700"
        fill="#FFFFFF"
      >
        {last.value.toLocaleString('es-MX')} hoy
      </text>
    </svg>
  );
}

function PriceTip({ eventId, canApply }: { eventId: string; canApply: boolean }) {
  const bundle = useRecommendationBundle(eventId);
  const [dismissed, setDismissed] = useState(false);
  const top = (bundle.data?.recommendations ?? [])
    .filter((item) => item.direction !== 'hold' && item.recommendedPrice !== item.currentPrice)
    .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))[0];
  if (dismissed || !top) return null;
  const lower = top.recommendedPrice < top.currentPrice;
  return (
    <div className={own.tip}>
      <p className={own.tipKicker}>RECOMENDACIÓN DE PRECIO</p>
      <p className={own.tipText}>
        {top.name || top.zone}: {lower ? 'bajar' : 'subir'} de{' '}
        {formatTicketAmount(top.currentPrice)} a {formatTicketAmount(top.recommendedPrice)}.
      </p>
      <p className={styles.quiet}>{top.explanation}</p>
      <div className={own.tipActions}>
        <Link href={`/pricing?evento=${encodeURIComponent(eventId)}`} className={styles.goldLink}>
          {canApply ? 'Revisar y aplicar' : 'Revisar'}
        </Link>
        <button type="button" className={own.tipDismiss} onClick={() => setDismissed(true)}>
          Descartar
        </button>
      </div>
      {!canApply ? (
        <p className={styles.tertiary}>Aplicar precios lo hace administración.</p>
      ) : null}
    </div>
  );
}

function SectionTable({
  token,
  eventId,
  event,
}: {
  token: string;
  eventId: string;
  event: unknown;
}) {
  const [snapshot, setSnapshot] = useState<AvailabilitySnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const offers = readOffers(event);

  useEffect(() => {
    let alive = true;
    setState('loading');
    getAvailability(token, eventId, { silent: true })
      .then((data) => {
        if (!alive) return;
        setSnapshot(data);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [token, eventId]);

  if (state === 'loading') {
    return (
      <div className={styles.skeleton} style={{ height: 220 }} aria-label="Cargando inventario" />
    );
  }
  const byOffer = new Map((snapshot?.byOffer ?? []).map((item) => [item.offerId, item]));
  const rows = offers.map((offer) => {
    const entry = byOffer.get(offer.id);
    const total = entry?.total ?? 0;
    const soldCount = entry
      ? CONSUMED_STATUSES.reduce((sum, status) => sum + (entry.counts[status] ?? 0), 0)
      : 0;
    return {
      id: offer.id,
      name: offer.name || offer.zone,
      price: offer.basePrice,
      total,
      sold: soldCount,
    };
  });
  if (state === 'error' || rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>
          {state === 'error'
            ? 'No se pudo leer el inventario'
            : 'Este evento aún no tiene secciones a la venta'}
        </p>
        <p className={styles.quiet}>
          {state === 'error'
            ? 'Vuelve a intentarlo en un momento.'
            : 'Agrega zonas con precio para que aparezcan aquí.'}
        </p>
        <Link href={`/events/${eventId}?seccion=zonas`} className={styles.ghostLink}>
          Ir a precios y zonas
        </Link>
      </div>
    );
  }
  return (
    <div className={own.sectionTable} role="table" aria-label="Inventario por sección">
      <div className={own.sectionHeadRow} role="row">
        <span role="columnheader">SECCIÓN</span>
        <span role="columnheader">PRECIO</span>
        <span role="columnheader">VENDIDO</span>
        <span role="columnheader" className={own.right}>
          ESTADO
        </span>
      </div>
      {rows.map((item) => {
        const pct = item.total > 0 ? (item.sold / item.total) * 100 : 0;
        const status =
          item.total === 0
            ? { text: 'Sin cupo', cls: styles.chip }
            : pct >= 100
              ? { text: 'Agotada', cls: styles.chip }
              : pct >= 90
                ? { text: 'Casi agotada', cls: styles.chipWarn }
                : { text: 'En venta', cls: styles.chipOk };
        return (
          <div key={item.id} className={own.sectionRow} role="row">
            <span role="cell" className={own.sectionName}>
              {item.name}
            </span>
            <span role="cell" className={own.muted}>
              {item.price > 0 ? formatTicketAmount(item.price) : '—'}
            </span>
            <span role="cell" className={own.progress}>
              <span className={styles.bar} style={{ flex: 1, height: 6 }}>
                <span
                  className={styles.barFill}
                  style={{ display: 'block', width: `${Math.min(pct, 100)}%` }}
                />
              </span>
              <span className={own.progressNum}>
                {formatCount(item.sold)} / {formatCount(item.total)}
              </span>
            </span>
            <span role="cell" className={own.right}>
              <span className={status.cls}>{status.text}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LiveSales({ eventId, zone }: { eventId: string; zone: string }) {
  const orders = useOrders({ eventId, limit: 6 });
  const list = (orders.data ?? []).slice(0, 6);
  return (
    <div>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Ventas recientes</h2>
        <Link href={`/orders?evento=${encodeURIComponent(eventId)}`} className={styles.panelLink}>
          Ver órdenes
        </Link>
      </div>
      {orders.isPending ? (
        <div className={styles.skeleton} style={{ height: 180 }} aria-label="Cargando ventas" />
      ) : list.length === 0 ? (
        <p className={styles.quiet}>Todavía no hay órdenes de este evento.</p>
      ) : (
        <ul className={own.live}>
          {list.map((order) => {
            const amount = Number(
              order.totalAmount ?? order.chargedAmount ?? order.expectedAmount ?? 0
            );
            return (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className={own.liveRow}>
                  <span className={own.liveTime}>{timeOf(order.createdAt, zone)}</span>
                  <span className={own.liveWho}>
                    {order.buyerName &&
                    order.buyerName.toLowerCase() !== channelName(order.channel || '').toLowerCase()
                      ? order.buyerName
                      : order.publicId}
                  </span>
                  <span className={own.muted}>{channelName(order.channel || 'WEB')}</span>
                  <span className={own.liveAmount}>{amount > 0 ? money(amount) : '—'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EventAlerts({ eventId }: { eventId: string }) {
  const alerts = useMetricsAlerts({ eventId });
  const list: MetricsAlert[] = (alerts.data?.alerts ?? [])
    .filter((alert) => !alert.entityId || alert.entityId === eventId)
    .slice(0, 2);
  if (list.length === 0) return null;
  return (
    <div className={own.alerts}>
      {list.map((alert) => (
        <p key={alert.id} className={alert.severity === 'critical' ? own.alertCritical : own.alert}>
          <strong>{alert.severity === 'critical' ? 'Urgente · ' : 'Alerta · '}</strong>
          {alert.title}. {alert.suggestedAction}
        </p>
      ))}
    </div>
  );
}

function EventFacts({ row, zone }: { row: Record<string, unknown>; zone: string }) {
  const holdable = readNumber(row.holdableCapacity);
  const facts: [string, string][] = [
    ['Categoría', categoryLabel(row.category)],
    ['Termina', formatWhen(row.endsAt, zone)],
    ['Publicado', formatWhen(row.publishedAt, zone)],
    ['Dirección web', readString(row.slug) ? `/${readString(row.slug)}` : '—'],
    ['Moneda', readString(row.currency) ?? 'MXN'],
    ['Reembolsos', yesNo(row.refundable)],
    ['Reventa', yesNo(row.allowResale)],
    ['Transferencia', yesNo(row.transferAllowed)],
    ['Cupo para apartar', holdable == null ? 'Sin tope' : formatCount(holdable)],
  ];
  const cancelled = readString(row.cancellationReason);
  const description = readString(row.description);
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Ficha del evento</h2>
      </div>
      {description ? <p className={`${styles.quiet} ${own.desc}`}>{description}</p> : null}
      {cancelled ? <p className={styles.danger}>Cancelado: {cancelled}</p> : null}
      <dl className={own.facts}>
        {facts.map(([label, value]) => (
          <div key={label} data-param={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
