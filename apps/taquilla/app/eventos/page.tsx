'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stockImageForCategory } from '@boletera/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SearchInput,
  SkeletonCard,
} from '@boletera/ui';
import { apiJson, getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { digitPressed, type Hotkey } from '@/lib/hotkeys';
import styles from './eventos.module.scss';

type Offer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

type EventRow = {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  category?: string;
  venue: { name: string };
  offers?: Offer[];
};

function money(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function EventosTaquillaPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    apiJson<EventRow[]>('/discovery/events')
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!q) return events;
    const needle = q.toLowerCase();
    return events.filter(
      (e) => e.title.toLowerCase().includes(needle) || e.venue?.name?.toLowerCase().includes(needle),
    );
  }, [events, q]);

  /** El precio ya NO viaja por la URL: lo fija el catálogo en la pantalla de venta. */
  function ventaUrl(eventId: string, offer: Offer) {
    return `/venta?${new URLSearchParams({ eventId, offerId: offer.id }).toString()}`;
  }

  const hotkeys: Hotkey[] = [
    {
      keys: '1-9',
      label: 'Vender evento',
      whileTyping: true,
      match: (e) => digitPressed(e) != null,
      run: (e) => {
        const n = digitPressed(e);
        const row = n ? filtered[n - 1] : undefined;
        if (!row) return;
        const offer = (row.offers ?? []).filter((o) => o.isAvailable !== false)[0];
        router.push(
          offer
            ? ventaUrl(row.id, offer)
            : `/venta?${new URLSearchParams({ eventId: row.id }).toString()}`,
        );
      },
    },
    {
      keys: 'F2',
      label: 'Buscar',
      whileTyping: true,
      run: () => document.getElementById('event-search')?.focus(),
    },
    { keys: 'Esc', label: 'Volver', whileTyping: true, match: (e) => e.key === 'Escape', run: () => router.push('/') },
  ];

  return (
    <PosShell
      title="Selecciona evento y zona"
      eyebrow="Catálogo de turno"
      backHref="/"
      size="md"
      hotkeys={hotkeys}
      escapeGoesBack={false}
    >
      <Card padding="sm" className={styles.searchCard}>
        <SearchInput
          id="event-search"
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="Buscar por nombre o venue…"
          inputSize="lg"
          shortcut="F2"
        />
        <p className={styles.searchHint}>
          <Badge tone="neutral" variant="outline" size="sm">1–9</Badge>
          <span>Venta rápida al evento en la lista</span>
        </p>
      </Card>

      {loading ? (
        <div className={styles.skeletonStack}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          illustration="search"
          title={events.length === 0 ? 'No hay eventos activos' : 'Sin coincidencias'}
          description={
            events.length === 0
              ? 'Cuando haya eventos publicados para taquilla aparecerán aquí.'
              : 'Prueba otro nombre o venue en la búsqueda.'
          }
          size="md"
        />
      ) : (
        <ul className={styles.list}>
          {filtered.map((e, i) => {
            const date = new Date(e.startsAt);
            const offers = (e.offers || []).filter((o) => o.isAvailable !== false);
            const open = expanded === e.id;
            const thumb = stockImageForCategory(e.category, e.title);

            return (
              <li key={e.id}>
                <Card padding="none" className={styles.eventCard}>
                  <button
                    type="button"
                    className={styles.eventToggle}
                    onClick={() => setExpanded(open ? null : e.id)}
                    aria-expanded={open}
                  >
                    <span className={styles.idx}>{String(i + 1).padStart(2, '0')}</span>
                    <div
                      className={styles.thumb}
                      style={{ backgroundImage: `url(${thumb})` }}
                      aria-hidden="true"
                    />
                    <div className={styles.cardDate}>
                      <strong>{date.toLocaleDateString('es-MX', { day: '2-digit' })}</strong>
                      <span>{date.toLocaleDateString('es-MX', { month: 'short' }).toUpperCase()}</span>
                    </div>
                    <div className={styles.cardInfo}>
                      <strong>{e.title}</strong>
                      <span>
                        {e.venue?.name} ·{' '}
                        {date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>
                      {offers.length > 0 ? (
                        <Badge tone="accent" variant="soft" size="sm">
                          {offers.length} zona{offers.length === 1 ? '' : 's'}
                        </Badge>
                      ) : (
                        <Badge tone="warning" variant="soft" size="sm">Sin ofertas</Badge>
                      )}
                      <span className={open ? styles.ctaSecondary : styles.cta}>
                        {open ? 'Cerrar' : 'Zonas'}
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div className={styles.offerPanel}>
                      {offers.length === 0 ? (
                        <p className={styles.offerEmpty}>Sin ofertas disponibles</p>
                      ) : (
                        <ul className={styles.offerList}>
                          {offers.map((o) => {
                            const stock = o.remainingQuantity;
                            const lowStock = stock != null && stock <= 10;
                            return (
                              <li key={o.id}>
                                <Card variant="outline" padding="sm" className={styles.offerRow}>
                                  <div className={styles.offerMain}>
                                    <strong>{o.name || o.zone || 'General'}</strong>
                                    <span>
                                      {o.zone && o.name ? o.zone : 'GA'}
                                      {stock != null ? ` · ${stock} disp.` : ''}
                                    </span>
                                  </div>
                                  <div className={styles.offerAside}>
                                    {stock != null && (
                                      <Badge
                                        tone={lowStock ? 'warning' : 'success'}
                                        variant="soft"
                                        size="sm"
                                      >
                                        {lowStock ? 'Poco stock' : 'Disponible'}
                                      </Badge>
                                    )}
                                    <strong className={styles.offerPrice}>{money(Number(o.basePrice))}</strong>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() => router.push(ventaUrl(e.id, o))}
                                    >
                                      Vender
                                    </Button>
                                  </div>
                                </Card>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PosShell>
  );
}
